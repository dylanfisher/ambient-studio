import json
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from numpy.typing import NDArray

from ambient_sidecar.preference import LEFT_BIAS, model_code, preference_handlers
from ambient_sidecar.serve import HANDLERS, serve

FEATURES = ["centroidMean", "onsetRate", "stereoWidth"]
MACROS = ["density", "space"]
DIMENSION = 32
HYPERPARAMETERS = {
    "pcaDimension": 4,
    "weightScale": 1.5,
    "vibeScale": 1.5,
    "biasScale": 1.0,
    "interceptScale": 2.0,
    "thumbsWeight": 1.0,
    "modelCode": model_code(),
}
# Each feature's mean and spread in its own unit, so a fit that skips standardizing fails.
FEATURE_CENTERS = np.array([1500.0, 0.5, 0.4])
FEATURE_SPREADS = np.array([400.0, 0.2, 0.1])
# The known utility, per standardized feature and macro: signs the fit must recover.
TRUE_FEATURES = np.array([1.2, -0.9, 0.0])
TRUE_MACROS = np.array([-1.0, 0.8])

Floats = NDArray[np.float64]


class Synthetic:
    """Items with features, macros and embeddings, and the utility that decides their pairs."""

    def __init__(self, count: int, seed: int) -> None:
        rng = np.random.default_rng(seed)
        self.standard = rng.standard_normal((count, len(FEATURES)))
        self.features = FEATURE_CENTERS + FEATURE_SPREADS * self.standard
        self.macros = rng.uniform(0, 1, (count, len(MACROS)))
        # Embeddings near a few directions, as CLAP's sit near a low-rank subspace.
        basis = rng.standard_normal((3, DIMENSION))
        raw = rng.standard_normal((count, 3)) @ basis + 0.1 * rng.standard_normal(
            (count, DIMENSION)
        )
        self.embeddings = (raw / np.linalg.norm(raw, axis=1, keepdims=True)).astype(np.float32)
        macro_standard = (self.macros - 0.5) / np.sqrt(1 / 12)
        self.utility: Floats = self.standard @ TRUE_FEATURES + macro_standard @ TRUE_MACROS

    def item(self, index: int) -> dict[str, Any]:
        return {
            "features": [float(value) for value in self.features[index]],
            "macros": [float(value) for value in self.macros[index]],
        }


def pairs_of(
    data: Synthetic, count: int, seed: int, left_bias: float = 0.0
) -> list[dict[str, Any]]:
    """Random pairs over the first half of the items, each won by Bradley-Terry draws on the
    utility, with `left_bias` added to the left side's logit."""
    rng = np.random.default_rng(seed)
    half = len(data.utility) // 2
    pairs: list[dict[str, Any]] = []
    for _ in range(count):
        left, right = (int(i) for i in rng.choice(half, size=2, replace=False))
        logit = data.utility[left] - data.utility[right] + left_bias
        left_won = bool(rng.uniform() < 1 / (1 + np.exp(-logit)))
        winner, loser = (left, right) if left_won else (right, left)
        pairs.append({"winner": winner, "loser": loser, "weight": 1.0, "winnerLeft": left_won})
    return pairs


def write_set(
    folder: Path,
    name: str,
    data: Synthetic,
    pairs: list[dict[str, Any]],
    thumbs: list[dict[str, Any]] | None = None,
    prior: Path | None = None,
    count: int | None = None,
) -> Path:
    """A training set over the first `count` items (all by default)."""
    used = len(data.utility) if count is None else count
    embeddings = folder / f"{name}.f32"
    embeddings.write_bytes(data.embeddings[:used].astype("<f4").tobytes())
    path = folder / f"{name}.json"
    path.write_text(
        json.dumps(
            {
                "hyperparameters": HYPERPARAMETERS,
                "featureNames": FEATURES,
                "macroNames": MACROS,
                "embeddingDimension": DIMENSION,
                "embeddings": str(embeddings),
                "prior": None if prior is None else str(prior),
                "items": [data.item(i) for i in range(used)],
                "pairs": pairs,
                "thumbs": thumbs or [],
            }
        )
    )
    return path


def write_items(folder: Path, name: str, data: Synthetic, indices: list[int]) -> Path:
    embeddings = folder / f"{name}.f32"
    embeddings.write_bytes(data.embeddings[indices].astype("<f4").tobytes())
    path = folder / f"{name}.json"
    path.write_text(
        json.dumps(
            {
                "featureNames": FEATURES,
                "macroNames": MACROS,
                "embeddingDimension": DIMENSION,
                "embeddings": str(embeddings),
                "items": [data.item(i) for i in indices],
            }
        )
    )
    return path


