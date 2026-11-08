"""Ask/tell optimizers over [0, 1]^d, run one generation at a time (decision 0053).

A run is a folder under the data root that the server makes. `optimizer_start` reads the run's
`spec.json` and writes its `state.json`; `optimizer_ask` writes the next points to a file the
server names and records them as pending; `optimizer_tell` reads those points back with their
scores, updates the optimizer and clears the pending points. The state is written after each ask
and each tell, by a rename, so a sidecar started again reads the run where the last one left
it. Higher scores are better.

An optimizer is a class in `OPTIMIZERS`, made from the spec and the state it last saved:
CMA-ES (decision 0054), and a scripted optimizer that answers points the spec lists, for tests.
"""

import base64
import json
import math
import os
import pickle
import warnings
from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol

import numpy

with warnings.catch_warnings():
    # `cma` warns on import that matplotlib is missing; the sidecar never plots.
    warnings.filterwarnings("ignore", message="Could not import matplotlib")
    import cma  # pyright: ignore[reportMissingTypeStubs]

from ambient_sidecar.preference import read_json, write_json
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


def _settings(spec: Spec, keys: tuple[str, ...]) -> None:
    for key in spec.settings:
        if key not in keys:
            raise ValueError(f"the settings have {key}, which {spec.optimizer} doesn't read")


class CmaOptimizer:
    """CMA-ES (decision 0054) through Hansen's `cma`, inside [0, 1]^d by its bound handling,
    from the spec's start with step `settings.sigma` and `settings.population` points a
    generation. Higher scores are better, so `cma`, which minimizes, is told their negatives.

    The strategy draws from its own generator, seeded by the spec, never numpy's global one, so
    one seed gives one run whatever else the sidecar draws. The state is the strategy pickled,
    its generator inside it, as base64 in the run's state file: one rename then writes all of
    it. A told generation shorter than the population, as a budget's last one is, can't update
    the distribution (`cma` needs at least half a population), so it is counted and no more.
    """

    def __init__(self, spec: Spec, state: dict[str, Any] | None) -> None:
        _settings(spec, ("sigma", "population"))
        sigma = spec.settings.get("sigma")
        if not _is_position(sigma) or sigma == 0:
            raise ValueError(f"settings.sigma must be a number above 0, at most 1, got {sigma!r}")
        population = spec.settings.get("population")
        if not isinstance(population, int) or isinstance(population, bool) or population < 2:
            raise ValueError(
                f"settings.population must be a whole number from 2, got {population!r}"
            )
        self.population = population
        if state is None:
            generator = numpy.random.RandomState(spec.seed)
            options = {
                "bounds": [0, 1],
                "popsize": population,
                # nan leaves numpy's global generator alone; `randn` is the strategy's own.
                "seed": math.nan,
                "randn": generator.randn,
                "verbose": -9,
                "verb_log": 0,
                "verb_disp": 0,
            }
            self.strategy: Any = cma.CMAEvolutionStrategy(spec.start, sigma, options)
            self.told = 0
            self.updates = 0
        else:
            # The pickle is the sidecar's own, written to the run folder by `state` below.
            self.strategy = pickle.loads(base64.b64decode(state["strategy"]))
            self.told = int(state["told"])
            self.updates = int(state["updates"])

    def ask(self, count: int) -> list[Point]:
        if count > self.population:
            raise ValueError(
                f"cma-es asks at most {self.population} points a generation, not {count}"
            )
        drawn: list[Any] = self.strategy.ask(count)
        # The bound handling maps into [0, 1]; the clip only guards rounding at an edge.
        return [[min(1.0, max(0.0, float(u))) for u in x] for x in drawn]

    def tell(self, points: list[Point], scores: list[float]) -> None:
        if len(points) == self.population:
            self.strategy.tell([numpy.array(p) for p in points], [-s for s in scores])
            self.updates += 1
        self.told += len(points)

    def state(self) -> dict[str, Any]:
        strategy = base64.b64encode(pickle.dumps(self.strategy)).decode("ascii")
        return {"strategy": strategy, "told": self.told, "updates": self.updates}


OPTIMIZERS: dict[str, Factory] = {"scripted": ScriptedOptimizer, "cma-es": CmaOptimizer}


def _save_state(run: Path, state: dict[str, Any]) -> None:
    """Writes the state by a rename, so a sidecar killed mid-write leaves the last state whole.
    A partial file such a kill left is removed first."""
    partial = run / f"{STATE}.partial"
    partial.unlink(missing_ok=True)
    write_json(partial, state)
    os.replace(partial, run / STATE)


def _load(run: Path) -> tuple[Spec, dict[str, Any], Optimizer]:
    spec = Spec(read_json(run / SPEC))
    state = read_json(run / STATE)
    return spec, state, OPTIMIZERS[spec.optimizer](spec, state["optimizer"])


def optimizer_start(params: dict[str, Any]) -> dict[str, Any]:
    spec_path = Path(params["spec"])
    if spec_path.name != SPEC:
        raise ValueError(f"the spec must be a run folder's {SPEC}, got {spec_path}")
    run = spec_path.parent
    if (run / STATE).exists():
        raise ValueError(f"the run {run} has started already")
    spec = Spec(read_json(spec_path))
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
    write_json(Path(params["out"]), {"points": points})
    _save_state(run, {**state, "optimizer": optimizer.state(), "pending": points})
    return {"count": count}


def optimizer_tell(params: dict[str, Any]) -> dict[str, Any]:
    run = Path(params["run"])
    spec, state, optimizer = _load(run)
    pending = state["pending"]
    if pending is None:
        raise ValueError(f"the run {run} has no points waiting for scores")
    points = _points(read_json(Path(params["points"])).get("points"), spec.dimension, "points")
    if points != pending:
        raise ValueError("the points told aren't the points the last ask gave")
    scores = read_json(Path(params["scores"])).get("scores")
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
