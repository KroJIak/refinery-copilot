---
title: "frontend — установка и каркас проекта"
tags: [refinery-copilot, frontend, vite, tailwind, echarts, setup]
related:
  - "[[frontend/00-OVERVIEW]]"
  - "[[02-types]]"
  - "[[05-mocks]]"
  - "[[06-p6-openapi-ts-mocks]]"
created: 2026-09-19
---

# 01 — Установка и каркас проекта

Цель: новый разработчик поднимает рабочее приложение **за одну команду** и работает на моках
без backend. Стек зафиксирован: React 18 + Vite +
TypeScript strict + Tailwind v4 + ECharts + лёгкий стор (zustand, см. [[06-state]]).

## Scope

Содержит: создание проекта, зависимости, `vite.config.ts`, структура каталогов `src/features/*`,
скрипты, переменные окружения, eslint, запуск dev-сервера с моками, краткие Dockerfile/nginx.conf
(по месту). НЕ содержит: типы ([[02-types]]), сервисы ([[03-service-rest]], [[04-service-sse]]),
моки ([[05-mocks]]), стор ([[06-state]]), дизайн-систему за пределами нужного.

## Создание проекта

```bash
npm create vite@latest frontend -- --template react-ts
cd frontend
npm i
npm i zustand echarts echarts-for-react
npm i -D tailwindcss @tailwindcss/vite eslint @eslint/js typescript-eslint eslint-plugin-react-hooks
```

> [!note] React 18 vs 19
> Свежий шаблон Vite может подтянуть React 19 — это допустимо: наша API-поверхность
> (hooks + fetch/EventSource) одинакова. Требование — **не использовать server components**
> и прочие фичи, ломающие SPA-сборку.

## `tsconfig` — strict

`tsconfig.app.json` (шаблон уже близок; проверить все флаги):

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src"]
}
```

## `vite.config.ts`

Tailwind v4 подключается плагином `@tailwindcss/vite` (конфиг `tailwind.config.js` не нужен,
тема — через `@theme` в CSS); proxy `/api` на dev-backend; alias `@`.

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:8000',
        // без этого SSE буферизуется и события приходят пачками
        proxyTimeout: 0,
      },
    },
  },
});
```

Входной CSS `src/index.css`: `@import "tailwindcss";` + `@theme` с палитрой статусов
(ok/warn/stale/missing — цвета бейджей свежести из [[02-data-freshness]]).

## Структура каталогов

```text
frontend/
├── Dockerfile                  # node:20-alpine build → nginx:1.27-alpine
├── nginx.conf                  # /api → api:8000, proxy_buffering off (SSE!)
├── index.html
├── vite.config.ts
└── src/
    ├── main.tsx                # StrictMode + роутер-минимум (вкладки)
    ├── App.tsx                 # лейаут: вкладки 6 экранов
    ├── index.css               # @import "tailwindcss" + @theme
    ├── types/                  # ← [[02-types]]: dto.ts (ручные зеркала), api.gen.ts (кодоген)
    ├── services/               # ← [[03-service-rest]] client.ts; [[04-service-sse]] sse.ts
    ├── mocks/                  # ← [[05-mocks]]: fixtures/, mockRest.ts, mockSse.ts, index.ts
    ├── store/                  # ← [[06-state]]: store.ts, slices/, selectors.ts
    ├── components/             # timeseries/ · recommendation/ · agents/ · whatif/ · ui/
    ├── features/               # экраны по фичам: dashboard/ · recommendation/ · whatif/
    │   ├── dashboard/          #   mnemonic/ · models/ · reporter/
    │   ├── recommendation/
    │   ├── whatif/
    │   ├── mnemonic/
    │   ├── models/
    │   └── reporter/
    └── api/                    # утилиты fetch-слоя (ошибки, таймауты) → импортирует services
```

Правило слоёв: `features/*` и `components/*` импортируют только `store/`, `components/ui/` и свои
файлы; ни одна страница не импортирует `services/` напрямую (см. правило 1 в [[frontend/00-OVERVIEW]]).

## Скрипты `package.json`

| Скрипт | Команда | Назначение |
| --- | --- | --- |
| `dev` | `vite` | dev-сервер :5173, proxy `/api` |
| `dev:mock` | `vite --mode mock` | dev-сервер с принудительным `VITE_USE_MOCKS=true` |
| `build` | `tsc -b && vite build` | типы + прод-сборка |
| `preview` | `vite preview` | локальный просмотр сборки |
| `lint` | `eslint .` | линт |
| `typecheck` | `tsc -b --noEmit` | только типы (для CI) |
| `gen:api` | см. [[06-p6-openapi-ts-mocks]] | регенерация `src/types/api.gen.ts` из OpenAPI |

## Переменные окружения

Только переменные с префиксом `VITE_` попадают в браузерный бандл. `.env.example` коммитится,
`.env` — нет.

| Переменная | По умолчанию | Назначение |
| --- | --- | --- |
| `VITE_API_BASE` | `/api` | база REST/SSE; в dev — через proxy, в проде — nginx |
| `VITE_USE_MOCKS` | `false` | `true` → сервисы подменяются моками ([[05-mocks]]), backend не нужен |
| `VITE_PROXY_TARGET` | `http://localhost:8000` | цель dev-proxy (для live-режима) |

> [!warning] Один флаг мок-режима
> Канонический флаг — `VITE_USE_MOCKS=true|false` (см. [[05-mocks]]); флаг ровно один.
> Вариант `VITE_API_MODE=mock|live`
> из черновика P6 ([[06-p6-openapi-ts-mocks]]) каноном не является и не используется;
> реализация ([[05-mocks]]) читает единственный флаг.

## ESLint

Плоский конфиг `eslint.config.js`: `@eslint/js` (recommended) + `typescript-eslint` (recommended)
+ `eslint-plugin-react-hooks` (правила хуков). Дополнительно включить:

- `@typescript-eslint/no-explicit-any` — error (типы строго из [[02-types]]);
- `no-restricted-imports` — запрет импорта `services/*` из `src/features/**` и `src/pages/**`
  (машинно проверяет правило «страницы не зовут API напрямую»).

## Запуск: два режима

```bash
# 1) Автономно, без backend (дефолт для нового разработчика)
npm ci && npm run dev:mock          # фикстуры + мок-SSE из [[05-mocks]]

# 2) С живым backend
make run                            # uvicorn :8000 (из delivery-infra)
cd frontend && VITE_USE_MOCKS=false npm run dev
```

Проверка живости: `GET /api/health` → `{status, contract, core, modelsLoaded}` ([[01-p1-rest-sse]]).

## Dockerfile и nginx.conf (кратко, по месту)

- `Dockerfile`: multi-stage — stage 1 `node:20-alpine` (`npm ci && npm run build`),
  stage 2 `nginx:1.27-alpine` с копией `dist/` и `nginx.conf`; non-root не критичен, но приветствуется.
- `nginx.conf`: `location /api { proxy_pass http://api:8000; proxy_buffering off; proxy_read_timeout 3600s; }`
  — без `proxy_buffering off` SSE-события копятся и приходят пачками; SPA-fallback `try_files … /index.html`.
- Порты и `depends_on: service_healthy` задаёт compose — см. P7 в delivery-infra.
