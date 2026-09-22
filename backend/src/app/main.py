from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers.api import router as api_router


def create_app() -> FastAPI:
    application = FastAPI(
        title="Refinery Copilot API",
        version=settings.contract_version,
        root_path="/api",
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list(),
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "Accept", "Last-Event-ID"],
    )
    application.include_router(api_router)
    application.state.core = None

    @application.on_event("startup")
    def _load_core() -> None:
        from app.services.core_bridge import AppState

        application.state.core = AppState.load()

    return application


app = create_app()
