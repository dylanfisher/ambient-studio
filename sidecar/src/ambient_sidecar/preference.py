"""The preference model: Bayesian logistic Bradley-Terry with a Laplace posterior (decision 0044).

An item's score is a weighted sum of its terms: its CLAP embedding projected on the top
principal components of the basis items' embeddings, each scaled to unit variance, and its
features and macros, standardized. A pair is won with probability sigmoid(score difference plus
the left/right bias); a thumbs up with sigmoid(score plus an intercept). The fit is the mode of
the posterior under a Gaussian prior, found by Newton's method, and the posterior is the
Gaussian whose precision is the Hessian there.

A fit with no prior model is a vibe's prior: fitted on the other vibes' ratings under a prior
centered on zero, it computes the basis (the projection and the standardization) from every
item its file lists. A vibe's fit names that model as its prior, takes its basis, and centers
its prior on that model's posterior mean. Sets, items and models are JSON files the server names
by path (decision 0041); embeddings are float32 files, one row per item.
"""

import functools
import hashlib
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

from ambient_sidecar.protocol import Handler

Floats = NDArray[np.float64]

LEFT_BIAS = "leftBias"
THUMBS_INTERCEPT = "thumbsIntercept"

# The hyperparameters a fit reads; the server defines their values and puts them in the key.
HYPERPARAMETERS = (
    "pcaDimension",
    "weightScale",
    "vibeScale",
    "biasScale",
    "interceptScale",
    "thumbsWeight",
)
# The server's own hyperparameters, which make a key change when what it names does: a vibe's
# prior model's key, and the key of the sets a prior's basis comes from. The fit reads the prior
# and the basis items from the set file instead.
SERVER_ONLY = ("globalModel", "basis")
# The hash of this file, which every set names, so the model key changes with the model code.
MODEL_CODE = "modelCode"

# A component whose variance is below this share of the largest component's is dropped:
# whitening would scale it up by over 30 times, and a candidate far out along it would get a
# score variance its training items never showed.
COMPONENT_VARIANCE_FLOOR = 1e-3
# A feature or macro column whose spread is below this share of its mean's size (or of 1) holds
# one value, and adds nothing.
CONSTANT_TOLERANCE = 1e-9
# Newton's method stops when no parameter moves more than this; a logistic loss with a Gaussian
# prior is strictly convex, so it gets there in a few tens of steps at most.
STEP_TOLERANCE = 1e-10
MAX_ITERATIONS = 100


@functools.cache
def model_code() -> str:
    """The SHA-256 of this file's source, read once per process."""
    return f"preference-{hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}"


def read_json(path: Path) -> dict[str, Any]:
    value: object = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} doesn't hold a JSON object")
    record: dict[str, Any] = value  # pyright: ignore[reportUnknownVariableType]
    return record


def write_json(path: Path, value: dict[str, Any]) -> None:
    """Refuses a file that exists, since the server names a fresh one per request. Floats are
    written by repr, which reads back to the same bits."""
    text = json.dumps(value, allow_nan=False, separators=(",", ":"))
    with path.open("x", encoding="utf-8") as file:
        file.write(text)


def _absolute(value: object, what: str) -> Path:
    if not isinstance(value, str) or not Path(value).is_absolute():
        raise ValueError(f"{what} must be an absolute path, got {json.dumps(value)}")
    return Path(value)


def _names(record: dict[str, Any], key: str) -> list[str]:
    names = record.get(key)
    if not isinstance(names, list) or not all(isinstance(n, str) for n in names):  # pyright: ignore[reportUnknownVariableType]
        raise ValueError(f"{key} must be a list of names")
    return list(names)  # pyright: ignore[reportUnknownArgumentType]


def _hyperparameters(record: dict[str, Any]) -> dict[str, float]:
    given = record.get("hyperparameters")
    if not isinstance(given, dict):
        raise ValueError("the set has no hyperparameters object")
    values: dict[str, Any] = given  # pyright: ignore[reportUnknownVariableType]
    for key in values:
        if key not in HYPERPARAMETERS and key not in SERVER_ONLY and key != MODEL_CODE:
            raise ValueError(f"the hyperparameters have {key}, which the fit doesn't read")
    if values.get(MODEL_CODE) != model_code():
        raise ValueError(
            f"the set's {MODEL_CODE} is {values.get(MODEL_CODE)!r}, and this code is "
            f"{model_code()!r}; the server must ask preference_code again"
        )
    found: dict[str, float] = {}
    for key in HYPERPARAMETERS:
        value = values.get(key)
        if isinstance(value, bool) or not isinstance(value, int | float):
            raise ValueError(f"the hyperparameters' {key} must be a number, got {value!r}")
        # The PCA dimension may be 0, for a fit on features and macros alone; a scale may not.
        lowest_ok = value >= 0 if key == "pcaDimension" else value > 0
        if not math.isfinite(value) or not lowest_ok:
            raise ValueError(f"the hyperparameters' {key} is out of range: {value}")
        found[key] = float(value)
    if not found["pcaDimension"].is_integer():
        raise ValueError(f"the hyperparameters' pcaDimension must be whole: {found}")
    return found


