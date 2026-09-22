# Единый интерфейс запуска «Refinery Copilot».
.DEFAULT_GOAL := help
API_PORT ?= 8000
VITE_PORT ?= 5173
.PHONY: help data train demo run ui test lint up down mocks

help: ## показать список целей
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*## / {printf "  \033[36m%-8s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

.venv: ## окружение uv из lock
	uv sync --group dev

data: .venv ## инжест: raw → data/processed/quality_datasets
	uv run python -m refinery_core.cli data

train: .venv ## обучение зафиксированных бандлов → artifacts/models
	uv run python -m refinery_core.cli train

demo: .venv ## 4 демо-сценария, включая отказ bad_data
	uv run python -m refinery_core.cli demo

run: .venv ## api на :$(API_PORT)
	uv run uvicorn app.main:app --app-dir backend/src --host 0.0.0.0 --port $(API_PORT)

ui: .venv ## vite dev
	cd frontend && npm run dev -- --port $(VITE_PORT)

test: .venv ## pytest ядра
	uv run pytest

lint: .venv ## ruff
	uv run ruff check core/src core/tests && uv run ruff format --check core/src core/tests

up: ## docker compose
	mkdir -p artifacts/runs artifacts/timeline
	docker compose up -d --build

down: ## остановить контейнеры
	docker compose down

mocks: ## поднять интерфейс без api
	cd frontend && VITE_USE_MOCKS=true npm run dev
