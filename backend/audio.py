"""Bounded audio uploads and disposable speech caching for the browser demo."""

import asyncio
import hashlib
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi import UploadFile
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from backend.errors import AppError
from backend.providers import OpenAIProvider

MAX_AUDIO_BYTES = 2 * 1024 * 1024
MAX_TURN_BODY_BYTES = 3 * 1024 * 1024
MAX_SPEECH_BYTES = 5 * 1024 * 1024
MAX_CACHE_BYTES = 32 * 1024 * 1024


def validate_speech_audio(data: bytes, text: str) -> None:
    """Reject malformed or obviously truncated MP3 without decoding or storing recordings.

    Count MPEG Layer III frame samples. The conservative duration floor allows up to
    ten words per second; it detects near-empty provider output, not speech accuracy.
    """
    offset = 0
    if data.startswith(b"ID3") and len(data) >= 10:
        tag_size = data[6:10]
        if any(value & 128 for value in tag_size):
            raise AppError("invalid_speech_audio", "Speech audio was invalid. Please retry.", 502)
        offset = 10 + sum(
            value << shift for value, shift in zip(tag_size, (21, 14, 7, 0), strict=True)
        )
        if data[3] == 4 and data[5] & 16:  # ID3v2.4 footer.
            offset += 10
    seconds = 0.0
    frames = 0
    while offset + 4 <= len(data):
        header = int.from_bytes(data[offset : offset + 4], "big")
        version = (header >> 19) & 3
        layer = (header >> 17) & 3
        bitrate_index = (header >> 12) & 15
        sample_index = (header >> 10) & 3
        if (
            header >> 21 != 0x7FF
            or version == 1
            or layer != 1
            or bitrate_index in {0, 15}
            or sample_index == 3
        ):
            break
        rates = (
            (0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320)
            if version == 3
            else (0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160)
        )
        sample_rate = (44100, 48000, 32000)[sample_index] // {3: 1, 2: 2, 0: 4}[version]
        samples = 1152 if version == 3 else 576
        frame_size = (144 if version == 3 else 72) * rates[bitrate_index] * 1000 // sample_rate + (
            (header >> 9) & 1
        )
        if offset + frame_size > len(data):
            raise AppError(
                "incomplete_speech_audio", "Speech audio was incomplete. Please retry.", 502
            )
        seconds += samples / sample_rate
        frames += 1
        offset += frame_size
    # A trailing ID3v1 tag is allowed; unexplained trailing data is not.
    trailing = data[offset:]
    if not frames or (trailing and not (len(trailing) == 128 and trailing.startswith(b"TAG"))):
        raise AppError("invalid_speech_audio", "Speech audio was invalid. Please retry.", 502)
    if seconds < max(0.2, len(text.split()) / 10):
        raise AppError(
            "incomplete_speech_audio",
            "Speech audio was too short for the saved reply. Please retry or use the text.",
            502,
        )


