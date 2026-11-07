"""Runs the request loop on stdin and stdout; the server starts it with `uv run` (decision 0041)."""

import os
import sys

from ambient_sidecar.serve import serve


def main() -> None:
    # Answers go to a copy of stdout. File descriptor 1 and sys.stdout then point at stderr,
    # so a library that prints, from Python or from C, can't put a line among the answers.
    answers = os.fdopen(os.dup(1), "w", encoding="utf-8")
    os.dup2(2, 1)
    sys.stdout = sys.stderr
    stdin = open(sys.stdin.fileno(), encoding="utf-8", closefd=False)  # noqa: SIM115

    def write(text: str) -> None:
        answers.write(text)
        answers.flush()

    serve(iter(stdin.readline, ""), write)


if __name__ == "__main__":
    main()
