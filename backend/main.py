import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException

from backend import models  # noqa: F401 -- registers every table with Base.metadata
from backend.api import health_router, router
from backend.audio import LimitTurnBodyMiddleware, SpeechCache
from backend.config import Settings
from backend.database import Base, build_engine, build_session_factory
from backend.errors import AppError
from backend.migrations import upgrade_database
from backend.providers import OpenAIProvider
from backend.recommendations import generate_recommendations
from backend.seed import seed_demo_data
from backend.workflow import CallWorkflow

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    config = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        engine = build_engine(config.database_url)
        provider = OpenAIProvider(config)
        speech_cache = SpeechCache(provider)
        try:
            Base.metadata.create_all(engine)
            upgrade_database(engine)
            app.state.session_factory = build_session_factory(engine)
            app.state.provider = provider
            app.state.workflow = CallWorkflow(app.state.session_factory, provider, speech_cache)
            with app.state.session_factory.begin() as session:
                seed_demo_data(session)
                generate_recommendations(session)
            yield
        finally:
            speech_cache.close()
            await provider.close()
            engine.dispose()

    app = FastAPI(
        title="Telecom Offer Advisor API",
        version="0.5.0",
        description=(
            "Phase 5: employee approval, voice and typed AI conversations, verified replies, "
            "saved outcomes, temporary speech caching, and dashboard estimates. "
            "Money uses integer minor units (100 = 1 AZN); timestamps use UTC. "
            "Accepted means confirmed interest for employee processing, never activation."
        ),
        lifespan=lifespan,
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
    )
    app.state.settings = config
    app.add_middleware(LimitTurnBodyMiddleware)

    if config.cors_origins:
        from fastapi.middleware.cors import CORSMiddleware

        app.add_middleware(
            CORSMiddleware,
            allow_origins=config.cors_origins,
            allow_methods=["GET", "POST", "DELETE"],
            allow_headers=["Authorization", "Content-Type"],
        )

    @app.exception_handler(AppError)
    async def app_error_handler(_request: Request, exc: AppError) -> JSONResponse:
        headers = {"WWW-Authenticate": "Bearer"} if exc.status_code == 401 else None
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": {"code": exc.code, "message": exc.message}},
            headers=headers,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
        # Avoid reflecting raw request bodies, customer speech, or authentication headers.
        fields = sorted({".".join(str(part) for part in error["loc"]) for error in exc.errors()})
        return JSONResponse(
            status_code=422,
            content={
                "detail": {
                    "code": "validation_error",
                    "message": "Invalid fields: " + ", ".join(fields),
                }
            },
        )

    @app.exception_handler(HTTPException)
    async def http_error_handler(_request: Request, exc: HTTPException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": {"code": f"http_{exc.status_code}", "message": str(exc.detail)}},
            headers=exc.headers,
        )

    @app.exception_handler(SQLAlchemyError)
    async def database_error_handler(_request: Request, _exc: SQLAlchemyError) -> JSONResponse:
        logger.error("Database operation failed")
        return JSONResponse(
            status_code=503,
            content={
                "detail": {
                    "code": "database_unavailable",
                    "message": "Database unavailable. Please retry.",
                }
            },
        )

    app.include_router(health_router)
    app.include_router(router)

    @app.api_route(
        "/api/{path:path}",
        methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        include_in_schema=False,
    )
    def unknown_api(path: str):
        raise AppError("not_found", "API endpoint not found.", 404)

    # Hash routing needs no SPA rewrite. API routes take precedence over static files.
    if (config.static_dir / "index.html").is_file():
        app.mount("/", StaticFiles(directory=config.static_dir, html=True), name="frontend")
    else:

        @app.get("/", response_class=HTMLResponse, include_in_schema=False)
        def shell() -> str:
            return (
                "<!doctype html><html lang='en'><meta charset='utf-8'>"
                "<meta name='viewport' content='width=device-width, initial-scale=1'>"
                "<title>Telecom Offer Advisor</title><body>"
                "<h1>Telecom Offer Advisor</h1><p>Phase 5 backend is running.</p>"
                "<p>Resettable demo data. Browser calls are simulated.</p>"
                "<p><a href='/api/docs'>API contracts</a> · "
                "<a href='/api/health'>Service health</a></p></body></html>"
            )

    return app


app = create_app()