class LimitTurnBodyMiddleware:
    """Cap the complete multipart body before FastAPI creates upload spool files."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if not (
            scope["type"] == "http"
            and scope["method"] == "POST"
            and scope["path"].startswith("/api/calls/")
            and scope["path"].endswith("/turns")
        ):
            await self.app(scope, receive, send)
            return
        messages: list[Message] = []
        size = 0
        for name, value in scope.get("headers", []):
            if name.lower() == b"content-length":
                try:
                    size = int(value)
                except ValueError:
                    size = MAX_TURN_BODY_BYTES + 1
                break
        if size <= MAX_TURN_BODY_BYTES:
            size = 0
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return
                size += len(message.get("body", b""))
                if size > MAX_TURN_BODY_BYTES:
                    break
                messages.append(message)
                if not message.get("more_body", False):
                    break
        if size > MAX_TURN_BODY_BYTES:
            response = JSONResponse(
                {
                    "detail": {
                        "code": "request_too_large",
                        "message": "Turn uploads must be at most 3 MiB.",
                    }
                },
                status_code=413,
            )
            await response(scope, receive, send)
            return
        iterator = iter(messages)

        async def replay() -> Message:
            return next(iterator, None) or await receive()

        await self.app(scope, replay, send)


@dataclass(frozen=True)
class AudioInput:
    data: bytes
    filename: str
    content_type: str
    sha256: str


async def read_audio(upload: UploadFile) -> AudioInput:
    """Check MIME and container signatures; the provider validates the media itself."""
    try:
        data = await upload.read(MAX_AUDIO_BYTES + 1)
        if len(data) > MAX_AUDIO_BYTES:
            raise AppError(
                "audio_too_large", "Audio must be at most 2 MiB. Record a shorter utterance.", 413
            )
        if not data:
            raise AppError("empty_audio", "Record another utterance or use typed input.", 422)
        mime = (upload.content_type or "").split(";", 1)[0].strip().lower()
        extension = None
        canonical = None
        if mime in {"audio/webm", "video/webm"} and data.startswith(b"\x1a\x45\xdf\xa3"):
            extension, canonical = "webm", "audio/webm"
        elif mime in {"audio/ogg", "application/ogg"} and data.startswith(b"OggS"):
            extension, canonical = "ogg", "audio/ogg"
        elif mime in {"audio/mp4", "video/mp4", "audio/x-m4a"} and data[4:8] == b"ftyp":
            extension, canonical = "m4a", "audio/mp4"
        elif mime in {"audio/wav", "audio/x-wav", "audio/wave"} and (
            data.startswith(b"RIFF") and data[8:12] == b"WAVE"
        ):
            extension, canonical = "wav", "audio/wav"
        elif mime in {"audio/mpeg", "audio/mp3"} and (
            data.startswith(b"ID3") or (len(data) >= 2 and data[0] == 255 and data[1] & 224 == 224)
        ):
            extension, canonical = "mp3", "audio/mpeg"
        if extension is None:
            raise AppError(
                "unsupported_audio",
                "Upload WebM, Ogg, MP4/M4A, WAV, or MP3 audio with its matching content type.",
                415,
            )
        return AudioInput(
            data, f"utterance.{extension}", canonical, hashlib.sha256(data).hexdigest()
        )
    finally:
        # Uploaded customer audio is never retained after this request.
        await upload.close()


class SpeechCache:
    """An LRU cache in a private temporary directory; one speech request at a time."""

    def __init__(self, provider: OpenAIProvider):
        self.provider = provider
        self.directory = TemporaryDirectory(prefix="telecom-speech-")
        self.entries: OrderedDict[tuple[int, str], tuple[Path, int]] = OrderedDict()
        self.total_bytes = 0
        self.lock = asyncio.Lock()

    def discard(self, key: tuple[int, str]) -> None:
        entry = self.entries.pop(key, None)
        if entry is not None:
            path, size = entry
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass  # The private directory is also removed at shutdown.
            self.total_bytes -= size

    def discard_call(self, call_id: int) -> None:
        for key in list(self.entries):
            if key[0] == call_id:
                self.discard(key)

    async def get(self, key: tuple[int, str], verified_text: str) -> bytes:
        async with self.lock:
            entry = self.entries.get(key)
            if entry is not None:
                path, _ = entry
                try:
                    data = path.read_bytes()
                except OSError:
                    self.discard(key)
                else:
                    self.entries.move_to_end(key)
                    return data
            data = await self.provider.synthesize_verified_text(verified_text)
            if len(data) > MAX_SPEECH_BYTES:
                raise AppError(
                    "speech_too_large", "Generated speech was too large. Use the saved text.", 502
                )
            validate_speech_audio(data, verified_text)
            while self.entries and self.total_bytes + len(data) > MAX_CACHE_BYTES:
                self.discard(next(iter(self.entries)))
            path = Path(self.directory.name) / f"{key[1]}.mp3"
            try:
                path.write_bytes(data)
            except OSError:
                # Cache storage is optional; a valid generated reply can still be played.
                return data
            self.entries[key] = (path, len(data))
            self.total_bytes += len(data)
            return data

    def close(self) -> None:
        self.entries.clear()
        self.total_bytes = 0
        self.directory.cleanup()
