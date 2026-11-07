import json
import subprocess
import sys

# A handler that prints, as a library might, before the loop starts on the real stdio.
PRINTING_PING = """
import ambient_sidecar.serve as serve
from ambient_sidecar.__main__ import main

def ping(params):
    print("Loading checkpoint...")
    return {}

serve.HANDLERS["ping"] = ping
main()
"""


def run_sidecar(
    code: list[str], requests: list[dict[str, object]]
) -> subprocess.CompletedProcess[str]:
    lines = "".join(f"{json.dumps(request)}\n" for request in requests)
    return subprocess.run(
        [sys.executable, *code],
        input=lines,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )


def test_the_module_answers_on_stdout_and_exits_when_stdin_closes() -> None:
    done = run_sidecar(
        ["-m", "ambient_sidecar"],
        [{"id": 1, "method": "ping", "params": {}}, {"id": 2, "method": "version", "params": {}}],
    )
    assert done.returncode == 0, done.stderr
    answers = [json.loads(line) for line in done.stdout.splitlines()]
    assert [answer["id"] for answer in answers] == [1, 2]
    assert answers[0]["result"] == {}


def test_a_print_inside_a_method_goes_to_stderr_not_the_answers() -> None:
    done = run_sidecar(["-c", PRINTING_PING], [{"id": 1, "method": "ping", "params": {}}])
    assert done.returncode == 0, done.stderr
    assert done.stdout == '{"id": 1, "result": {}}\n'
    assert "Loading checkpoint..." in done.stderr


def test_a_line_that_is_not_utf8_on_stdin_is_answered_and_the_loop_goes_on() -> None:
    done = subprocess.run(
        [sys.executable, "-m", "ambient_sidecar"],
        input=b'{"id": 1, "method": "\xff"}\n{"id": 2, "method": "ping", "params": {}}\n',
        capture_output=True,
        timeout=60,
        check=False,
    )
    assert done.returncode == 0, done.stderr
    answers = [json.loads(line) for line in done.stdout.splitlines()]
    assert [answer["id"] for answer in answers] == [None, 2]