def run(*requests: dict[str, Any]) -> list[dict[str, Any]]:
    written: list[str] = []
    lines = [f"{json.dumps(request)}\n".encode() for request in requests]
    serve(lines, written.append, {**HANDLERS, **preference_handlers()})
    return [json.loads(text) for text in written]


def fit(set_path: Path, out: Path) -> dict[str, Any]:
    params = {"set": str(set_path), "out": str(out)}
    [answer] = run({"id": 1, "method": "fit", "params": params})
    assert "result" in answer, answer
    result: dict[str, Any] = answer["result"]
    return result


def predict(model: Path, items: Path, out: Path) -> dict[str, Any]:
    params = {"model": str(model), "items": str(items), "out": str(out)}
    [answer] = run({"id": 1, "method": "predict", "params": params})
    assert "result" in answer, answer
    predicted: dict[str, Any] = json.loads(out.read_text())
    return predicted


def read_model(path: Path) -> dict[str, Any]:
    model: dict[str, Any] = json.loads(path.read_text())
    return model


def weight(model: dict[str, Any], term: str) -> float:
    return float(model["mean"][model["terms"].index(term)])


def held_out_agreement(data: Synthetic, scores: Floats, seed: int) -> float:
    """The share of random pairs among the held-out half that the scores order as the
    utility does."""
    rng = np.random.default_rng(seed)
    half = len(data.utility) // 2
    agreed = 0
    trials = 500
    for _ in range(trials):
        i, j = rng.choice(len(data.utility) - half, size=2, replace=False)
        truth = data.utility[half + i] > data.utility[half + j]
        agreed += int((scores[i] > scores[j]) == truth)
    return agreed / trials


def test_the_fit_recovers_the_weights_signs_and_ranks_held_out_items(tmp_path: Path) -> None:
    data = Synthetic(200, seed=1)
    # Fitted on the training half alone, so the basis never sees a held-out item.
    set_path = write_set(tmp_path, "set", data, pairs_of(data, 200, seed=2), count=100)
    result = fit(set_path, tmp_path / "model.json")
    assert result["pairs"] == 200
    model = read_model(tmp_path / "model.json")
    for name, true in zip(FEATURES, TRUE_FEATURES, strict=True):
        if true != 0:
            assert np.sign(weight(model, f"feature:{name}")) == np.sign(true), name
    for name, true in zip(MACROS, TRUE_MACROS, strict=True):
        assert np.sign(weight(model, f"macro:{name}")) == np.sign(true), name

    held_out = list(range(100, 200))
    items = write_items(tmp_path, "items", data, held_out)
    predicted = predict(tmp_path / "model.json", items, tmp_path / "scores.json")
    assert held_out_agreement(data, np.array(predicted["mean"]), seed=3) > 0.8


def test_variance_falls_as_pairs_are_added(tmp_path: Path) -> None:
    data = Synthetic(200, seed=4)
    items = write_items(tmp_path, "items", data, list(range(100, 200)))
    variances: list[float] = []
    for count in (10, 40, 160):
        pairs = pairs_of(data, count, seed=5)
        set_path = write_set(tmp_path, f"set-{count}", data, pairs, count=100)
        model = tmp_path / f"model-{count}.json"
        fit(set_path, model)
        predicted = predict(model, items, tmp_path / f"scores-{count}.json")
        variances.append(float(np.mean(np.array(predicted["variance"], dtype=np.float64))))
    assert variances[0] > variances[1] > variances[2]


def test_predict_gives_each_pairs_difference_variance(tmp_path: Path) -> None:
    data = Synthetic(60, seed=6)
    set_path = write_set(tmp_path, "set", data, pairs_of(data, 40, seed=7))
    fit(set_path, tmp_path / "model.json")
    items = write_items(tmp_path, "items", data, [30, 31, 32])
    predicted = predict(tmp_path / "model.json", items, tmp_path / "scores.json")
    covariance = np.array(predicted["covariance"])
    assert covariance.shape == (3, 3)
    assert np.allclose(np.diag(covariance), predicted["variance"])
    assert np.array_equal(covariance, covariance.T)
    difference = covariance[0, 0] + covariance[1, 1] - 2 * covariance[0, 1]
    assert difference > 0


