"""CLAP embeddings of audio files and texts (decision 0042).

An excerpt longer than the checkpoint's 10 s window is cut into evenly spaced windows that
cover it, each is embedded, and the mean of the windows, unit-normalized, is its embedding.
Vectors are written to the file the request names as little-endian float32, since arrays pass
as file paths (decision 0041).
"""

import functools
import hashlib
import math
import shutil
import subprocess
from importlib.metadata import version as package_version
from pathlib import Path
from typing import Any, Protocol

import numpy as np
from numpy.typing import NDArray

from ambient_sidecar.protocol import Handler

CHECKPOINT = "laion/clap-htsat-unfused"
# The checkpoint's commit on the Hugging Face hub, so a later push to it can't change an
# embedding under the same producer.
REVISION = "8fa0f1c6d0433df6e97c127f64b2a1d6c0dcda8a"
# From the checkpoint's preprocessor_config.json and config.json; `load` checks them.
SAMPLE_RATE = 48_000
WINDOW_SAMPLES = 480_000
DIMENSION = 512
# Intra-op threads for torch on the CPU. The model never goes to the GPU, which omlx uses, and
# four of mbp2021's ten cores leave the rest to omlx's CPU side and the server's renders.
TORCH_THREADS = 4

# The packages whose code computes an embedding; their installed versions are in the producer.
PACKAGES = ("torch", "transformers")

Vectors = NDArray[np.float32]

# What ffmpeg writes to stdout: raw float32 stereo at SAMPLE_RATE.
DECODED = ("-f", "f32le", "-ac", "2", "-ar", str(SAMPLE_RATE), "-")


def producer_of(packages: dict[str, str], ffmpeg: str, source: bytes) -> str:
    """The checkpoint, the versions of the packages and ffmpeg that compute an embedding, and
    the SHA-256 of this file's source, which holds the decoding, the windowing and the
    normalization: a change to any of them changes the producer, and so every embedding."""
    versions = " ".join(f"{name}-{packages[name]}" for name in sorted(packages))
    digest = hashlib.sha256(source).hexdigest()
    return f"{CHECKPOINT}@{REVISION} {versions} ffmpeg-{ffmpeg} clap-{digest}"


def ffmpeg_path() -> str:
    found = shutil.which("ffmpeg")
    if found is None:
        raise FileNotFoundError("ffmpeg isn't on the PATH; install it with brew install ffmpeg")
    return found


def ffmpeg_version() -> str:
    """The version in `ffmpeg -version`'s first line, `ffmpeg version 9.0.2 Copyright ...`."""
    done = subprocess.run([ffmpeg_path(), "-version"], capture_output=True, text=True, check=True)
    words = done.stdout.split()
    if words[:2] != ["ffmpeg", "version"] or len(words) < 3:
        raise ValueError(f"ffmpeg -version printed {done.stdout[:80]!r}")
    return words[2]


@functools.cache
def producer() -> str:
    """This process's producer, read once: the packages installed and the source loaded."""
    packages = {name: package_version(name) for name in PACKAGES}
    return producer_of(packages, ffmpeg_version(), Path(__file__).read_bytes())


class Model(Protocol):
    def audio(self, windows: list[Vectors]) -> Vectors:
        """One unit vector per window of mono samples at SAMPLE_RATE, at most WINDOW_SAMPLES
        each, as rows."""
        ...

    def text(self, texts: list[str]) -> Vectors:
        """One unit vector per text, as rows."""
        ...


class Checkpoint(Protocol):
    def cached(self, cache: Path) -> bool: ...

    def fetch(self, cache: Path) -> None:
        """Downloads the checkpoint into `cache` when it isn't there."""
        ...

    def load(self, cache: Path) -> Model:
        """The model from `cache`, never from the network."""
        ...


def decode(path: Path) -> Vectors:
    """The file's audio as mono float32 samples at SAMPLE_RATE: the mean of its two channels.

    Python reads none of the formats the server keeps (FLAC rated audio, the render cache), so
    ffmpeg decodes every one, which also resamples the rare file that isn't at 48 kHz."""
    if not path.is_file():
        raise FileNotFoundError(f"there is no audio file {path}")
    done = subprocess.run(
        [ffmpeg_path(), "-v", "error", "-nostdin", "-i", str(path), *DECODED],
        capture_output=True,
        check=False,
    )
    if done.returncode != 0:
        message = done.stderr.decode("utf-8", "replace").strip()
        raise ValueError(f"ffmpeg can't decode {path}: {message}")
    stereo = np.frombuffer(done.stdout, dtype="<f4").reshape(-1, 2)
    if stereo.shape[0] == 0:
        raise ValueError(f"{path} holds no audio")
    return stereo.mean(axis=1, dtype=np.float32)


def windows(samples: Vectors) -> list[Vectors]:
    """Windows of WINDOW_SAMPLES that cover `samples`, as few as can, evenly spaced from the
    first sample to the last, so they overlap rather than leave a short one at the end. A
    shorter excerpt is one window, which the feature extractor pads by repeating it."""
    length = samples.shape[0]
    if length <= WINDOW_SAMPLES:
        return [samples]
    count = math.ceil(length / WINDOW_SAMPLES)
    span = length - WINDOW_SAMPLES
    starts = [round(i * span / (count - 1)) for i in range(count)]
    return [samples[start : start + WINDOW_SAMPLES] for start in starts]


def unit(vector: Vectors) -> Vectors:
    norm = float(np.linalg.norm(vector))
    if not math.isfinite(norm) or norm == 0:
        raise ValueError(f"an embedding has norm {norm}, so it can't be normalized")
    return (vector / norm).astype(np.float32)


