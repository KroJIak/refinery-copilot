FROM python:3.12-slim AS builder
COPY --from=ghcr.io/astral-sh/uv:0.7.12 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY core/ core/
COPY backend/ backend/
RUN uv sync --frozen --no-dev --package refinery-copilot-api

FROM python:3.12-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -r app && useradd -r -g app app
WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/backend /app/backend
COPY --from=builder /app/core /app/core
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DATA_DIR=/app/data \
    ARTIFACTS_DIR=/app/artifacts
USER app
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2).status == 200 else 1)"
CMD ["uvicorn", "app.main:app", "--app-dir", "/app/backend/src", "--host", "0.0.0.0", "--port", "8000"]
