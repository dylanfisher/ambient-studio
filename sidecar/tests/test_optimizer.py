import json
import math
import shutil
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy
import pytest

from ambient_sidecar.optimizer import STATE, optimizer_handlers
from ambient_sidecar.serve import HANDLERS

SCRIPT = [[0.1, 0.2], [0.3, 0.4], [0.5, 0.6], [0.7, 0.8], [0.9, 1.0], [0.0, 0.5]]
METHODS = optimizer_handlers()


def make_run(root: Path, points: list[list[float]] = SCRIPT) -> Path:
    run = root / "search" / "run-1"
    run.mkdir(parents=True)
    spec = {"optimizer": "scripted", "start": [0.5, 0.5], "seed": 7, "settings": {"points": points}}
    (run / "spec.json").write_text(json.dumps(spec), encoding="utf-8")
    return run


def ask(run: Path, generation: int, count: int) -> list[list[float]]:
    out = run / f"ask-{generation}.json"
    assert METHODS["optimizer_ask"]({"run": str(run), "count": count, "out": str(out)}) == {
        "count": count
    }
    points: list[list[float]] = json.loads(out.read_text(encoding="utf-8"))["points"]
    return points


def tell(run: Path, generation: int, scores: list[float]) -> dict[str, Any]:
    path = run / f"tell-{generation}.json"
    path.write_text(json.dumps({"scores": scores}), encoding="utf-8")
    points = run / f"ask-{generation}.json"
    return METHODS["optimizer_tell"]({"run": str(run), "points": str(points), "scores": str(path)})


def test_the_serve_loop_has_the_optimizer_methods() -> None:
    assert set(METHODS) <= set(HANDLERS)


def test_start_ask_and_tell_round_trip_on_the_scripted_optimizer(tmp_path: Path) -> None:
    run = make_run(tmp_path)
    assert METHODS["optimizer_start"]({"spec": str(run / "spec.json")}) == {"dimension": 2}
    assert ask(run, 0, 2) == SCRIPT[0:2]
    assert tell(run, 0, [0.5, 1.5]) == {"generations": 1}
    assert ask(run, 1, 3) == SCRIPT[2:5]
    assert tell(run, 1, [0.0, -1.0, 0.25]) == {"generations": 2}
    state = json.loads((run / STATE).read_text(encoding="utf-8"))
    assert state["pending"] is None
    assert state["optimizer"] == {"next": 5, "best": SCRIPT[1], "bestScore": 1.5}


