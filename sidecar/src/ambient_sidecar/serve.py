"""The sidecar's request loop (decision 0041).

Each line read is one JSON request, `{id, method, params}`, and gets one line back:
`{id, result}`, or `{id, error}` with a message. A request it can't take, or a method that
raises, gets an error answer and the loop reads on; a request without an id is answered with a
null id, which the server treats as the sidecar breaking the protocol.
"""

import json
import platform
import sys
import traceback
from collections.abc import Callable, Iterable
from importlib.metadata import version as package_version
from typing import Any

from ambient_sidecar.clap import ClapCheckpoint, clap_handlers
from ambient_sidecar.protocol import Handler, Method, load_methods, mismatch


def ping(params: dict[str, Any]) -> dict[str, Any]:
    return {}


def version(params: dict[str, Any]) -> dict[str, Any]:
    return {"package": package_version("ambient-sidecar"), "python": platform.python_version()}


# One per method in the protocol file; `serve` refuses to start when they differ.
HANDLERS: dict[str, Handler] = {
    "ping": ping,
    "version": version,
    **clap_handlers(ClapCheckpoint()),
}


def _error(id: int | None, message: str) -> str:
    return json.dumps({"id": id, "error": message})


def answer(line: bytes, methods: dict[str, Method], handlers: dict[str, Handler]) -> str:
    """The answer to one request line, encoded as JSON without its newline."""
    try:
        request: object = json.loads(line.decode("utf-8"))
    except UnicodeDecodeError as error:
        return _error(None, f"the request isn't UTF-8: {error}")
    except (json.JSONDecodeError, RecursionError) as error:
        return _error(None, f"the request isn't JSON: {error}")
    if not isinstance(request, dict):
        return _error(None, "the request isn't a JSON object")
    fields: dict[str, Any] = request  # pyright: ignore[reportUnknownVariableType]
    id = fields.get("id")
    if not isinstance(id, int) or isinstance(id, bool):
        return _error(None, "the request has no whole-number id")
    method = fields.get("method")
    if not isinstance(method, str) or method not in methods:
        return _error(id, f"{method} is not a sidecar method")
    params = fields.get("params")
    wrong = mismatch(methods[method]["params"], params, "params")
    if wrong is not None:
        return _error(id, f"{method}: {wrong}")
    try:
        result = handlers[method](params)  # pyright: ignore[reportArgumentType]
    except Exception as error:
        # The traceback goes to stderr, which the server logs; the answer carries the message.
        traceback.print_exc(file=sys.stderr)
        return _error(id, f"{method} raised {type(error).__name__}: {error}")
    try:
        # NaN and infinities are refused: JavaScript's JSON.parse can't read them.
        return json.dumps({"id": id, "result": result}, allow_nan=False)
    except (TypeError, ValueError) as error:
        return _error(id, f"{method} returned a result that isn't JSON: {error}")


def serve(
    lines: Iterable[bytes], write: Callable[[str], None], handlers: dict[str, Handler] = HANDLERS
) -> None:
    """Answers each line of `lines` with one line passed to `write`, until `lines` ends. Lines
    are bytes, so one that isn't UTF-8 is answered like any other bad line."""
    methods = load_methods()
    if set(handlers) != set(methods):
        raise ValueError(
            f"the handlers ({', '.join(sorted(handlers))}) don't match the protocol's methods "
            f"({', '.join(sorted(methods))})"
        )
    for line in lines:
        write(f"{answer(line, methods, handlers)}\n")
