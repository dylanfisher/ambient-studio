"""The sidecar's methods and the fields of their params and results (decision 0041).

They are read from the one file the server imports too, so the two sides can't disagree.
"""

import json
import math
import os
from collections.abc import Callable
from pathlib import Path
from typing import Any, TypedDict

# The file sits in the server's tier, which the server may import from; this package runs
# from the repo (uv installs it editable), so it reads the file there.
PROTOCOL_PATH = Path(__file__).resolve().parents[3] / "src" / "server" / "sidecar-protocol.json"

# Field name to type, as the protocol file writes them.
Fields = dict[str, str]


class Method(TypedDict):
    params: Fields
    result: Fields


def _is_number(value: object) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)


# The types a field may have; the server's client checks the same four. A path is an absolute
# file path, which is how audio and arrays pass, never inline.
FIELD_TYPES: dict[str, Callable[[object], bool]] = {
    "string": lambda value: isinstance(value, str),
    "number": _is_number,
    "boolean": lambda value: isinstance(value, bool),
    "path": lambda value: isinstance(value, str) and os.path.isabs(value),
}

# A method: its checked params in, its result out.
Handler = Callable[[dict[str, Any]], dict[str, Any]]


def load_methods() -> dict[str, Method]:
    methods: dict[str, Method] = json.loads(PROTOCOL_PATH.read_text(encoding="utf-8"))["methods"]
    return methods


def mismatch(fields: Fields, value: object, what: str) -> str | None:
    """The first way `value` breaks `fields`, or None when it is an object with exactly those
    fields, each of its type. `what` is `params` or `result`."""
    if not isinstance(value, dict):
        return f"{what} must be an object, got {json.dumps(value)}"
    record: dict[str, Any] = value  # pyright: ignore[reportUnknownVariableType]
    for key in record:
        if key not in fields:
            return f"{what} has {key}, which the protocol doesn't name"
    for key, type_name in fields.items():
        check = FIELD_TYPES[type_name]
        if key not in record:
            return f"{what} is missing {key}"
        if not check(record[key]):
            return f"{what}.{key} must be a {type_name}, got {json.dumps(record[key])}"
    return None