def test_a_restarted_sidecar_continues_the_run_from_its_state_file(tmp_path: Path) -> None:
    run = make_run(tmp_path)

    def sidecar(requests: list[tuple[str, dict[str, Any]]]) -> list[dict[str, Any]]:
        lines = "".join(
            f"{json.dumps({'id': i + 1, 'method': m, 'params': p})}\n"
            for i, (m, p) in enumerate(requests)
        )
        done = subprocess.run(
            [sys.executable, "-m", "ambient_sidecar"],
            input=lines,
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        assert done.returncode == 0, done.stderr
        return [json.loads(line) for line in done.stdout.splitlines()]

    first = run / "ask-0.json"
    # One process starts the run and asks; it exits before the scores come back.
    assert sidecar(
        [
            ("optimizer_start", {"spec": str(run / "spec.json")}),
            ("optimizer_ask", {"run": str(run), "count": 2, "out": str(first)}),
        ]
    ) == [{"id": 1, "result": {"dimension": 2}}, {"id": 2, "result": {"count": 2}}]
    scores = run / "tell-0.json"
    scores.write_text(json.dumps({"scores": [1.0, 2.0]}), encoding="utf-8")
    second = run / "ask-1.json"
    # A fresh process takes the tell for those points and asks from where the script left off.
    answers = sidecar(
        [
            ("optimizer_tell", {"run": str(run), "points": str(first), "scores": str(scores)}),
            ("optimizer_ask", {"run": str(run), "count": 2, "out": str(second)}),
        ]
    )
    assert answers == [{"id": 1, "result": {"generations": 1}}, {"id": 2, "result": {"count": 2}}]
    assert json.loads(second.read_text(encoding="utf-8"))["points"] == SCRIPT[2:4]


def test_a_second_start_of_one_run_is_refused(tmp_path: Path) -> None:
    run = make_run(tmp_path)
    METHODS["optimizer_start"]({"spec": str(run / "spec.json")})
    with pytest.raises(ValueError, match="started already"):
        METHODS["optimizer_start"]({"spec": str(run / "spec.json")})


def test_an_ask_before_the_last_ask_is_told_is_refused(tmp_path: Path) -> None:
    run = make_run(tmp_path)
    METHODS["optimizer_start"]({"spec": str(run / "spec.json")})
    ask(run, 0, 1)
    with pytest.raises(ValueError, match="hasn't been told"):
        ask(run, 1, 1)


def test_a_tell_of_other_points_than_the_ask_gave_is_refused(tmp_path: Path) -> None:
    run = make_run(tmp_path)
    METHODS["optimizer_start"]({"spec": str(run / "spec.json")})
    ask(run, 0, 2)
    (run / "ask-0.json").write_text(json.dumps({"points": SCRIPT[1:3]}), encoding="utf-8")
    with pytest.raises(ValueError, match="aren't the points"):
        tell(run, 0, [1.0, 2.0])


@pytest.mark.parametrize("scores", [[1.0], [1.0, "x"], [1.0, None]])
def test_a_tell_without_a_finite_score_per_point_is_refused(
    tmp_path: Path, scores: list[Any]
) -> None:
    run = make_run(tmp_path)
    METHODS["optimizer_start"]({"spec": str(run / "spec.json")})
    ask(run, 0, 2)
    with pytest.raises(ValueError, match="finite numbers"):
        tell(run, 0, scores)


def test_a_failed_tell_leaves_the_state_as_it_was(tmp_path: Path) -> None:
    run = make_run(tmp_path)
    METHODS["optimizer_start"]({"spec": str(run / "spec.json")})
    ask(run, 0, 2)
    before = (run / STATE).read_text(encoding="utf-8")
    with pytest.raises(ValueError):
        tell(run, 0, [1.0])
    assert (run / STATE).read_text(encoding="utf-8") == before


def test_a_point_outside_the_unit_cube_is_refused(tmp_path: Path) -> None:
    run = make_run(tmp_path, [[0.5, 1.5]])
    with pytest.raises(ValueError, match="positions from 0 to 1"):
        METHODS["optimizer_start"]({"spec": str(run / "spec.json")})


def test_an_unknown_optimizer_is_refused(tmp_path: Path) -> None:
    run = tmp_path / "run"
    run.mkdir()
    spec: dict[str, Any] = {"optimizer": "cma", "start": [0.5], "seed": 1, "settings": {}}
    (run / "spec.json").write_text(json.dumps(spec), encoding="utf-8")
    with pytest.raises(ValueError, match="optimizer must be one of"):
        METHODS["optimizer_start"]({"spec": str(run / "spec.json")})


def cma_run(root: Path, name: str, seed: int, start: list[float]) -> Path:
    run = root / "search" / name
    run.mkdir(parents=True)
    settings = {"sigma": 0.12, "population": 4 + math.floor(3 * math.log(len(start)))}
    spec = {"optimizer": "cma-es", "start": start, "seed": seed, "settings": settings}
    (run / "spec.json").write_text(json.dumps(spec), encoding="utf-8")
    assert METHODS["optimizer_start"]({"spec": str(run / "spec.json")}) == {"dimension": len(start)}
    return run


def search(
    run: Path,
    score: Callable[[list[float]], float],
    evaluations: int,
    generation: int = 0,
) -> list[list[float]]:
    """Asks and tells whole populations, and a short last one, until `evaluations` points."""
    spec = json.loads((run / "spec.json").read_text(encoding="utf-8"))
    population: int = spec["settings"]["population"]
    asked: list[list[float]] = []
    while len(asked) < evaluations:
        points = ask(run, generation, min(population, evaluations - len(asked)))
        tell(run, generation, [score(p) for p in points])
        asked.extend(points)
        generation += 1
    return asked


# 0.44 from the start at 0.5 in every position.
OPTIMUM = [0.3, 0.65, 0.4, 0.7, 0.25, 0.55, 0.45, 0.6]


def quadratic(point: list[float]) -> float:
    """Higher is better, so the bowl is upside down; its peak, 0, is at `OPTIMUM`."""
    return -sum((u - o) ** 2 for u, o in zip(point, OPTIMUM, strict=False))


def test_cma_es_lands_within_0_05_of_a_quadratic_s_optimum_in_200_evaluations(
    tmp_path: Path,
) -> None:
    run = cma_run(tmp_path, "run-1", 7, [0.5] * 8)
    asked = search(run, quadratic, 200)
    assert len(asked) == 200
    assert all(0 <= u <= 1 for point in asked for u in point)
    # Within 0.05 of the optimum's score. The best point itself sits about 0.05 from the
    # optimum at the median over seeds: a sample drawn at the last step size, not the mean.
    best = max(asked, key=quadratic)
    assert quadratic(best) > -0.05
    assert math.dist(best, OPTIMUM) < 0.1


def test_one_seed_gives_one_cma_es_run_and_another_seed_another(tmp_path: Path) -> None:
    one = search(cma_run(tmp_path, "one", 7, [0.5] * 8), quadratic, 40)
    again = search(cma_run(tmp_path, "again", 7, [0.5] * 8), quadratic, 40)
    other = search(cma_run(tmp_path, "other", 8, [0.5] * 8), quadratic, 40)
    assert one == again
    assert one != other


def test_a_cma_es_run_reads_its_state_back_whatever_numpy_s_generator_holds(
    tmp_path: Path,
) -> None:
    # Every request reads the run from its files. Draws from numpy's global generator between
    # requests, as another method may make, change nothing.
    straight = search(cma_run(tmp_path, "straight", 3, [0.5] * 4), quadratic, 30)
    run = cma_run(tmp_path, "interrupted", 3, [0.5] * 4)
    # Populations of 8: two whole generations, then two more and a short one.
    first = search(run, quadratic, 16)
    numpy.random.seed(0)
    numpy.random.rand(100)
    rest = search(run, quadratic, 14, generation=2)
    assert first + rest == straight


def test_a_short_last_generation_is_told_without_moving_the_distribution(tmp_path: Path) -> None:
    run = cma_run(tmp_path, "run-1", 5, [0.5] * 8)
    search(run, quadratic, 13)
    state = json.loads((run / STATE).read_text(encoding="utf-8"))
    assert state["generations"] == 2
    # A population of 10: one whole generation updates the distribution, three points don't.
    assert state["optimizer"]["told"] == 13
    assert state["optimizer"]["updates"] == 1


@pytest.mark.parametrize(
    ("settings", "message"),
    [
        ({"sigma": 0.12}, "population"),
        ({"sigma": 0, "population": 6}, "sigma"),
        ({"sigma": 0.12, "population": 1}, "population"),
        ({"sigma": 0.12, "population": 6, "other": 1}, "other"),
    ],
)
def test_cma_es_refuses_settings_it_cant_run(
    tmp_path: Path, settings: dict[str, Any], message: str
) -> None:
    run = tmp_path / "run"
    run.mkdir()
    spec = {"optimizer": "cma-es", "start": [0.5, 0.5], "seed": 1, "settings": settings}
    (run / "spec.json").write_text(json.dumps(spec), encoding="utf-8")
    with pytest.raises(ValueError, match=message):
        METHODS["optimizer_start"]({"spec": str(run / "spec.json")})


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"strategy": None}, "has no strategy"),
        ({"optimizer": "scripted"}, "not cma-es's"),
        ({"dimension": 3}, "in 3 dimensions"),
    ],
)
def test_a_cma_es_state_for_another_run_is_refused_with_a_reason(
    tmp_path: Path, change: dict[str, Any], message: str
) -> None:
    run = cma_run(tmp_path, "run-1", 7, [0.5] * 2)
    state = json.loads((run / STATE).read_text(encoding="utf-8"))
    for key, value in change.items():
        if value is None:
            del state["optimizer"][key]
        else:
            state["optimizer"][key] = value
    (run / STATE).write_text(json.dumps(state), encoding="utf-8")
    with pytest.raises(ValueError, match=message):
        ask(run, 0, 2)


