"""Loads the four-level config layer (events / categories / segments / regions)
plus lever catalog and prompts. Hot-reloadable — the S9 Config Switch calls reload().
"""
from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

import yaml

from .config import CONFIG_DIR


class ConfigStore:
    def __init__(self) -> None:
        self.events: dict[str, dict] = {}
        self.categories: dict[str, dict] = {}
        self.segments: dict[str, dict] = {}
        self.regions: dict[str, dict] = {}
        self.levers: dict[str, dict] = {}
        self.prompts: dict[str, Any] = {}
        self.benchmarks: dict[str, dict] = {}
        self.load()

    def _load_dir(self, sub: str) -> dict[str, dict]:
        out: dict[str, dict] = {}
        d = CONFIG_DIR / sub
        if not d.exists():
            return out
        for f in sorted(d.glob("*.yaml")):
            data = yaml.safe_load(f.read_text()) or {}
            out[data.get("key", f.stem)] = data
        return out

    def load(self) -> None:
        self.events = self._load_dir("events")
        self.categories = self._load_dir("categories")
        self.segments = self._load_dir("segments")
        self.regions = self._load_dir("regions")
        self.levers = yaml.safe_load((CONFIG_DIR / "levers.yaml").read_text()) or {}
        self.prompts = yaml.safe_load((CONFIG_DIR / "prompts.yaml").read_text()) or {}
        self.benchmarks = {}
        bdir = CONFIG_DIR / "benchmarks"
        if bdir.exists():
            for f in sorted(bdir.glob("*.json")):
                self.benchmarks[f.stem] = json.loads(f.read_text())

    def reload(self) -> None:
        self.load()

    # ---- accessors ----
    def event(self, key: str) -> dict:
        return self.events.get(key, {})

    def category(self, key: str) -> dict:
        return self.categories.get(key, {})

    def segment(self, key: str) -> dict:
        return self.segments.get(key, {})

    def region(self, key: str) -> dict:
        return self.regions.get(key, {})

    def segments_for(self, category: str, event: str | None = None) -> list[dict]:
        out = []
        for seg in self.segments.values():
            if seg.get("parent_category") != category:
                continue
            if event and event not in seg.get("applicable_events", []):
                continue
            out.append(seg)
        return out

    def benchmark(self, benchmark_key: str, unit: str) -> tuple[float | None, str]:
        """Return (median, source) from external benchmark files, or (None, '')."""
        for region_bench in self.benchmarks.values():
            seg = (region_bench.get("segments") or {}).get(benchmark_key)
            if seg and unit in seg:
                return float(seg[unit]), "external_index"
        return None, ""


store = ConfigStore()


@lru_cache(maxsize=1)
def get_store() -> ConfigStore:
    return store