class Items:
    """Items as columns of raw values: embeddings as rows, features and macros with NaN where
    the excerpt had nothing to measure."""

    def __init__(self, record: dict[str, Any], feature_names: list[str], macro_names: list[str]):
        rows: object = record.get("items")
        if not isinstance(rows, list):
            raise ValueError("items must be a list")
        items: list[Any] = rows  # pyright: ignore[reportUnknownVariableType]
        self.count = len(items)
        self.features = self._column(items, "features", len(feature_names))
        self.macros = self._column(items, "macros", len(macro_names))
        if np.isnan(self.macros).any():
            raise ValueError("every item needs a value for every macro")
        dimension = record.get("embeddingDimension")
        if isinstance(dimension, bool) or not isinstance(dimension, int) or dimension < 1:
            raise ValueError(f"embeddingDimension must be a whole number, got {dimension!r}")
        path = _absolute(record.get("embeddings"), "embeddings")
        raw = path.read_bytes()
        if len(raw) != self.count * dimension * 4:
            raise ValueError(
                f"{path} holds {len(raw)} bytes, not {self.count} embeddings of {dimension} floats"
            )
        self.dimension = dimension
        self.embeddings: Floats = (
            np.frombuffer(raw, dtype="<f4").reshape(self.count, dimension).astype(np.float64)
        )

    @staticmethod
    def _column(items: list[Any], key: str, width: int) -> Floats:
        values = np.full((len(items), width), np.nan)
        for i, item in enumerate(items):
            row = item.get(key) if isinstance(item, dict) else None  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
            if not isinstance(row, list) or len(row) != width:  # pyright: ignore[reportUnknownArgumentType]
                raise ValueError(f"item {i} needs {width} {key}")
            for j, value in enumerate(row):  # pyright: ignore[reportUnknownVariableType, reportUnknownArgumentType]
                if value is None:
                    continue
                if isinstance(value, bool) or not isinstance(value, int | float):
                    raise ValueError(f"item {i}'s {key}[{j}] must be a number or null")
                values[i, j] = value
        return values


def _standardization(values: Floats) -> tuple[Floats, Floats]:
    """Each column's mean and standard deviation over its measured values. A column with fewer
    than two values, or one value throughout, gets a scale of 0, which `terms` reads as a term
    of 0 for every item, so a candidate's value there can't move its score or variance."""
    width = values.shape[1]
    means = np.zeros(width)
    scales = np.zeros(width)
    for j in range(width):
        measured = values[~np.isnan(values[:, j]), j]
        if measured.size == 0:
            continue
        means[j] = measured.mean()
        spread = measured.std()
        # A column of one value has a spread of rounding error, not exactly 0.
        if measured.size >= 2 and spread > CONSTANT_TOLERANCE * max(abs(means[j]), 1.0):
            scales[j] = spread
    return means, scales


def make_basis(items: Items, pca_dimension: int) -> dict[str, Any]:
    """The projection and standardization the global set's items give."""
    embedding_mean = items.embeddings.mean(axis=0) if items.count > 0 else np.zeros(items.dimension)
    components = np.zeros((0, items.dimension))
    component_scales = np.zeros(0)
    if items.count >= 2:
        _, singular, right = np.linalg.svd(items.embeddings - embedding_mean, full_matrices=False)
        variance = singular**2
        floor = variance[0] * COMPONENT_VARIANCE_FLOOR
        rank = np.count_nonzero(variance > floor) if variance[0] > 0 else 0
        kept = min(pca_dimension, rank)
        components = right[:kept].copy()
        # A component's sign is arbitrary; its largest loading is made positive so one set
        # always gives one basis.
        for k in range(kept):
            if components[k, np.argmax(np.abs(components[k]))] < 0:
                components[k] = -components[k]
        component_scales = singular[:kept] / math.sqrt(items.count - 1)
    feature_means, feature_scales = _standardization(items.features)
    macro_means, macro_scales = _standardization(items.macros)
    return {
        "embeddingMean": embedding_mean.tolist(),
        "components": components.tolist(),
        "componentScales": component_scales.tolist(),
        "featureMeans": feature_means.tolist(),
        "featureScales": feature_scales.tolist(),
        "macroMeans": macro_means.tolist(),
        "macroScales": macro_scales.tolist(),
    }