def bo_run(root: Path, name: str, seed: int, start: list[float]) -> Path:
    run = root / "search" / name
    run.mkdir(parents=True)
    settings = {"sigma": 0.12, "draws": 1000}
    spec = {"optimizer": "preferential-bo", "start": start, "seed": seed, "settings": settings}
    (run / "spec.json").write_text(json.dumps(spec), encoding="utf-8")
    assert METHODS["optimizer_start"]({"spec": str(run / "spec.json")}) == {"dimension": len(start)}
    return run


BO_START = [0.2, 0.2, 0.2, 0.2]
# 0.67 from the start.
BO_OPTIMUM = [0.7, 0.45, 0.55, 0.3]


def utility(point: list[float]) -> float:
    return -sum((u - o) ** 2 for u, o in zip(point, BO_OPTIMUM, strict=True))


def distance(point: list[float]) -> float:
    return math.sqrt(-utility(point))


def test_preferential_bo_on_simulated_choices_beats_its_start_in_9_of_10_seeds(
    tmp_path: Path,
) -> None:
    """The simulated owner prefers the higher utility after noise of 0.02 on each side, and
    calls it a tie within 0.002. The run's best is the point that won last."""
    beaten = 0
    for seed in range(10):
        run = bo_run(tmp_path, f"run-{seed + 1}", seed, BO_START)
        owner = numpy.random.default_rng(1000 + seed)
        best = BO_START
        for query in range(30):
            [point] = ask(run, query, 1)
            gap = utility(point) - utility(best) + owner.normal(0, 0.02) - owner.normal(0, 0.02)
            outcome = 0.5 if abs(gap) < 0.002 else 1.0 if gap > 0 else 0.0
            tell(run, query, [outcome])
            if outcome == 1.0:
                best = point
        beaten += distance(best) < distance(BO_START)
    assert beaten >= 9


