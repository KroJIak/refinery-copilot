# Единый интерфейс запуска «Refinery Copilot».
.DEFAULT_GOAL := help
API_PORT ?= 8000
VITE_PORT ?= 5173
.PHONY: help data train demo run ui test lint up down mocks

help: ## показать список целей
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*## / {printf "  \033[36m%-8s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

.venv: ## окружение uv из lock
	uv sync --group dev

data: .venv ## инжест и чистка (ещё не подключены к CLI)
	@echo "make data: пайплайн инжеста в этом срезе не вызывается. Сырьё уже в data/raw, quality-датасет в data/processed."

train: .venv ## обучение (бандлы уже зафиксированы)
	@echo "make train: модели зафиксированы в artifacts/models. Повторный бустинг не нужен."

demo: .venv ## 4 демо-сценария, включая отказ bad_data
	uv run python -m refinery_core.cli demo

run: .venv ## uvicorn api (ещё не делаем)
	@echo "API не в этом заходе"

ui: .venv ## vite dev
	cd frontend && npm run dev -- --port $(VITE_PORT)

test: .venv ## pytest ядра
	uv run pytest

lint: .venv ## ruff
	uv run ruff check core/src core/tests && uv run ruff format --check core/src core/tests

up: ## docker compose
	docker compose up -d --build

down: ## остановить контейнеры
	docker compose down

mocks: ## фронт на моках
	cd frontend && VITE_USE_MOCKS=true npm run dev
