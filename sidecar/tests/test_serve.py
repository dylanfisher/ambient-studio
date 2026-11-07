import json
import platform
from collections.abc import Callable
from typing import Any

import pytest

from ambient_sidecar.serve import HANDLERS, Handler, serve


def run(*lines: str, handlers: dict[str, Handler] = HANDLERS) -> list[dict[str, Any]]:
    """The answers `serve` writes for `lines`, each parsed from its own line."""
    written: list[str] = []
    serve([f"{line}\n" for line in lines], written.append, handlers)
    assert all(text.endswith("\n") and text.count("\n") == 1 for text in written)
    return [json.loads(text) for text in written]


def request(id: int, method: str, params: dict[str, Any] | None = None) -> str:
    return json.dumps({"id": id, "method": method, "params": {} if params is None else params})


def test_answers_ping_under_its_id() -> None:
    assert run(request(7, "ping")) == [{"id": 7, "result": {}}]


def test_answers_version_with_the_package_and_python_versions() -> None:
    [answer] = run(request(1, "version"))
    assert answer == {
        "id": 1,
        "result": {"package": "0.0.0", "python": platform.python_version()},
    }


def test_an_unknown_method_is_an_error_answer_and_the_loop_keeps_reading() -> None:
    assert run(request(1, "embed"), request(2, "ping")) == [
        {"id": 1, "error": "embed is not a sidecar method"},
        {"id": 2, "result": {}},
    ]


def test_a_request_missing_its_id_is_an_error_answer_with_a_null_id() -> None:
    no_id = json.dumps({"method": "ping", "params": {}})
    assert run(no_id, request(2, "ping")) == [
        {"id": None, "error": "the request has no whole-number id"},
        {"id": 2, "result": {}},
    ]


@pytest.mark.parametrize("line", ["not json", "[1, 2]", "", '{"id": true, "method": "ping"}'])
def test_a_line_that_is_not_a_request_object_is_an_error_answer(line: str) -> None:
    [answer, after] = run(line, request(2, "ping"))
    assert answer["id"] is None
    assert isinstance(answer["error"], str)
    assert after == {"id": 2, "result": {}}


def test_params_the_protocol_does_not_name_are_an_error_answer() -> None:
    assert run(request(3, "ping", {"n": 1})) == [
        {"id": 3, "error": "ping: params has n, which the protocol doesn't name"},
    ]


def test_a_method_that_raises_is_an_error_answer_naming_it() -> None:
    def broken(params: dict[str, Any]) -> dict[str, Any]:
        raise ValueError("no checkpoint")

    handlers: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {**HANDLERS, "ping": broken}
    assert run(request(4, "ping"), request(5, "version"), handlers=handlers)[0] == {
        "id": 4,
        "error": "ping raised ValueError: no checkpoint",
    }


def test_handlers_must_match_the_protocols_methods() -> None:
    handlers = {name: handler for name, handler in HANDLERS.items() if name != "version"}
    with pytest.raises(ValueError, match="version"):
        run(request(1, "ping"), handlers=handlers)
