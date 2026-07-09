NPM ?= npm

.PHONY: list install lint test ci

list:
	@echo "Available targets:"
	@echo "  make list    — show this help"
	@echo "  make install — install npm dependencies (npm ci)"
	@echo "  make lint    — run ESLint"
	@echo "  make test    — run unit tests"
	@echo "  make ci      — install, lint, and test (GitHub Actions parity)"

install:
	$(NPM) ci

lint:
	$(NPM) run lint

test:
	$(NPM) test

ci: install lint test

run: python3 -m http.server 8080
