from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers.system import router as system_router


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
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.include_router(system_router)
    return application


app = create_app()
