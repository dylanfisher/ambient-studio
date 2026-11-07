import json
from pathlib import Path

from ambient_sidecar.protocol import FIELD_TYPES, PROTOCOL_PATH, load_methods, mismatch

REPO = Path(__file__).resolve().parents[2]


def test_the_sidecar_reads_the_file_the_server_imports() -> None:
    server_file = REPO / "src" / "server" / "sidecar-protocol.json"
    assert server_file == PROTOCOL_PATH
    client = (REPO / "src" / "server" / "sidecar-client.js").read_text(encoding="utf-8")
    assert 'from "./sidecar-protocol.json" with { type: "json" }' in client
    assert load_methods() == json.loads(server_file.read_text(encoding="utf-8"))["methods"]


def test_every_field_has_a_type_both_sides_check() -> None:
    for method in load_methods().values():
        for fields in (method["params"], method["result"]):
            assert set(fields.values()) <= set(FIELD_TYPES)


def test_mismatch_names_the_first_wrong_field() -> None:
    fields = {"package": "string", "python": "string"}
    assert mismatch(fields, {"package": "0.0.0", "python": "3.12"}, "result") is None
    assert mismatch(fields, {"package": "0.0.0"}, "result") == "result is missing python"
    assert (
        mismatch(fields, {"package": "0.0.0", "python": 3}, "result")
        == "result.python must be a string, got 3"
    )
    assert mismatch({"n": "number"}, {"n": True}, "params") == "params.n must be a number, got true"
    assert mismatch(fields, [], "params") == "params must be an object, got []"
