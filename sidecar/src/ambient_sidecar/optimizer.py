"""Ask/tell optimizers over [0, 1]^d, run one generation at a time (decision 0053).

A run is a folder under the data root that the server makes. `optimizer_start` reads the run's
`spec.json` and writes its `state.json`; `optimizer_ask` writes the next points to a file the
server names and records them as pending; `optimizer_tell` reads those points back with their
scores, updates the optimizer and clears the pending points. The state is written after each ask
and each tell, by a rename, so a sidecar started again reads the run where the last one left
it. Higher scores are better.

An optimizer is a class in `OPTIMIZERS`, made from the spec and the state it last saved. Step
5e adds CMA-ES; the scripted optimizer here answers points the spec lists, for tests.
"""

import json
import math
import os
from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol

from ambient_sidecar.protocol import Handler

SPEC = "spec.json"
STATE = "state.json"

Point = list[float]


class Optimizer(Protocol):
    def ask(self, count: int) -> list[Point]:
        """The next `count` points, each in [0, 1]^d."""
        ...

    def tell(self, points: list[Point], scores: list[float]) -> None:
        """Takes the points `ask` gave last, in order, with a score for each."""
        ...

    def state(self) -> dict[str, Any]:
        """What the factory needs to make this optimizer again, as JSON."""
        ...


class Spec:
    """A run's spec: the optimizer's name, the dimension, the start point, a seed, and the
    optimizer's own settings."""

    def __init__(self, record: dict[str, Any]) -> None:
        optimizer = record.get("optimizer")
        if not isinstance(optimizer, str) or optimizer not in OPTIMIZERS:
            raise ValueError(
                f"the spec's optimizer must be one of {sorted(OPTIMIZERS)}, got {optimizer!r}"
            )
        start = _list(record.get("start"), "the spec's start")
        if len(start) == 0:
            raise ValueError("the spec's start must hold at least one position")
        self.start = _point(start, len(start), "the spec's start")
        seed = record.get("seed")
        if not isinstance(seed, int) or isinstance(seed, bool) or seed < 0:
            raise ValueError(f"the spec's seed must be a whole number from 0, got {seed!r}")
        settings = record.get("settings")
        if not isinstance(settings, dict):
            raise ValueError("the spec has no settings object")
        for key in record:
            if key not in ("optimizer", "start", "seed", "settings"):
                raise ValueError(f"the spec has {key}, which no optimizer reads")
        self.optimizer = optimizer
        self.seed = seed
        self.settings: dict[str, Any] = settings  # pyright: ignore[reportUnknownMemberType]
        self.dimension = len(self.start)


# Makes an optimizer from the spec and the state it saved, or None for a new run.
Factory = Callable[[Spec, dict[str, Any] | None], Optimizer]


def _is_position(value: object) -> bool:
    return (
        isinstance(value, int | float)
        and not isinstance(value, bool)
        and math.isfinite(value)
        and 0 <= value <= 1
    )


def _list(value: object, what: str) -> list[object]:
    if not isinstance(value, list):
        raise ValueError(f"{what} must be a list")
    items: list[object] = value  # pyright: ignore[reportUnknownVariableType]
    return items


def _point(value: object, dimension: int, what: str) -> Point:
    items = _list(value, what)
    if len(items) != dimension:
        raise ValueError(f"{what} must be a list of {dimension} positions")
    if not all(_is_position(u) for u in items):
        raise ValueError(f"{what} must hold positions from 0 to 1, got {json.dumps(items)}")
    return [float(u) for u in items]  # pyright: ignore[reportArgumentType]


def _points(value: object, dimension: int, what: str) -> list[Point]:
    return [_point(p, dimension, f"{what}[{i}]") for i, p in enumerate(_list(value, what))]


class ScriptedOptimizer:
    """Answers the points `settings.points` lists, in order, and keeps the best point told. A
    test writes the points; an ask past the end raises."""

    def __init__(self, spec: Spec, state: dict[str, Any] | None) -> None:
        self.script = _points(spec.settings.get("points"), spec.dimension, "settings.points")
        self.next: int = 0 if state is None else int(state["next"])
        self.best: Point | None = None if state is None else state["best"]
        self.best_score: float | None = None if state is None else state["bestScore"]

    def ask(self, count: int) -> list[Point]:
        if self.next + count > len(self.script):
            raise ValueError(
                f"the script has {len(self.script) - self.next} points left, and {count} were asked"
            )
        points = self.script[self.next : self.next + count]
        self.next += count
        return points

    def tell(self, points: list[Point], scores: list[float]) -> None:
        for point, score in zip(points, scores, strict=True):
            if self.best_score is None or score > self.best_score:
                self.best, self.best_score = point, score

    def state(self) -> dict[str, Any]:
        return {"next": self.next, "best": self.best, "bestScore": self.best_score}