def terms(items: Items, basis: dict[str, Any]) -> Floats:
    """Each item's terms as a row: its components, features and macros, in that order. A
    feature with no value takes the mean, and a column with a scale of 0 is 0, so neither adds
    anything to the score."""
    components = np.array(basis["components"]).reshape(-1, items.dimension)
    projected = (items.embeddings - np.array(basis["embeddingMean"])) @ components.T
    projected = projected / np.array(basis["componentScales"])
    features = _standardized(items.features, basis["featureMeans"], basis["featureScales"])
    macros = _standardized(items.macros, basis["macroMeans"], basis["macroScales"])
    return np.hstack([projected, features, macros])


def _standardized(values: Floats, means: list[float], scales: list[float]) -> Floats:
    scale = np.array(scales)
    usable = scale > 0
    centered = values - np.array(means)
    result: Floats = np.where(
        usable & ~np.isnan(centered), centered / np.where(usable, scale, 1.0), 0.0
    )
    return result


def term_names(clap: int, feature_names: list[str], macro_names: list[str]) -> list[str]:
    return [
        *(f"clap:{k + 1}" for k in range(clap)),
        *(f"feature:{name}" for name in feature_names),
        *(f"macro:{name}" for name in macro_names),
    ]


def _rows(
    record: dict[str, Any], phi: Floats, thumbs_weight: float
) -> tuple[Floats, Floats, Floats, int, int]:
    """The logistic rows: one per pair, its winner's terms less its loser's with the bias
    column +1 when the winner was on the left and -1 when on the right, and one per thumbs, its
    item's terms with the intercept column 1. Returns rows, labels, weights and the counts."""
    width = phi.shape[1]
    rows: list[Floats] = []
    labels: list[float] = []
    weights: list[float] = []

    def item(index: object) -> Floats:
        if isinstance(index, bool) or not isinstance(index, int) or not 0 <= index < len(phi):
            raise ValueError(f"the set names item {index}, which it doesn't hold")
        return phi[index]

    pairs: list[Any] = record.get("pairs", [])
    thumbs: list[Any] = record.get("thumbs", [])
    for pair in pairs:
        weight = pair["weight"]
        if isinstance(weight, bool) or not isinstance(weight, int | float) or weight <= 0:
            raise ValueError(f"a pair's weight must be a positive number, got {weight!r}")
        side = 1.0 if pair["winnerLeft"] is True else -1.0
        difference = item(pair["winner"]) - item(pair["loser"])
        rows.append(np.concatenate([difference, [side, 0.0]]))
        labels.append(1.0)
        weights.append(float(weight))
    for thumb in thumbs:
        rows.append(np.concatenate([item(thumb["item"]), [0.0, 1.0]]))
        labels.append(1.0 if thumb["up"] is True else 0.0)
        weights.append(thumbs_weight)
    matrix = np.array(rows) if rows else np.zeros((0, width + 2))
    return matrix, np.array(labels), np.array(weights), len(pairs), len(thumbs)


def _sigmoid(z: Floats) -> Floats:
    result: Floats = 0.5 * (1.0 + np.tanh(0.5 * z))
    return result


def _loss(
    theta: Floats, rows: Floats, labels: Floats, weights: Floats, mean: Floats, precision: Floats
) -> float:
    z = rows @ theta
    # -log sigmoid(z) is logaddexp(0, -z), which doesn't overflow.
    data = weights * (labels * np.logaddexp(0, -z) + (1 - labels) * np.logaddexp(0, z))
    return float(data.sum() + 0.5 * np.sum(precision * (theta - mean) ** 2))


