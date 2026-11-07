import json
import os
import wave
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from ambient_sidecar.clap import (
    CHECKPOINT,
    DIMENSION,
    REVISION,
    SAMPLE_RATE,
    WINDOW_SAMPLES,
    ClapCheckpoint,
    Model,
    Vectors,
    clap_handlers,
    embed_file,
    windows,
)
from ambient_sidecar.serve import HANDLERS, serve

# Each second of the test audio holds one value, 100 times its index, as 16-bit PCM.
STEP = 100
FULL_SCALE = 32768


def write_seconds(path: Path, seconds: int) -> Path:
    """A stereo 16-bit WAV at SAMPLE_RATE whose second k holds k * STEP in both channels."""
    values = np.repeat(np.arange(seconds, dtype=np.int16) * STEP, SAMPLE_RATE)
    with wave.open(str(path), "wb") as file:
        file.setnchannels(2)
        file.setsampwidth(2)
        file.setframerate(SAMPLE_RATE)
        file.writeframes(np.repeat(values, 2).astype("<i2").tobytes())
    return path


class FakeModel:
    """Gives each window its first sample, its last sample and its share of a full window,
    so a test can tell which windows were cut and how they were averaged."""

    def audio(self, windows: list[Vectors]) -> Vectors:
        rows = np.zeros((len(windows), DIMENSION), dtype=np.float32)
        for i, window in enumerate(windows):
            rows[i, :3] = [window[0], window[-1], window.shape[0] / WINDOW_SAMPLES]
        return rows

    def text(self, texts: list[str]) -> Vectors:
        rows = np.zeros((len(texts), DIMENSION), dtype=np.float32)
        for i, text in enumerate(texts):
            rows[i, 0] = len(text)
            rows[i, 1] = 1
        return rows


class FakeCheckpoint:
    def __init__(self) -> None:
        self.fetched: list[Path] = []
        self.loads = 0

    def cached(self, cache: Path) -> bool:
        return cache in self.fetched

    def fetch(self, cache: Path) -> None:
        self.fetched.append(cache)

    def load(self, cache: Path) -> Model:
        self.loads += 1
        return FakeModel()


def run(checkpoint: FakeCheckpoint, *requests: dict[str, Any]) -> list[dict[str, Any]]:
    written: list[str] = []
    lines = [f"{json.dumps(request)}\n".encode() for request in requests]
    serve(lines, written.append, {**HANDLERS, **clap_handlers(checkpoint)})
    return [json.loads(text) for text in written]


def embed_audio(id: int, cache: Path, audio: Path, out: Path) -> dict[str, Any]:
    params = {"checkpointCache": str(cache), "audio": str(audio), "out": str(out)}
    return {"id": id, "method": "embed_audio", "params": params}


def read_vector(path: Path) -> Vectors:
    return np.fromfile(path, dtype="<f4")


def test_a_25_s_excerpt_is_three_windows_spread_from_start_to_end() -> None:
    samples = np.arange(25 * SAMPLE_RATE, dtype=np.float32)
    starts = [int(window[0]) for window in windows(samples)]
    assert starts == [0, 360_000, 720_000]
    assert all(window.shape == (WINDOW_SAMPLES,) for window in windows(samples))


def test_an_excerpt_no_longer_than_the_window_is_one_window() -> None:
    samples = np.zeros(WINDOW_SAMPLES - 1, dtype=np.float32)
    [window] = windows(samples)
    assert window.shape == (WINDOW_SAMPLES - 1,)
    assert len(windows(np.zeros(WINDOW_SAMPLES, dtype=np.float32))) == 1


def test_embed_audio_writes_the_unit_mean_of_its_windows(tmp_path: Path) -> None:
    audio = write_seconds(tmp_path / "excerpt.wav", 25)
    out = tmp_path / "vector.f32"
    checkpoint = FakeCheckpoint()
    assert run(checkpoint, embed_audio(1, tmp_path, audio, out)) == [
        {"id": 1, "result": {"windows": 3}}
    ]
    vector = read_vector(out)
    assert vector.shape == (DIMENSION,)
    # Windows start at 0, 7.5 and 15 s and end in seconds 9, 17 and 24.
    first = np.mean([0, 7, 15]) * STEP / FULL_SCALE
    last = np.mean([9, 17, 24]) * STEP / FULL_SCALE
    mean = np.array([first, last, 1.0])
    assert np.allclose(vector[:3], mean / np.linalg.norm(mean), atol=1e-6)
    assert np.all(vector[3:] == 0)
    assert np.isclose(np.linalg.norm(vector), 1, atol=1e-6)


def test_the_model_is_loaded_once_per_process(tmp_path: Path) -> None:
    audio = write_seconds(tmp_path / "excerpt.wav", 3)
    checkpoint = FakeCheckpoint()
    answers = run(
        checkpoint,
        embed_audio(1, tmp_path, audio, tmp_path / "a.f32"),
        embed_audio(2, tmp_path, audio, tmp_path / "b.f32"),
    )
    assert [answer["result"] for answer in answers] == [{"windows": 1}, {"windows": 1}]
    assert checkpoint.loads == 1
    assert np.array_equal(read_vector(tmp_path / "a.f32"), read_vector(tmp_path / "b.f32"))


