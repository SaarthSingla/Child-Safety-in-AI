"""Release-integrity self-check. The shipped manifest must EXACTLY describe
the shipped file set: any missing, extra or modified file fails.

Run from inside the extracted bundle:  PYTHONPATH=. pytest tests/
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

BUNDLE = Path(__file__).resolve().parents[1]
_SKIP_PARTS = {"__pycache__"}
_SKIP_SUFFIX = {".pyc", ".pyo"}

pytestmark = pytest.mark.skipif(
    not (BUNDLE / "manifest.json").exists(),
    reason="release-integrity tests run inside an extracted release bundle (needs manifest.json)")


def _sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _manifest() -> dict:
    return json.loads((BUNDLE / "manifest.json").read_text())


def _on_disk() -> set:
    out = set()
    for p in BUNDLE.rglob("*"):
        if not p.is_file() or p.name == "manifest.json":
            continue
        if _SKIP_PARTS & set(p.parts) or p.suffix in _SKIP_SUFFIX:
            continue
        out.add(str(p.relative_to(BUNDLE)))
    return out


def test_manifest_present_and_shaped():
    m = _manifest()
    assert m["release_id"] == "childsafe-age-runtime-v1.1"
    assert isinstance(m["files"], dict) and m["files"]
    assert list(m["files"]) == sorted(m["files"]), "manifest file paths must be sorted"
    assert "component_versions" in m


def test_manifest_lists_exactly_the_shipped_files():
    expected = set(_manifest()["files"])
    on_disk = _on_disk()
    assert expected == on_disk, {
        "missing": sorted(expected - on_disk),
        "unexpected": sorted(on_disk - expected),
    }


def test_every_file_hash_matches():
    for rel, want in _manifest()["files"].items():
        got = _sha256(BUNDLE / rel)
        assert got == want, f"hash mismatch: {rel}"


def test_manifest_has_no_python_cache_entries():
    # the SHIPPED file set (per the manifest) contains no bytecode cache.
    # (a __pycache__ that a later `pytest tests/` writes into a working copy is
    #  not a release defect -- run tests with PYTHONDONTWRITEBYTECODE=1.)
    for rel in _manifest()["files"]:
        assert "__pycache__" not in rel.split("/")
        assert not rel.endswith((".pyc", ".pyo"))


def test_no_private_key_material_in_bundle():
    for p in BUNDLE.rglob("*"):
        if not p.is_file():
            continue
        assert "private" not in p.name.lower(), f"suspicious filename: {p}"
        if p.suffix in (".jwk", ".json") and "credential" in str(p):
            blob = p.read_text().replace(" ", "").replace("\n", "")
            assert '"d":' not in blob, f"possible private JWK component in {p}"