def test_a_skip_tells_preferential_bo_nothing_and_the_next_draw_is_new(tmp_path: Path) -> None:
    run = bo_run(tmp_path, "run-1", 3, BO_START)
    [first] = ask(run, 0, 1)
    before = json.loads((run / STATE).read_text(encoding="utf-8"))["optimizer"]
    tell(run, 0, [None])  # pyright: ignore[reportArgumentType]
    after = json.loads((run / STATE).read_text(encoding="utf-8"))["optimizer"]
    assert after == before
    assert after["points"] == [BO_START] and after["comparisons"] == []
    [second] = ask(run, 1, 1)
    assert second != first


def test_preferential_bo_keeps_wins_ties_and_losses_against_the_best(tmp_path: Path) -> None:
    run = bo_run(tmp_path, "run-1", 3, BO_START)
    told: list[list[float]] = []
    for query, outcome in enumerate([0.0, 1.0, 0.5]):
        told += ask(run, query, 1)
        tell(run, query, [outcome])
    state = json.loads((run / STATE).read_text(encoding="utf-8"))["optimizer"]
    assert state["points"] == [BO_START, *told]
    # Lost to the start; beat the start and became the best; tied with that best.
    assert state["comparisons"] == [[0, 1, 1.0], [2, 0, 1.0], [3, 2, 0.5], [2, 3, 0.5]]
    assert state["best"] == 2


def test_one_seed_gives_one_preferential_bo_run(tmp_path: Path) -> None:
    def points(name: str, seed: int) -> list[list[float]]:
        run = bo_run(tmp_path, name, seed, BO_START)
        asked: list[list[float]] = []
        for query, outcome in enumerate([0.0, 1.0, 0.0, 0.5]):
            asked += ask(run, query, 1)
            tell(run, query, [outcome])
        return asked

    first = points("run-1", 5)
    assert points("run-2", 5) == first
    assert points("run-3", 6) != first


@pytest.mark.parametrize("scores", [[0.25], [2.0], ["win"]])
def test_preferential_bo_refuses_a_score_that_is_no_outcome(
    tmp_path: Path, scores: list[Any]
) -> None:
    run = bo_run(tmp_path, "run-1", 3, BO_START)
    ask(run, 0, 1)
    with pytest.raises(ValueError, match=r"for a win|finite numbers or nulls"):
        tell(run, 0, scores)


def test_preferential_bo_asks_one_point_at_a_time(tmp_path: Path) -> None:
    run = bo_run(tmp_path, "run-1", 3, BO_START)
    with pytest.raises(ValueError, match="one point at a time"):
        ask(run, 0, 2)


def test_cma_es_refuses_a_null_score(tmp_path: Path) -> None:
    run = cma_run(tmp_path, "run-1", 7, [0.5, 0.5])
    ask(run, 0, 5)
    with pytest.raises(ValueError, match="finite numbers"):
        tell(run, 0, [1.0, 1.0, None, 1.0, 1.0])  # pyright: ignore[reportArgumentType]


def test_preferential_bo_draws_within_a_medium_nudge_s_distance_of_the_best(
    tmp_path: Path,
) -> None:
    run = bo_run(tmp_path, "run-1", 4, BO_START)
    best = BO_START
    reach = 0.12 * math.sqrt(len(BO_START))
    for query, outcome in enumerate([1.0, 0.0, 1.0, 0.0, 0.0, 1.0]):
        [point] = ask(run, query, 1)
        assert math.dist(point, best) <= reach + 1e-12
        tell(run, query, [outcome])
        if outcome == 1.0:
            best = point


@pytest.mark.parametrize("outcome", [1.0, 0.5, 0.0, None])
def test_a_copy_of_a_preferential_bo_run_told_the_same_answer_asks_the_same_point(
    tmp_path: Path, outcome: float | None
) -> None:
    """The server renders a copy's next point while the owner listens (decision 0055); it is
    in the cache only if the run, told that answer, asks the same point."""
    run = bo_run(tmp_path, "run-1", 8, BO_START)
    for query, told in enumerate([0.0, 1.0]):
        ask(run, query, 1)
        tell(run, query, [told])
    ask(run, 2, 1)
    fork = run / "branch-2"
    fork.mkdir()
    for name in ("spec.json", STATE, "ask-2.json"):
        shutil.copyfile(run / name, fork / name)
    tell(fork, 2, [outcome])  # pyright: ignore[reportArgumentType]
    tell(run, 2, [outcome])  # pyright: ignore[reportArgumentType]
    assert ask(fork, 3, 1) == ask(run, 3, 1)