def test_a_missing_file_is_an_error_answer_and_the_loop_keeps_reading(tmp_path: Path) -> None:
    missing = tmp_path / "gone.flac"
    answers = run(
        FakeCheckpoint(),
        embed_audio(1, tmp_path, missing, tmp_path / "out.f32"),
        {"id": 2, "method": "ping", "params": {}},
    )
    assert answers == [
        {
            "id": 1,
            "error": f"embed_audio raised FileNotFoundError: there is no audio file {missing}",
        },
        {"id": 2, "result": {}},
    ]
    assert not (tmp_path / "out.f32").exists()


def test_a_file_ffmpeg_cannot_decode_is_an_error_answer_naming_it(tmp_path: Path) -> None:
    broken = tmp_path / "broken.flac"
    broken.write_bytes(b"not audio")
    [answer] = run(FakeCheckpoint(), embed_audio(1, tmp_path, broken, tmp_path / "out.f32"))
    assert answer["error"].startswith(
        f"embed_audio raised ValueError: ffmpeg can't decode {broken}"
    )


def test_a_relative_path_is_refused_before_the_method_runs(tmp_path: Path) -> None:
    request = embed_audio(1, tmp_path, Path("excerpt.wav"), tmp_path / "out.f32")
    assert run(FakeCheckpoint(), request) == [
        {"id": 1, "error": 'embed_audio: params.audio must be a path, got "excerpt.wav"'}
    ]


def test_embed_text_writes_one_unit_vector(tmp_path: Path) -> None:
    out = tmp_path / "text.f32"
    params = {"checkpointCache": str(tmp_path), "text": "slow cold drone", "out": str(out)}
    assert run(FakeCheckpoint(), {"id": 1, "method": "embed_text", "params": params}) == [
        {"id": 1, "result": {}}
    ]
    vector = read_vector(out)
    assert vector.shape == (DIMENSION,)
    assert np.allclose(vector[:2], np.array([15, 1]) / np.hypot(15, 1), atol=1e-6)


def test_embedder_names_the_checkpoint_and_fetches_only_when_asked(tmp_path: Path) -> None:
    checkpoint = FakeCheckpoint()
    cache = str(tmp_path)
    answers = run(
        checkpoint,
        {"id": 1, "method": "embedder", "params": {"checkpointCache": cache, "fetch": False}},
        {"id": 2, "method": "embedder", "params": {"checkpointCache": cache, "fetch": True}},
    )
    results = [answer["result"] for answer in answers]
    assert [result["ready"] for result in results] == [False, True]
    assert checkpoint.fetched == [tmp_path]
    assert all(result["dimension"] == DIMENSION for result in results)
    producer = results[0]["producer"]
    assert producer.startswith(f"{CHECKPOINT}@{REVISION} clap-")
    assert len(producer.split(" clap-")[1]) == 64


@pytest.mark.parametrize("sample", [0.0, float("nan")])
def test_a_vector_that_cannot_be_normalized_is_an_error(sample: float, tmp_path: Path) -> None:
    class Flat(FakeModel):
        def audio(self, windows: list[Vectors]) -> Vectors:
            return np.full((len(windows), DIMENSION), sample, dtype=np.float32)

    class FlatCheckpoint(FakeCheckpoint):
        def load(self, cache: Path) -> Model:
            return Flat()

    audio = write_seconds(tmp_path / "excerpt.wav", 2)
    [answer] = run(FlatCheckpoint(), embed_audio(1, tmp_path, audio, tmp_path / "out.f32"))
    assert "can't be normalized" in answer["error"]


# Set to a folder holding the checkpoint, such as the one the config's
# sidecar.checkpointCache names, to run the one test of the real model.
CACHE_VARIABLE = "AMBIENT_CLAP_CACHE"


def real_cache() -> Path | None:
    folder = os.environ.get(CACHE_VARIABLE)
    return Path(folder) if folder and ClapCheckpoint().cached(Path(folder)) else None


def write_signal(path: Path, signal: Vectors) -> Path:
    with wave.open(str(path), "wb") as file:
        file.setnchannels(2)
        file.setsampwidth(2)
        file.setframerate(SAMPLE_RATE)
        pcm = np.round(np.clip(signal, -1, 1) * 32767).astype("<i2")
        file.writeframes(np.repeat(pcm, 2).tobytes())
    return path


@pytest.mark.skipif(real_cache() is None, reason=f"${CACHE_VARIABLE} names no cached checkpoint")
def test_the_real_checkpoint_is_repeatable_and_matches_text_to_audio(tmp_path: Path) -> None:
    cache = real_cache()
    assert cache is not None
    model = ClapCheckpoint().load(cache)
    time = np.arange(25 * SAMPLE_RATE) / SAMPLE_RATE
    sine = (0.3 * np.sin(2 * np.pi * 440 * time)).astype(np.float32)
    tone = write_signal(tmp_path / "tone.wav", sine)
    noise_samples = np.random.default_rng(1).uniform(-0.3, 0.3, time.shape[0]).astype(np.float32)
    noise = write_signal(tmp_path / "noise.wav", noise_samples)

    first, count = embed_file(model, tone)
    second, _ = embed_file(model, tone)
    assert count == 3
    assert np.array_equal(first, second)

    noise_vector, _ = embed_file(model, noise)
    [tone_text, noise_text] = model.text(["a pure sine tone", "loud white noise"])
    assert float(tone_text @ first) > float(tone_text @ noise_vector)
    assert float(noise_text @ noise_vector) > float(noise_text @ first)
