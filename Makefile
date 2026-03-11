PYTHON ?= python3
VENV_PY := $(if $(wildcard venv/bin/python),venv/bin/python,$(PYTHON))

.PHONY: help build-js build-js-min clean-js

help:
	@echo "Available targets:"
	@echo "  make build-js      Build cache-busted JS bundles + manifest"
	@echo "  make build-js-min  Build bundles with minify flag (uses rjsmin if installed)"
	@echo "  make clean-js      Remove generated JS bundles and manifest"

build-js:
	$(VENV_PY) scripts/build_js_bundles.py

build-js-min:
	$(VENV_PY) scripts/build_js_bundles.py --minify

clean-js:
	rm -f static/js/bundles/*.js static/js/bundles/manifest.json
