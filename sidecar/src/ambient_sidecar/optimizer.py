"""Ask/tell optimizers over [0, 1]^d, run one generation at a time (decision 0053).

A run is a folder under the data root that the server makes. `optimizer_start` reads the run's
`spec.json` and writes its `state.json`; `optimizer_ask` writes the next points to a file the
server names and records them as pending; `optimizer_tell` reads those points back with their
scores, updates the optimizer and clears the pending points. The state is written after each ask
and each tell, by a rename, so a sidecar started again reads the run where the last one left
it. Higher scores are better.

An optimizer is a class in `OPTIMIZERS`, made from the spec and the state it last saved:
CMA-ES (decision 0054), preferential BO over the owner's choices (0055), and a scripted
optimizer that answers points the spec lists, for tests.
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

from ambient_sidecar.pairwise_gp import Comparison, Posterior, expected_improvement, length_scale
from ambient_sidecar.preference import read_json, write_json
from ambient_sidecar.protocol import Handler

SPEC = "spec.json"
STATE = "state.json"

Point = list[float]


class Optimizer(Protocol):
    def ask(self, count: int) -> list[Point]:
        """The next `count` points, each in [0, 1]^d."""
        ...

    def tell(self, points: list[Point], scores: list[float | None]) -> None:
        """Takes the points `ask` gave last, in order, with a score for each: None only for an
        optimizer in `TAKES_NO_ANSWER`."""
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

    def tell(self, points: list[Point], scores: list[float | None]) -> None:
        for point, score in zip(points, scores, strict=True):
            if score is None:
                raise ValueError("the scripted optimizer needs a score for every point")
            if self.best_score is None or score > self.best_score:
                self.best, self.best_score = point, score

    def state(self) -> dict[str, Any]:
        return {"next": self.next, "best": self.best, "bestScore": self.best_score}


CMA_ES = "cma-es"


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
            self.strategy = _read_strategy(state, spec.dimension)
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

    def tell(self, points: list[Point], scores: list[float | None]) -> None:
        told = [s for s in scores if s is not None]
        if len(told) != len(scores):
            raise ValueError("cma-es needs a score for every point")
        if len(points) == self.population:
            self.strategy.tell([numpy.array(p) for p in points], [-s for s in told])
            self.updates += 1
        self.told += len(points)

    def state(self) -> dict[str, Any]:
        strategy = base64.b64encode(pickle.dumps(self.strategy)).decode("ascii")
        return {
            "optimizer": CMA_ES,
            "dimension": self.strategy.N,
            "strategy": strategy,
            "told": self.told,
            "updates": self.updates,
        }


def _read_strategy(state: dict[str, Any], dimension: int) -> Any:
    """The strategy a CMA-ES state holds, checked to be one for this run. The pickle is the
    sidecar's own, written to the run folder by `CmaOptimizer.state`."""
    missing = [
        k for k in ("optimizer", "dimension", "strategy", "told", "updates") if k not in state
    ]
    if missing:
        raise ValueError(f"the run's CMA-ES state has no {', '.join(missing)}")
    if state["optimizer"] != CMA_ES:
        raise ValueError(f"the run's state is {state['optimizer']!r}'s, not {CMA_ES}'s")
    if state["dimension"] != dimension:
        raise ValueError(
            f"the run's CMA-ES state is in {state['dimension']} dimensions, its spec in {dimension}"
        )
    strategy: Any = pickle.loads(base64.b64decode(state["strategy"]))
    if not isinstance(strategy, cma.CMAEvolutionStrategy) or dimension != strategy.N:
        raise ValueError(f"the run's CMA-ES state doesn't hold a {dimension}-dimensional strategy")
    return strategy


PREFERENTIAL_BO = "preferential-bo"
# What a preferential BO point is told: it beat the run's best, tied with it, or lost to it.
WIN, TIE, LOSS = 1.0, 0.5, 0.0


