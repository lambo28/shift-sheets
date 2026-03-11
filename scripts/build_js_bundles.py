#!/usr/bin/env python3
import argparse
import hashlib
import importlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JS_ROOT = ROOT / "static" / "js"
BUNDLES_ROOT = JS_ROOT / "bundles"

BUNDLES = {
    "drivers.bundle.js": [
        "shared.core.js",
        "drivers.core.js",
        "drivers.form-handlers.js",
        "drivers.event-bindings.js",
        "drivers.calendar.js",
        "drivers.custom-timings.js",
        "drivers.page-init.js",
    ],
    "shifts.bundle.js": [
        "shared.core.js",
        "shifts.core.js",
        "shifts.form-handlers.js",
        "shifts.event-bindings.js",
    ],
    "scheduling.bundle.js": [
        "shared.core.js",
        "scheduling.flash-banner.js",
        "scheduling.core.js",
        "scheduling.event-bindings.js",
    ],
}

MANIFEST_FILE = "manifest.json"


def resolve_jsmin():
    try:
        module = importlib.import_module("rjsmin")
        return getattr(module, "jsmin", None)
    except Exception:
        return None


def build_bundle(bundle_name: str, files: list[str], minify: bool, jsmin_fn) -> tuple[str, str]:
    chunks: list[str] = [
        "/* Auto-generated bundle. Do not edit directly. */\n",
        f"/* Bundle: {bundle_name} */\n\n",
    ]

    for relative in files:
        src = JS_ROOT / relative
        if not src.exists():
            raise FileNotFoundError(f"Missing source JS file: {src}")
        chunks.append(f"\n/* ===== {relative} ===== */\n")
        chunks.append(src.read_text(encoding="utf-8"))
        chunks.append("\n")

    content = "".join(chunks)
    if minify and jsmin_fn is not None:
        content = jsmin_fn(content)

    digest = hashlib.sha256(content.encode("utf-8")).hexdigest()[:12]
    stem = bundle_name[:-3] if bundle_name.endswith(".js") else bundle_name
    hashed_name = f"{stem}.{digest}.js"
    output_path = BUNDLES_ROOT / hashed_name

    output_path.write_text(content, encoding="utf-8")
    print(f"Built {output_path.relative_to(ROOT)}")
    return bundle_name, hashed_name


def clean_old_bundles(manifest_values: set[str]) -> None:
    for existing in BUNDLES_ROOT.glob("*.js"):
        if existing.name not in manifest_values:
            existing.unlink(missing_ok=True)


def write_manifest(manifest: dict[str, str]) -> None:
    manifest_path = BUNDLES_ROOT / MANIFEST_FILE
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Updated {manifest_path.relative_to(ROOT)}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build cache-busted JS bundles")
    parser.add_argument(
        "--minify",
        action="store_true",
        help="Minify bundle output if rjsmin is installed",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    jsmin_fn = resolve_jsmin()
    BUNDLES_ROOT.mkdir(parents=True, exist_ok=True)

    if args.minify and jsmin_fn is None:
        print("Minify requested but rjsmin is not installed; building non-minified bundles.")

    manifest: dict[str, str] = {}
    for name, source_files in BUNDLES.items():
        key, hashed_name = build_bundle(name, source_files, minify=args.minify, jsmin_fn=jsmin_fn)
        manifest[key] = hashed_name

    clean_old_bundles(set(manifest.values()))
    write_manifest(manifest)


if __name__ == "__main__":
    main()
