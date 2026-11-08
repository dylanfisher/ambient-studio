import json
import subprocess
import sys
from pathlib import Path
from typing import Any

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
