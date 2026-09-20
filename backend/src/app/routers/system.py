from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from app.config import settings

router = APIRouter(prefix="/api", tags=["system"])


class HealthResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    status: str
    contract: str
    core: str
    models_loaded: int


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        status="degraded",
        contract=settings.contract_version,
        core=settings.core_version,
        models_loaded=0,
    )
