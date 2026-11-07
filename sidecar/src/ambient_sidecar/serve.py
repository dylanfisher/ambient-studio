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

from ambient_sidecar.protocol import Method, load_methods, mismatch

Handler = Callable[[dict[str, Any]], dict[str, Any]]


def ping(params: dict[str, Any]) -> dict[str, Any]:
    return {}


def version(params: dict[str, Any]) -> dict[str, Any]:
    return {"package": package_version("ambient-sidecar"), "python": platform.python_version()}


# One per method in the protocol file; `serve` refuses to start when they differ.
HANDLERS: dict[str, Handler] = {"ping": ping, "version": version}


def answer(line: str, methods: dict[str, Method], handlers: dict[str, Handler]) -> dict[str, Any]:
    try:
        request: object = json.loads(line)
    except json.JSONDecodeError as error:
        return {"id": None, "error": f"the request isn't JSON: {error}"}
    if not isinstance(request, dict):
        return {"id": None, "error": "the request isn't a JSON object"}
    fields: dict[str, Any] = request  # pyright: ignore[reportUnknownVariableType]
    id = fields.get("id")
    if not isinstance(id, int) or isinstance(id, bool):
        return {"id": None, "error": "the request has no whole-number id"}
    method = fields.get("method")
    if not isinstance(method, str) or method not in methods:
        return {"id": id, "error": f"{method} is not a sidecar method"}
    params = fields.get("params")
    wrong = mismatch(methods[method]["params"], params, "params")
    if wrong is not None:
        return {"id": id, "error": f"{method}: {wrong}"}
    try:
        result = handlers[method](params)  # pyright: ignore[reportArgumentType]
    except Exception as error:
        # The traceback goes to stderr, which the server logs; the answer carries the message.
        traceback.print_exc(file=sys.stderr)
        return {"id": id, "error": f"{method} raised {type(error).__name__}: {error}"}
    return {"id": id, "result": result}


def serve(
    lines: Iterable[str], write: Callable[[str], None], handlers: dict[str, Handler] = HANDLERS
) -> None:
    """Answers each line of `lines` with one line passed to `write`, until `lines` ends."""
    methods = load_methods()
    if set(handlers) != set(methods):
        raise ValueError(
            f"the handlers ({', '.join(sorted(handlers))}) don't match the protocol's methods "
            f"({', '.join(sorted(methods))})"
        )
    for line in lines:
        write(f"{json.dumps(answer(line, methods, handlers))}\n")