def laplace(
    rows: Floats, labels: Floats, weights: Floats, mean: Floats, precision: Floats
) -> tuple[Floats, Floats, int]:
    """The posterior mode under the prior N(mean, diag(1 / precision)) by Newton's method,
    halving a step that doesn't lower the loss, and the covariance there."""
    theta = mean.copy()
    iterations = 0
    while True:
        p = _sigmoid(rows @ theta)
        gradient = rows.T @ (weights * (p - labels)) + precision * (theta - mean)
        hessian = rows.T @ (rows * (weights * p * (1 - p))[:, None]) + np.diag(precision)
        if not np.any(gradient):
            break
        if iterations == MAX_ITERATIONS:
            raise ArithmeticError(f"the fit didn't converge in {MAX_ITERATIONS} Newton steps")
        iterations += 1
        step = np.linalg.solve(hessian, gradient)
        before = _loss(theta, rows, labels, weights, mean, precision)
        scale = 1.0
        while _loss(theta - scale * step, rows, labels, weights, mean, precision) > before:
            scale /= 2
            if scale < 1e-12:
                raise ArithmeticError("the fit found no step that lowers the loss")
        theta = theta - scale * step
        if np.max(np.abs(scale * step)) < STEP_TOLERANCE:
            break
    p = _sigmoid(rows @ theta)
    hessian = rows.T @ (rows * (weights * p * (1 - p))[:, None]) + np.diag(precision)
    covariance = np.linalg.inv(hessian)
    return theta, (covariance + covariance.T) / 2, iterations


def fit(params: dict[str, Any]) -> dict[str, Any]:
    record = read_json(Path(params["set"]))
    feature_names = _names(record, "featureNames")
    macro_names = _names(record, "macroNames")
    hyper = _hyperparameters(record)
    items = Items(record, feature_names, macro_names)
    prior_path = record.get("prior")
    if prior_path is None:
        basis = make_basis(items, int(hyper["pcaDimension"]))
        weight_scale = hyper["weightScale"]
        prior_mean = None
    else:
        prior = read_json(_absolute(prior_path, "prior"))
        for key, names in (("featureNames", feature_names), ("macroNames", macro_names)):
            if prior[key] != names:
                raise ValueError(f"the prior's {key} differ from the set's")
        if prior["embeddingDimension"] != items.dimension:
            raise ValueError("the prior's embeddingDimension differs from the set's")
        basis = prior["basis"]
        weight_scale = hyper["vibeScale"]
        prior_mean = np.array(prior["mean"])
    phi = terms(items, basis)
    width = phi.shape[1]
    # Per-weight variance scale² / width, so the prior spread of an item's score is about
    # `scale` whatever the number of terms.
    variance = np.array(
        [weight_scale**2 / width] * width + [hyper["biasScale"] ** 2, hyper["interceptScale"] ** 2]
    )
    mean = np.zeros(width + 2) if prior_mean is None else prior_mean
    if mean.shape != (width + 2,):
        raise ValueError(f"the prior has {mean.shape[0]} parameters, not {width + 2}")
    rows, labels, weights, pairs, thumbs = _rows(record, phi, hyper["thumbsWeight"])
    theta, covariance, iterations = laplace(rows, labels, weights, mean, 1 / variance)
    clap = len(basis["componentScales"])
    write_json(
        Path(params["out"]),
        {
            "featureNames": feature_names,
            "macroNames": macro_names,
            "embeddingDimension": items.dimension,
            "hyperparameters": record["hyperparameters"],
            "basis": basis,
            "terms": [*term_names(clap, feature_names, macro_names), LEFT_BIAS, THUMBS_INTERCEPT],
            "mean": theta.tolist(),
            "covariance": covariance.tolist(),
            "pairs": pairs,
            "thumbs": thumbs,
        },
    )
    return {
        "pairs": pairs,
        "thumbs": thumbs,
        "items": items.count,
        "clapDimension": clap,
        "iterations": iterations,
    }


def predict(params: dict[str, Any]) -> dict[str, Any]:
    """Each item's score mean and variance, and the covariance of every two, from which a
    pair's difference has variance var(a) + var(b) - 2 cov(a, b)."""
    model = read_json(Path(params["model"]))
    record = read_json(Path(params["items"]))
    for key in ("featureNames", "macroNames", "embeddingDimension"):
        if record.get(key) != model[key]:
            raise ValueError(f"the items' {key} differ from the model's")
    items = Items(record, model["featureNames"], model["macroNames"])
    phi = terms(items, model["basis"])
    width = phi.shape[1]
    weights = np.array(model["mean"])[:width]
    covariance = np.array(model["covariance"])[:width, :width]
    scores = phi @ weights
    joint = phi @ covariance @ phi.T
    joint = (joint + joint.T) / 2
    write_json(
        Path(params["out"]),
        {
            "mean": scores.tolist(),
            "variance": np.diag(joint).tolist(),
            "covariance": joint.tolist(),
        },
    )
    return {"count": items.count}


def preference_code(params: dict[str, Any]) -> dict[str, Any]:
    return {"code": model_code()}


def preference_handlers() -> dict[str, Handler]:
    return {"fit": fit, "predict": predict, "preference_code": preference_code}
