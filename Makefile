NPM ?= npm

.PHONY: list install lint test ci run

list:
	@echo "Available targets:"
	@echo "  make list    — show this help"
	@echo "  make install — install npm dependencies (npm ci)"
	@echo "  make lint    — run ESLint"
	@echo "  make test    — run unit tests"
	@echo "  make ci      — install, lint, and test (GitHub Actions parity)"
	@echo "  make run     — run the development server via python (default port 8080)"

install:
	$(NPM) ci

lint:
	$(NPM) run lint

test:
	$(NPM) test

ci: install lint test

run:
	$(eval PORT ?= 8080)
	python3 -m http.server $(PORT)
