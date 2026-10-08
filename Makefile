# ContextVerity — developer entry points. CI calls these same targets.
# Requires Node 22 or 24 (Backstage-supported LTS). The repo pins Yarn 4 in
# .yarn/releases and every target invokes it with the selected Node.

SHELL := /usr/bin/env bash
NODE  ?= node
YARN  := $(NODE) $(CURDIR)/.yarn/releases/yarn-4.13.0.cjs
TS    := $(NODE) --require @backstage/cli/config/nodeTransform.cjs

.PHONY: help check-node install build lint typecheck format format-check test test-unit \
        test-integration test-e2e test-results benchmark benchmark-live verify site-check \
        docs-check telemetry-check audit secret-scan sbom demo demo-up demo-run demo-down demo-mcp clean

help: ## List targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-18s %s\n", $$1, $$2}'

check-node:
	@v=$$($(NODE) -p 'process.versions.node.split(".")[0]'); \
	if [[ "$$v" != 22 && "$$v" != 24 ]]; then \
	  echo "Node $$v is not supported; use Node 22 or 24 (see .nvmrc)"; exit 1; fi

install: check-node ## Install dependencies from the lockfile
	$(YARN) install --immutable

build: check-node ## Type-check and build all packages
	$(YARN) tsc
	$(YARN) backstage-cli repo build --all

lint: check-node ## ESLint across the repo
	$(YARN) backstage-cli repo lint

typecheck: check-node ## TypeScript type check
	$(YARN) tsc

format: ## Apply Prettier formatting
	$(YARN) prettier --write .

format-check: ## Check Prettier formatting
	$(YARN) prettier --check .

test: test-unit test-integration ## Unit + integration tests

test-unit: check-node ## Unit tests (core, common, provider, frontend)
	CI=1 $(YARN) backstage-cli repo test --coverage plugins/contextverity-common plugins/contextverity-core plugins/contextverity-node plugins/contextverity

test-integration: check-node ## Backend plugin on a test Backstage backend + core-tier scenarios
	CI=1 $(YARN) backstage-cli repo test plugins/contextverity-backend test/scenarios

test-e2e: check-node ## Scenarios against the running lab (requires make demo-up)
	source .demo/env && $(TS) scripts/run-scenarios.ts --tier backstage

test-results: check-node ## Regenerate machine-readable results in test-results/
	$(TS) scripts/run-scenarios.ts --tier core
	$(TS) scripts/benchmark.ts --tier core
	@if curl -sf -o /dev/null http://127.0.0.1:7007/.backstage/health/v1/readiness; then \
	  source .demo/env && $(TS) scripts/run-scenarios.ts --tier backstage && $(TS) scripts/benchmark.ts --tier backstage && $(TS) scripts/check-telemetry.ts; \
	else echo "lab not running: skipped backstage-tier results (make demo-up)"; fi
	$(NODE) scripts/results-summary.mjs
	$(NODE) scripts/render-results.mjs

benchmark: check-node ## In-process core benchmarks
	$(TS) scripts/benchmark.ts --tier core

benchmark-live: check-node ## Benchmarks against the running lab
	source .demo/env && $(TS) scripts/benchmark.ts --tier backstage

verify: format-check lint typecheck test docs-check ## Everything CI checks locally (except e2e)

docs-check: ## Relative Markdown links resolve; test-results are well-formed
	$(NODE) scripts/check-links.mjs
	$(NODE) scripts/results-summary.mjs --check

site-check: ## Run the website's own checks (sibling checkout ../contextverity.github.io)
	cd ../contextverity.github.io && $(NODE) scripts/check-site.mjs

telemetry-check: check-node ## Trace/metric checks against the running lab
	source .demo/env && $(TS) scripts/check-telemetry.ts

audit: ## Fail on critical advisories in the dependency tree
	$(YARN) npm audit --all --recursive --severity critical

secret-scan: ## gitleaks over the full git history
	scripts/ci/secret-scan.sh

sbom: ## CycloneDX SBOM of the workspace (uses cdxgen via npx)
	npx --yes @cdxgen/cdxgen@13.3.0 -t js -o sbom.cdx.json --no-install-deps .

demo: demo-up demo-run ## Start the lab and run the scripted demo

demo-up: check-node ## Start the local Backstage lab (backend + frontend)
	scripts/demo/up.sh

demo-run: check-node ## Run the deterministic demo against the lab (real calls)
	source .demo/env && $(TS) scripts/demo/run.ts

demo-mcp: check-node ## Same flow through the official Backstage MCP Actions endpoint
	source .demo/env && $(TS) scripts/demo/mcp-client.ts

demo-down: ## Stop the lab
	scripts/demo/down.sh

clean: ## Remove build output and demo state
	$(YARN) backstage-cli repo clean
	scripts/demo/down.sh --purge