def test_a_vibe_with_no_pairs_predicts_from_the_global_prior(tmp_path: Path) -> None:
    data = Synthetic(120, seed=8)
    global_set = write_set(tmp_path, "global", data, pairs_of(data, 80, seed=9))
    fit(global_set, tmp_path / "global-model.json")
    vibe_set = write_set(tmp_path, "vibe", data, [], prior=tmp_path / "global-model.json", count=0)
    result = fit(vibe_set, tmp_path / "vibe-model.json")
    assert (result["pairs"], result["thumbs"]) == (0, 0)

    items = write_items(tmp_path, "items", data, list(range(60, 70)))
    from_global = predict(tmp_path / "global-model.json", items, tmp_path / "g.json")
    from_vibe = predict(tmp_path / "vibe-model.json", items, tmp_path / "v.json")
    assert from_vibe["mean"] == from_global["mean"]
    # The vibe's weights may stray from the global ones by its own prior, so it is less sure.
    assert all(v > g for v, g in zip(from_vibe["variance"], from_global["variance"], strict=True))


def test_a_prior_fit_with_no_ratings_at_all_predicts_zero(tmp_path: Path) -> None:
    data = Synthetic(10, seed=10)
    empty = write_set(tmp_path, "empty", data, [], count=0)
    result = fit(empty, tmp_path / "model.json")
    assert result == {"pairs": 0, "thumbs": 0, "items": 0, "clapDimension": 0, "iterations": 0}
    items = write_items(tmp_path, "items", data, [0, 1])
    predicted = predict(tmp_path / "model.json", items, tmp_path / "scores.json")
    assert predicted["mean"] == [0.0, 0.0]
    # With no items, every column has no spread, so no term can tell two candidates apart.
    assert predicted["variance"] == [0.0, 0.0]


def test_thumbs_alone_fit_the_scores(tmp_path: Path) -> None:
    data = Synthetic(200, seed=11)
    rng = np.random.default_rng(12)
    thumbs = [
        {"item": i, "up": bool(rng.uniform() < 1 / (1 + np.exp(-data.utility[i])))}
        for i in range(100)
    ]
    set_path = write_set(tmp_path, "set", data, [], thumbs=thumbs, count=100)
    result = fit(set_path, tmp_path / "model.json")
    assert (result["pairs"], result["thumbs"]) == (0, 100)
    model = read_model(tmp_path / "model.json")
    # No pair says which side won, so the left bias stays at its prior.
    assert weight(model, LEFT_BIAS) == 0
    items = write_items(tmp_path, "items", data, list(range(100, 200)))
    predicted = predict(tmp_path / "model.json", items, tmp_path / "scores.json")
    assert held_out_agreement(data, np.array(predicted["mean"]), seed=13) > 0.7


def test_a_planted_left_bias_is_learned_by_the_bias_term_not_the_weights(tmp_path: Path) -> None:
    data = Synthetic(200, seed=14)
    plain = write_set(tmp_path, "plain", data, pairs_of(data, 1000, seed=15))
    biased = write_set(tmp_path, "biased", data, pairs_of(data, 1000, seed=15, left_bias=1.5))
    fit(plain, tmp_path / "plain-model.json")
    fit(biased, tmp_path / "biased-model.json")
    without, with_bias = (
        read_model(tmp_path / "plain-model.json"),
        read_model(tmp_path / "biased-model.json"),
    )
    assert abs(weight(without, LEFT_BIAS)) < 0.3
    assert abs(weight(with_bias, LEFT_BIAS) - 1.5) < 0.3
    names = [f"feature:{name}" for name in FEATURES] + [f"macro:{name}" for name in MACROS]
    for name in names:
        assert abs(weight(with_bias, name) - weight(without, name)) < 0.25, name


def test_the_same_set_fits_to_identical_bytes_twice(tmp_path: Path) -> None:
    data = Synthetic(100, seed=16)
    thumbs = [{"item": 3, "up": True}, {"item": 4, "up": False}]
    set_path = write_set(tmp_path, "set", data, pairs_of(data, 60, seed=17), thumbs=thumbs)
    fit(set_path, tmp_path / "one.json")
    fit(set_path, tmp_path / "two.json")
    assert (tmp_path / "one.json").read_bytes() == (tmp_path / "two.json").read_bytes()


def test_a_tie_pulls_the_two_scores_together(tmp_path: Path) -> None:
    data = Synthetic(40, seed=18)
    # Item 0 beats item 1 twice; a tie's two halves then pull them back toward each other.
    wins = [{"winner": 0, "loser": 1, "weight": 1.0, "winnerLeft": True}] * 2
    tie = [
        {"winner": 0, "loser": 1, "weight": 0.5, "winnerLeft": True},
        {"winner": 1, "loser": 0, "weight": 0.5, "winnerLeft": False},
    ]
    items = write_items(tmp_path, "items", data, [0, 1])
    gaps: list[float] = []
    for name, pairs in (("wins", wins), ("tied", wins + tie * 3)):
        fit(write_set(tmp_path, name, data, pairs), tmp_path / f"{name}-model.json")
        mean = predict(tmp_path / f"{name}-model.json", items, tmp_path / f"{name}-s.json")["mean"]
        gaps.append(mean[0] - mean[1])
    assert gaps[0] > gaps[1] > 0


