from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    cors_origins: str = "http://localhost:5173"
    contract_version: str = "1.0.0"
    core_version: str = "0.1.0"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]


settings = Settings()