class PreferentialOptimizer:
    """Preferential Bayesian optimization (decision 0055): each ask is one point to compare with
    the run's best, and each tell says how the comparison went. A point that beat the best is
    the new best; a tie keeps the best and is told as half a win each way; None, a skip, tells
    nothing and the point is forgotten.

    An ask fits the pairwise GP to every choice told, draws `settings.draws` points uniformly
    in the ball around the best of radius `settings.sigma` * sqrt(d), clipped to [0, 1], and
    answers the draw with the most expected improvement over the best. The draws come from a
    generator seeded by the spec's seed and the count of asks before, so one seed gives one run,
    and a state read back asks what an unbroken run would. The state is the points told, the
    choices and the best, as JSON.
    """

    def __init__(self, spec: Spec, state: dict[str, Any] | None) -> None:
        _settings(spec, ("sigma", "draws"))
        sigma = spec.settings.get("sigma")
        if not _is_position(sigma) or sigma == 0:
            raise ValueError(f"settings.sigma must be a number above 0, at most 1, got {sigma!r}")
        draws = spec.settings.get("draws")
        if not isinstance(draws, int) or isinstance(draws, bool) or draws < 1:
            raise ValueError(f"settings.draws must be a whole number from 1, got {draws!r}")
        self.sigma = float(sigma)  # pyright: ignore[reportArgumentType]  # checked above
        self.draws = draws
        self.seed = spec.seed
        self.dimension = spec.dimension
        if state is None:
            self.points: list[Point] = [spec.start]
            self.comparisons: list[Comparison] = []
            self.best = 0
            self.asks = 0
        else:
            if state.get("optimizer") != PREFERENTIAL_BO:
                raise ValueError(f"the run's state isn't {PREFERENTIAL_BO}'s")
            self.points = _points(state["points"], spec.dimension, "the state's points")
            self.comparisons = [
                (int(won), int(lost), float(x)) for won, lost, x in state["comparisons"]
            ]
            self.best = int(state["best"])
            self.asks = int(state["asks"])

    def posterior(self) -> Posterior:
        scale = length_scale(self.sigma, self.dimension)
        return Posterior(numpy.array(self.points), self.comparisons, scale)

    def ask(self, count: int) -> list[Point]:
        if count != 1:
            raise ValueError(f"{PREFERENTIAL_BO} asks one point at a time, not {count}")
        generator = numpy.random.default_rng([self.seed, self.asks])
        self.asks += 1
        best = numpy.array(self.points[self.best])
        # Uniform in the ball of radius sigma * sqrt(d), a medium nudge's typical distance. With
        # few choices told, expected improvement favors the draw farthest from the best, which
        # among normal draws would sit about 4.7 steps out in 6 dimensions.
        directions = generator.standard_normal((self.draws, self.dimension))
        directions /= numpy.linalg.norm(directions, axis=1, keepdims=True)
        radii = generator.random(self.draws) ** (1 / self.dimension)
        reach = self.sigma * math.sqrt(self.dimension)
        draws = numpy.clip(best + reach * radii[:, None] * directions, 0.0, 1.0)
        improvement = expected_improvement(self.posterior(), draws, self.best)
        # argmax takes the first of a tie, so one state gives one point.
        return [[float(u) for u in draws[int(numpy.argmax(improvement))]]]

    def tell(self, points: list[Point], scores: list[float | None]) -> None:
        for point, score in zip(points, scores, strict=True):
            if score is None:
                continue
            if score not in (WIN, TIE, LOSS):
                raise ValueError(
                    f"{PREFERENTIAL_BO} is told {WIN} for a win, {TIE} for a tie or {LOSS} for a "
                    f"loss, got {score}"
                )
            told = len(self.points)
            self.points.append(point)
            if score == WIN:
                self.comparisons.append((told, self.best, 1.0))
                self.best = told
            elif score == LOSS:
                self.comparisons.append((self.best, told, 1.0))
            else:
                self.comparisons += [(told, self.best, 0.5), (self.best, told, 0.5)]

    def state(self) -> dict[str, Any]:
        return {
            "optimizer": PREFERENTIAL_BO,
            "points": self.points,
            "comparisons": [list(c) for c in self.comparisons],
            "best": self.best,
            "asks": self.asks,
        }


OPTIMIZERS: dict[str, Factory] = {
    "scripted": ScriptedOptimizer,
    CMA_ES: CmaOptimizer,
    PREFERENTIAL_BO: PreferentialOptimizer,
}
# The optimizers a tell may give None for a point: an owner's skip says nothing about it.
TAKES_NO_ANSWER = frozenset({PREFERENTIAL_BO})


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
    takes_none = spec.optimizer in TAKES_NO_ANSWER
    if (
        not isinstance(scores, list)
        or len(scores) != len(points)  # pyright: ignore[reportUnknownArgumentType]
        or not all(
            (s is None and takes_none)
            or (isinstance(s, int | float) and not isinstance(s, bool) and math.isfinite(s))
            for s in scores  # pyright: ignore[reportUnknownVariableType]
        )
    ):
        what = "finite numbers or nulls" if takes_none else "finite numbers"
        raise ValueError(f"scores must be a list of {len(points)} {what}")
    optimizer.tell(points, [None if s is None else float(s) for s in scores])  # pyright: ignore[reportUnknownVariableType, reportUnknownArgumentType]
    generations = int(state["generations"]) + 1
    _save_state(run, {"optimizer": optimizer.state(), "pending": None, "generations": generations})
    return {"generations": generations}


def optimizer_handlers() -> dict[str, Handler]:
    return {
        "optimizer_start": optimizer_start,
        "optimizer_ask": optimizer_ask,
        "optimizer_tell": optimizer_tell,
    }
