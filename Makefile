# Единый интерфейс запуска «Refinery Copilot».
.DEFAULT_GOAL := help
API_PORT ?= 8000
VITE_PORT ?= 5173
PORT ?=
.PHONY: help data train demo run ui web test lint up down

# PORT перекрывает порт цели: make ui PORT=5174, make run PORT=8001
ui_port = $(if $(PORT),$(PORT),$(VITE_PORT))
api_port = $(if $(PORT),$(PORT),$(API_PORT))

define require-free-port
	@python3 -c "import socket,sys; p=int(sys.argv[1]); s=socket.socket(); s.settimeout(0.4); r=s.connect_ex(('127.0.0.1',p)); s.close(); sys.exit(0 if r else 1)" $(1) \
		|| { echo "порт $(1) занят. укажите другой: make $(2) PORT=...."; exit 1; }
endef

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

run: .venv ## запустить сервер на порту 8000. если занят: make run PORT=8001
	$(call require-free-port,$(api_port),run)
	uv run uvicorn app.main:app --app-dir backend/src --host 0.0.0.0 --port $(api_port)

ui: .venv ## только страница, без расчёта. для сайта целиком: make web
	$(call require-free-port,$(ui_port),ui)
	cd frontend && npm run dev -- --port $(ui_port) --strictPort

web: .venv ## сайт и расчёт одной командой: http://127.0.0.1:5173
	$(call require-free-port,$(api_port),web)
	$(call require-free-port,$(ui_port),web)
	@bash -eu -c 'cleanup() { [ -n "$${api:-}" ] && kill "$$api" 2>/dev/null || true; [ -n "$${ui:-}" ] && kill "$$ui" 2>/dev/null || true; wait "$${api:-}" "$${ui:-}" 2>/dev/null || true; }; trap cleanup EXIT INT TERM; uv run uvicorn app.main:app --app-dir backend/src --host 127.0.0.1 --port $(api_port) & api=$$!; ok=0; for _ in $$(seq 1 80); do python3 -c "import urllib.request; urllib.request.urlopen(\"http://127.0.0.1:$(api_port)/health\", timeout=0.4)" >/dev/null 2>&1 && ok=1 && break; sleep 0.25; done; [ "$$ok" = 1 ]; echo "расчёт http://127.0.0.1:$(api_port)  сайт http://127.0.0.1:$(ui_port)"; cd frontend && VITE_PROXY_TARGET=http://127.0.0.1:$(api_port) npm run dev -- --host 127.0.0.1 --port $(ui_port) --strictPort & ui=$$!; wait $$ui'

test: .venv ## pytest ядра
	uv run pytest

lint: .venv ## ruff
	uv run ruff check core/src core/tests && uv run ruff format --check core/src core/tests

up: ## docker compose
	mkdir -p artifacts/runs artifacts/timeline
	docker compose up -d --build

down: ## остановить контейнеры
	docker compose down
