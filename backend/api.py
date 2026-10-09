"""Recommendation, approval, voice/text conversation, and dashboard APIs."""

import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Path, Query, Request, Response, UploadFile
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.audio import read_audio
from backend.dashboard import dashboard_metrics
from backend.database import get_session
from backend.errors import AppError
from backend.reads import customer_profile, list_recommendations
from backend.schemas import (
    ApproveRequest,
    CallResponse,
    CustomerResponse,
    DashboardResponse,
    EndCallRequest,
    ErrorResponse,
    HealthResponse,
    PositiveID,
    RecommendationListResponse,
    RecommendationResponse,
    RequestID,
    StartCallRequest,
    StartCallResponse,
    TurnResponse,
)

bearer = HTTPBearer(auto_error=False, description="Shared demo access token; never an OpenAI key.")


def require_demo_access(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> None:
    expected = request.app.state.settings.demo_access_token.get_secret_value()
    if not expected:
        return  # Local development can run without the demo gate.
    if credentials is None or not secrets.compare_digest(
        credentials.credentials.encode("utf-8"), expected.encode("utf-8")
    ):
        raise AppError("unauthorized", "A valid demo access token is required.", 401)


health_router = APIRouter(prefix="/api", tags=["Health"], responses={503: {"model": ErrorResponse}})


async def expire_stale_calls(request: Request) -> None:
    await request.app.state.workflow.expire()


router = APIRouter(
    prefix="/api",
    dependencies=[Depends(require_demo_access), Depends(expire_stale_calls)],
    responses={
        401: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        413: {"model": ErrorResponse},
        415: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
        502: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
        504: {"model": ErrorResponse},
    },
)
ResourceID = Annotated[int, Path(gt=0)]


@health_router.get("/health", response_model=HealthResponse)
def health(request: Request, session: Annotated[Session, Depends(get_session)]) -> HealthResponse:
    session.execute(text("SELECT 1"))
    return HealthResponse(
        ai_configured=bool(request.app.state.settings.openai_api_key.get_secret_value().strip())
    )


@router.get("/dashboard", response_model=DashboardResponse, tags=["Dashboard"])
def dashboard(session: Annotated[Session, Depends(get_session)]) -> DashboardResponse:
    """Phase 4: aggregate metrics from recommendations and saved call outcomes."""
    return dashboard_metrics(session)


@router.get("/recommendations", response_model=RecommendationListResponse, tags=["Recommendations"])
def recommendations(
    session: Annotated[Session, Depends(get_session)],
    search: Annotated[str | None, Query(max_length=150, description="Customer name search")] = None,
) -> RecommendationListResponse:
    """Phase 2: sort by score descending, savings descending, then customer ID ascending."""
    return list_recommendations(session, search)


@router.get("/customers/{customer_id}", response_model=CustomerResponse, tags=["Customers"])
def customer(
    customer_id: ResourceID, session: Annotated[Session, Depends(get_session)]
) -> CustomerResponse:
    """Phase 2: profile, three months of usage, recommendation, and previous call/result."""
    return customer_profile(session, customer_id)


@router.post(
    "/recommendations/{recommendation_id}/approve",
    response_model=RecommendationResponse,
    tags=["Recommendations"],
)
async def approve(
    recommendation_id: ResourceID, body: ApproveRequest, request: Request
) -> RecommendationResponse:
    """Phase 3: idempotent approval; approved_by is a demo label, not authenticated identity."""
    return await request.app.state.workflow.approve(recommendation_id, body)


@router.post("/calls", response_model=StartCallResponse, tags=["Calls"])
async def start_call(body: StartCallRequest, request: Request) -> StartCallResponse:
    """Phase 3: require approval and contact eligibility; retries reuse start_request_id."""
    return await request.app.state.workflow.start(body)


@router.get("/calls/{call_id}", response_model=CallResponse, tags=["Calls"])
async def call(call_id: ResourceID, request: Request) -> CallResponse:
    """Phase 3: state, immutable offer snapshot, ordered turns, and result; expire stale calls."""
    return await request.app.state.workflow.read(call_id)


@router.delete(
    "/calls/{call_id}",
    status_code=204,
    response_class=Response,
    tags=["Calls"],
    responses={403: {"model": ErrorResponse}},
)
async def delete_call(call_id: ResourceID, request: Request) -> None:
    """Development only: remove a closed call and allow its approved offer to be called again."""
    if request.app.state.settings.app_env != "development":
        raise AppError("development_only", "Call deletion is available only in development.", 403)
    await request.app.state.workflow.delete(call_id)


@router.post(
    "/calls/{call_id}/turns",
    response_model=TurnResponse,
    tags=["Calls"],
)
async def turn(
    call_id: ResourceID,
    request: Request,
    client_turn_id: Annotated[RequestID, Form()],
    audio: Annotated[
        UploadFile | None, File(description="Audio OR text, exactly one. Audio limit: 2 MiB.")
    ] = None,
    text: Annotated[str | None, Form(min_length=1, max_length=4000)] = None,
    interrupted_assistant_turn_id: Annotated[PositiveID | None, Form()] = None,
) -> TurnResponse:
    """Typed or recorded customer input; retries reuse client_turn_id within a call.

    The browser caps recordings at 20 seconds. The server caps files at 2 MiB and the
    complete multipart body at 3 MiB; validates MIME/container signatures; transcribes
    English speech; and sends the transcript through the same controller as typed input.
    Retry audio with the identical file, or the saved transcript as text, using the same ID.
    """
    if (audio is None) == (text is None):
        if audio is not None:
            await audio.close()
        raise AppError("invalid_turn_input", "Supply exactly one of text or audio.", 422)
    audio_input = await read_audio(audio) if audio is not None else None
    return await request.app.state.workflow.turn(
        call_id, client_turn_id, text, interrupted_assistant_turn_id, audio_input
    )


@router.get(
    "/calls/{call_id}/turns/{turn_id}/audio",
    response_class=Response,
    responses={
        200: {"content": {"audio/mpeg": {"schema": {"type": "string", "format": "binary"}}}},
    },
    tags=["Calls"],
)
async def turn_audio(call_id: ResourceID, turn_id: ResourceID, request: Request) -> Response:
    """Phase 4: generate/cache speech for a saved, verified assistant turn only."""
    data = await request.app.state.workflow.audio(call_id, turn_id)
    return Response(
        data,
        media_type="audio/mpeg",
        headers={"Cache-Control": "private, no-store", "X-AI-Generated": "true"},
    )


@router.post("/calls/{call_id}/end", response_model=CallResponse, tags=["Calls"])
async def end_call(call_id: ResourceID, body: EndCallRequest, request: Request) -> CallResponse:
    """Phase 3: idempotently close unresolved calls; preserve previously confirmed outcomes."""
    return await request.app.state.workflow.end(call_id, body)