def embed_file(model: Model, path: Path) -> tuple[Vectors, int]:
    """The file's embedding and how many windows it is the mean of."""
    parts = windows(decode(path))
    vectors = model.audio(parts)
    if vectors.shape != (len(parts), DIMENSION):
        raise ValueError(f"the model gave {vectors.shape} for {len(parts)} windows")
    return unit(vectors.mean(axis=0, dtype=np.float32)), len(parts)


def write_vector(path: Path, vector: Vectors) -> None:
    """Writes the vector as little-endian float32. Refuses a file that exists, since the
    server names a fresh one per request."""
    with path.open("xb") as file:
        file.write(vector.astype("<f4").tobytes())


def clap_handlers(checkpoint: Checkpoint) -> dict[str, Handler]:
    """The embedding methods over `checkpoint`, which tests replace with a fake. A model is
    loaded on its first request and kept for the life of the process."""
    models: dict[Path, Model] = {}

    def model(cache: Path) -> Model:
        if cache not in models:
            models[cache] = checkpoint.load(cache)
        return models[cache]

    def embedder(params: dict[str, Any]) -> dict[str, Any]:
        cache = Path(params["checkpointCache"])
        if params["fetch"]:
            checkpoint.fetch(cache)
        return {"producer": producer(), "dimension": DIMENSION, "ready": checkpoint.cached(cache)}

    def embed_audio(params: dict[str, Any]) -> dict[str, Any]:
        vector, count = embed_file(model(Path(params["checkpointCache"])), Path(params["audio"]))
        write_vector(Path(params["out"]), vector)
        return {"windows": count}

    def embed_text(params: dict[str, Any]) -> dict[str, Any]:
        vectors = model(Path(params["checkpointCache"])).text([params["text"]])
        if vectors.shape != (1, DIMENSION):
            raise ValueError(f"the model gave {vectors.shape} for one text")
        write_vector(Path(params["out"]), unit(vectors[0]))
        return {}

    return {"embedder": embedder, "embed_audio": embed_audio, "embed_text": embed_text}


# Every file transformers reads to build the model and its processor at REVISION.
CHECKPOINT_FILES = (
    "config.json",
    "preprocessor_config.json",
    "tokenizer_config.json",
    "tokenizer.json",
    "special_tokens_map.json",
    "vocab.json",
    "merges.txt",
    "pytorch_model.bin",
)


class ClapCheckpoint:
    """CHECKPOINT at REVISION through transformers, on the CPU. torch and transformers are
    imported here, not at the top, so `ping` doesn't wait on them."""

    def _file(self, cache: Path, name: str, local: bool) -> Path | None:
        from transformers.utils.hub import cached_file  # pyright: ignore[reportUnknownVariableType]

        found: str | None = cached_file(  # pyright: ignore[reportUnknownVariableType]
            CHECKPOINT,
            name,
            revision=REVISION,
            cache_dir=str(cache),
            local_files_only=local,
            _raise_exceptions_for_missing_entries=False,
        )
        return None if found is None else Path(found)

    def cached(self, cache: Path) -> bool:
        return all(self._file(cache, name, local=True) for name in CHECKPOINT_FILES)

    def fetch(self, cache: Path) -> None:
        # File by file rather than through from_pretrained, which would also fetch a
        # safetensors copy from an unpinned conversion branch of the repo.
        for name in CHECKPOINT_FILES:
            if self._file(cache, name, local=False) is None:
                raise FileNotFoundError(f"{CHECKPOINT}@{REVISION} has no {name}")

    def load(self, cache: Path) -> Model:
        config = self._file(cache, "config.json", local=True)
        if config is None or not self.cached(cache):
            raise FileNotFoundError(
                f"the CLAP checkpoint {CHECKPOINT}@{REVISION} isn't in {cache}; "
                "the embed job downloads it"
            )
        import torch
        from transformers import ClapModel, ClapProcessor

        torch.set_num_threads(TORCH_THREADS)
        # Loaded from the snapshot folder, not by the hub id, so transformers makes no request:
        # by id it asks the hub for a safetensors conversion even when told files are local.
        folder = str(config.parent)
        processor: Any = ClapProcessor.from_pretrained(folder)  # pyright: ignore[reportUnknownMemberType]
        model: Any = ClapModel.from_pretrained(folder, use_safetensors=False)  # pyright: ignore[reportUnknownMemberType]
        extractor = processor.feature_extractor
        found = (extractor.sampling_rate, extractor.nb_max_samples, model.config.projection_dim)
        if found != (SAMPLE_RATE, WINDOW_SAMPLES, DIMENSION):
            raise ValueError(
                f"the checkpoint has sample rate, window and dimension {found}, and this code "
                f"expects {(SAMPLE_RATE, WINDOW_SAMPLES, DIMENSION)}"
            )
        return _ClapModel(processor, model.to(torch.device("cpu")).eval())


class _ClapModel:
    def __init__(self, processor: Any, model: Any) -> None:
        self._processor = processor
        self._model = model

    def audio(self, windows: list[Vectors]) -> Vectors:
        import torch

        # Every window is at most WINDOW_SAMPLES, so `rand_trunc` never crops at random.
        inputs = self._processor.feature_extractor(
            windows, sampling_rate=SAMPLE_RATE, truncation="rand_trunc", return_tensors="pt"
        )
        with torch.inference_mode():
            output = self._model.get_audio_features(**inputs)
        return output.pooler_output.numpy().astype(np.float32)

    def text(self, texts: list[str]) -> Vectors:
        import torch

        inputs = self._processor.tokenizer(texts, padding=True, return_tensors="pt")
        with torch.inference_mode():
            output = self._model.get_text_features(**inputs)
        return output.pooler_output.numpy().astype(np.float32)
