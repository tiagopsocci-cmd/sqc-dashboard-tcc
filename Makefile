SHELL := /bin/sh
.DEFAULT_GOAL := help

COMPOSE ?= docker compose
APP_URL ?= http://127.0.0.1:8080
E2E_COMPOSE_FILE ?= docker-compose.e2e.yml
E2E_COMPOSE_PROJECT ?= sqc-dashboard-e2e
E2E_FRONTEND_PORT ?= 18080
E2E_BASE_URL ?= http://127.0.0.1:$(E2E_FRONTEND_PORT)
E2E_COMPOSE = E2E_COMPOSE_PROJECT=$(E2E_COMPOSE_PROJECT) E2E_FRONTEND_PORT=$(E2E_FRONTEND_PORT) $(COMPOSE) -p $(E2E_COMPOSE_PROJECT) -f $(E2E_COMPOSE_FILE)

.PHONY: help setup dev up down logs test lint typecheck build verify seed reset-demo e2e e2e-down sanitize compose-config compose-config-e2e

help: ## Lista os comandos disponíveis
	@printf '%s\n' \
	  'setup        valida pré-requisitos e prepara as imagens' \
	  'dev          sobe a aplicação em primeiro plano' \
	  'up           sobe a aplicação em segundo plano' \
	  'down         encerra a aplicação sem apagar dados' \
	  'logs         acompanha os logs' \
	  'test         executa testes backend, frontend e e2e' \
	  'lint         executa lint backend, frontend e e2e' \
	  'typecheck    executa checagem de tipos' \
	  'build        constrói as imagens' \
	  'verify       executa os gates estáticos e testes locais' \
	  'seed         reaplica o seed sintético idempotente' \
	  'reset-demo   APAGA volumes e recria a demonstração' \
	  'e2e          testa em projeto/volumes isolados e sempre limpa' \
	  'e2e-down     remove somente o projeto e os volumes E2E' \
	  'sanitize     procura conteúdo inadequado ao compartilhamento'

setup: compose-config sanitize ## Prepara ferramentas locais e imagens
	cd backend && uv sync --frozen
	pnpm --dir frontend install --frozen-lockfile
	pnpm --dir e2e install --frozen-lockfile
	$(MAKE) build
	@printf 'Preparado. Execute "make up" e abra %s\n' "$(APP_URL)"

dev: ## Sobe a pilha anexada aos logs
	$(COMPOSE) up --build

up: ## Sobe a pilha em segundo plano
	$(COMPOSE) up --build --wait
	@printf 'Aplicação disponível em %s\n' "$(APP_URL)"

down: ## Encerra a pilha preservando volumes
	$(COMPOSE) down --remove-orphans

logs: ## Acompanha os logs da pilha
	$(COMPOSE) logs --follow --tail=200

build: ## Constrói imagens reproduzíveis
	$(COMPOSE) build

test: ## Executa todas as suítes disponíveis
	cd backend && uv run python -m pytest
	pnpm --dir frontend test
	$(MAKE) e2e

lint: ## Executa linters sem alterar arquivos
	cd backend && uv run ruff check .
	pnpm --dir frontend lint
	pnpm --dir e2e lint

typecheck: ## Executa checagens de tipos
	cd backend && uv run pyright
	pnpm --dir frontend typecheck
	pnpm --dir e2e typecheck

compose-config: compose-config-e2e ## Valida as configurações do Compose
	$(COMPOSE) config --quiet

compose-config-e2e: ## Valida o Compose isolado de E2E
	$(E2E_COMPOSE) config --quiet

sanitize: ## Verifica vazamentos e arquivos proibidos
	python -I .github/scripts/sanitize.py .

verify: compose-config sanitize lint typecheck build test ## Gate local equivalente à CI

seed: ## Executa somente o seed sintético idempotente
	$(COMPOSE) up -d db
	$(COMPOSE) run --rm migrate
	$(COMPOSE) run --rm seed

reset-demo: ## Apaga dados locais e recria a base sintética
	@if [ "$(CONFIRM_RESET)" != "RESET" ]; then \
		printf '%s\n' 'Operação destrutiva bloqueada.' 'Execute: make reset-demo CONFIRM_RESET=RESET'; \
		exit 2; \
	fi
	$(COMPOSE) down --volumes --remove-orphans
	$(COMPOSE) up --build --wait
	@printf 'Base sintética recriada em %s\n' "$(APP_URL)"

e2e: compose-config-e2e ## Executa Playwright numa pilha descartável e isolada
	@set -eu; \
	cleanup() { \
		status=$$?; \
		trap - EXIT HUP INT TERM; \
		$(E2E_COMPOSE) down --volumes --remove-orphans; \
		exit $$status; \
	}; \
	trap cleanup EXIT HUP INT TERM; \
	$(E2E_COMPOSE) down --volumes --remove-orphans; \
	$(E2E_COMPOSE) up -d --build --wait; \
	E2E_BASE_URL=$(E2E_BASE_URL) pnpm --dir e2e test

e2e-down: ## Remove somente a pilha e os volumes descartáveis de E2E
	$(E2E_COMPOSE) down --volumes --remove-orphans
