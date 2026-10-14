"""Per-process OpenAI budgets and visitor identity for the Render demo."""

from ipaddress import IPv6Address, ip_address
from threading import Lock

from fastapi import Request

from backend.errors import AppError

USAGE_LIMIT_MESSAGE = "This demo has reached its usage limit. Please try again later."


def client_ip(request: Request) -> str:
    """Read headers supplied by Render's trusted public edge, then the peer IP.

    Prefer Cloudflare's single client IP when available: X-Forwarded-For can
    contain a visitor-supplied prefix. Forwarded headers require a trusted proxy;
    this deployment's public traffic goes through Render's Cloudflare edge.
    """
    candidates = [
        request.headers.get("cf-connecting-ip", ""),
        request.headers.get("x-forwarded-for", "").split(",", 1)[0],
        request.client.host if request.client else "",
    ]
    for candidate in candidates:
        try:
            address = ip_address(candidate.strip())
        except ValueError:
            continue
        if isinstance(address, IPv6Address) and address.ipv4_mapped:
            address = address.ipv4_mapped
        return str(address)
    # Missing/malformed identities share a bucket rather than bypassing the cap.
    return "unknown"


class OpenAIUsageLimiter:
    """Reserve one outbound attempt atomically; never refund failed requests."""

    def __init__(self, total_limit: int, visitor_limit: int):
        self.total_limit = total_limit
        self.visitor_limit = visitor_limit
        self.total_calls = 0
        self.visitor_calls: dict[str, int] = {}
        self._lock = Lock()

    def reserve(self, visitor_ip: str) -> None:
        # No provider I/O under the lock. Both checks and increments are one step
        # across concurrent tasks/threads, including different OpenAI operations.
        with self._lock:
            used = self.visitor_calls.get(visitor_ip, 0)
            if self.total_calls >= self.total_limit or used >= self.visitor_limit:
                raise AppError("demo_usage_limit", USAGE_LIMIT_MESSAGE, 429)
            self.total_calls += 1
            self.visitor_calls[visitor_ip] = used + 1
