NPM ?= npm

.PHONY: list install lint test ci run patch-gemma patch-bonsai

list:
	@echo "Available targets:"
	@echo "  make list         — show this help"
	@echo "  make install      — install npm dependencies (npm ci)"
	@echo "  make lint         — run ESLint"
	@echo "  make test         — run unit tests"
	@echo "  make ci           — install, lint, and test (GitHub Actions parity)"
	@echo "  make patch-gemma  — apply tool-calling patch to gemma-4-e2b.js"
	@echo "  make patch-bonsai — apply runtime patch to bonsai-27b.js"
	@echo "  make run          — run the development server via python (default port 8080)"

install:
	$(NPM) ci

lint:
	$(NPM) run lint

test:
	$(NPM) test

ci: install lint test

patch-gemma:
	node scripts/patch-gemma-tool-support.mjs

patch-bonsai:
	node scripts/patch-bonsai-runtime.mjs

run:
	$(eval PORT ?= 8080)
	python3 -m http.server $(PORT)