def test_predict_refuses_items_with_other_feature_names(tmp_path: Path) -> None:
    data = Synthetic(20, seed=19)
    fit(write_set(tmp_path, "set", data, pairs_of(data, 10, seed=20)), tmp_path / "model.json")
    items = write_items(tmp_path, "items", data, [0])
    written = json.loads(items.read_text())
    items.write_text(json.dumps({**written, "featureNames": ["centroidMean"]}))
    params = {
        "model": str(tmp_path / "model.json"),
        "items": str(items),
        "out": str(tmp_path / "o"),
    }
    [answer] = run({"id": 1, "method": "predict", "params": params})
    assert "featureNames" in answer["error"]
    assert not (tmp_path / "o").exists()


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"pairs": [{"winner": 0, "loser": 99, "weight": 1.0, "winnerLeft": True}]}, "item 99"),
        ({"hyperparameters": {**HYPERPARAMETERS, "pcaDimension": -1}}, "pcaDimension"),
        ({"hyperparameters": {"pcaDimension": 4, "modelCode": model_code()}}, "weightScale"),
        ({"hyperparameters": {**HYPERPARAMETERS, "modelCode": "preference-old"}}, "modelCode"),
        ({"embeddings": "relative.f32"}, "absolute"),
    ],
)
def test_a_malformed_set_is_an_error_answer(
    tmp_path: Path, change: dict[str, Any], message: str
) -> None:
    data = Synthetic(10, seed=21)
    set_path = write_set(tmp_path, "set", data, [])
    set_path.write_text(json.dumps({**json.loads(set_path.read_text()), **change}))
    params = {"set": str(set_path), "out": str(tmp_path / "model.json")}
    [answer] = run({"id": 1, "method": "fit", "params": params})
    assert message in answer["error"]
    assert not (tmp_path / "model.json").exists()


def test_an_embeddings_file_of_the_wrong_length_is_an_error_answer(tmp_path: Path) -> None:
    data = Synthetic(10, seed=22)
    set_path = write_set(tmp_path, "set", data, [])
    (tmp_path / "set.f32").write_bytes(b"\0" * 12)
    [answer] = run(
        {
            "id": 1,
            "method": "fit",
            "params": {"set": str(set_path), "out": str(tmp_path / "model.json")},
        }
    )
    assert "12 bytes" in answer["error"]


def test_preference_code_is_the_hash_every_set_must_name() -> None:
    [answer] = run({"id": 1, "method": "preference_code", "params": {}})
    assert answer == {"id": 1, "result": {"code": model_code()}}
    assert model_code().startswith("preference-")


def test_a_constant_or_unmeasured_column_cannot_move_a_candidates_variance(
    tmp_path: Path,
) -> None:
    data = Synthetic(100, seed=23)
    # Stereo width is the same on every training item, and onset rate is measured on one.
    data.features[:, 2] = 0.4
    set_path = write_set(tmp_path, "set", data, pairs_of(data, 60, seed=24))
    record = json.loads(set_path.read_text())
    for i, item in enumerate(record["items"]):
        item["features"][1] = 0.5 if i == 0 else None
    set_path.write_text(json.dumps(record))
    fit(set_path, tmp_path / "model.json")

    items = write_items(tmp_path, "items", data, [0, 0])
    written = json.loads(items.read_text())
    written["items"][1]["features"][1] = 1e6
    written["items"][1]["features"][2] = 1e6
    items.write_text(json.dumps(written))
    predicted = predict(tmp_path / "model.json", items, tmp_path / "scores.json")
    assert predicted["variance"][1] == predicted["variance"][0]
    assert predicted["mean"][1] == predicted["mean"][0]


def test_a_component_with_almost_no_variance_is_dropped(tmp_path: Path) -> None:
    data = Synthetic(60, seed=25)
    rng = np.random.default_rng(26)
    # Two real directions, and noise whose variance is about 1e-6 of theirs.
    plane = rng.standard_normal((60, 2)) @ rng.standard_normal((2, DIMENSION))
    data.embeddings = (plane + 1e-3 * rng.standard_normal((60, DIMENSION))).astype(np.float32)
    result = fit(write_set(tmp_path, "set", data, pairs_of(data, 20, seed=27)), tmp_path / "m")
    assert result["clapDimension"] == 2