OPTIMIZERS: dict[str, Factory] = {"scripted": ScriptedOptimizer}


def _read_json(path: Path) -> dict[str, Any]:
    value: object = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} doesn't hold a JSON object")
    record: dict[str, Any] = value  # pyright: ignore[reportUnknownVariableType]
    return record


def _write_new(path: Path, value: dict[str, Any]) -> None:
    """Refuses a file that exists, since the server names a fresh one per request."""
    with path.open("x", encoding="utf-8") as file:
        file.write(json.dumps(value, allow_nan=False, separators=(",", ":")))


def _save_state(run: Path, state: dict[str, Any]) -> None:
    """Writes the state by a rename, so a sidecar killed mid-write leaves the last state whole."""
    partial = run / f"{STATE}.partial"
    partial.write_text(json.dumps(state, allow_nan=False, separators=(",", ":")), encoding="utf-8")
    os.replace(partial, run / STATE)


def _load(run: Path) -> tuple[Spec, dict[str, Any], Optimizer]:
    spec = Spec(_read_json(run / SPEC))
    state = _read_json(run / STATE)
    return spec, state, OPTIMIZERS[spec.optimizer](spec, state["optimizer"])


def optimizer_start(params: dict[str, Any]) -> dict[str, Any]:
    spec_path = Path(params["spec"])
    if spec_path.name != SPEC:
        raise ValueError(f"the spec must be a run folder's {SPEC}, got {spec_path}")
    run = spec_path.parent
    if (run / STATE).exists():
        raise ValueError(f"the run {run} has started already")
    spec = Spec(_read_json(spec_path))
    optimizer = OPTIMIZERS[spec.optimizer](spec, None)
    _save_state(run, {"optimizer": optimizer.state(), "pending": None, "generations": 0})
    return {"dimension": spec.dimension}


def optimizer_ask(params: dict[str, Any]) -> dict[str, Any]:
    run = Path(params["run"])
    count = params["count"]
    if not isinstance(count, int) or count < 1:
        raise ValueError(f"count must be a whole number from 1, got {count!r}")
    spec, state, optimizer = _load(run)
    if state["pending"] is not None:
        raise ValueError(f"the run {run} was asked for points it hasn't been told about")
    points = _points(optimizer.ask(count), spec.dimension, "the optimizer's points")
    if len(points) != count:
        raise ValueError(f"the optimizer gave {len(points)} points, and {count} were asked")
    _write_new(Path(params["out"]), {"points": points})
    _save_state(run, {**state, "optimizer": optimizer.state(), "pending": points})
    return {"count": count}


def optimizer_tell(params: dict[str, Any]) -> dict[str, Any]:
    run = Path(params["run"])
    spec, state, optimizer = _load(run)
    pending = state["pending"]
    if pending is None:
        raise ValueError(f"the run {run} has no points waiting for scores")
    points = _points(_read_json(Path(params["points"])).get("points"), spec.dimension, "points")
    if points != pending:
        raise ValueError("the points told aren't the points the last ask gave")
    scores = _read_json(Path(params["scores"])).get("scores")
    if (
        not isinstance(scores, list)
        or len(scores) != len(points)  # pyright: ignore[reportUnknownArgumentType]
        or not all(
            isinstance(s, int | float) and not isinstance(s, bool) and math.isfinite(s)
            for s in scores  # pyright: ignore[reportUnknownVariableType]
        )
    ):
        raise ValueError(f"scores must be a list of {len(points)} finite numbers")
    optimizer.tell(points, [float(s) for s in scores])  # pyright: ignore[reportUnknownVariableType, reportUnknownArgumentType]
    generations = int(state["generations"]) + 1
    _save_state(run, {"optimizer": optimizer.state(), "pending": None, "generations": generations})
    return {"generations": generations}


def optimizer_handlers() -> dict[str, Handler]:
    return {
        "optimizer_start": optimizer_start,
        "optimizer_ask": optimizer_ask,
        "optimizer_tell": optimizer_tell,
    }
