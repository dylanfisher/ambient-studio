import math

import numpy
import pytest

from ambient_sidecar.pairwise_gp import (
    NOISE,
    SIGNAL_VARIANCE,
    Posterior,
    expected_improvement,
    kernel,
)

POINTS = numpy.array([[0.2], [0.6]])
SCALE = 0.3
RHO = math.exp(-(0.4**2) / (2 * SCALE**2))
PRIOR = SIGNAL_VARIANCE * numpy.array([[1, RHO], [RHO, 1]])


def phi(z: float) -> float:
    return math.exp(-z * z / 2) / math.sqrt(2 * math.pi)


def cdf(z: float) -> float:
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))


def mills(z: float) -> float:
    return phi(z) / cdf(z)


def hand_posterior(z: float, weight: float) -> numpy.ndarray:
    """(K^-1 + W)^-1 for choices between the two points whose scaled difference is z, each of
    the given weight: W = c [[1, -1], [-1, 1]], c = weight r (z + r) / (2 NOISE^2)."""
    c = weight * mills(z) * (z + mills(z)) / (2 * NOISE**2)
    w = c * numpy.array([[1, -1], [-1, 1]])
    return numpy.linalg.inv(numpy.linalg.inv(PRIOR) + w)


def test_one_choice_between_two_points_gives_the_hand_worked_mode_and_covariance() -> None:
    # By symmetry the mode is (a, -a). With z = (f1 - f2) / (sqrt 2 NOISE) = sqrt 2 a / NOISE,
    # the objective log Phi(z) - a^2 / (s^2 (1 - rho)) is stationary where
    # r(z) sqrt 2 / NOISE = 2 a / (s^2 (1 - rho)); found here by bisection.
    def slope(a: float) -> float:
        z = math.sqrt(2) * a / NOISE
        return mills(z) * math.sqrt(2) / NOISE - 2 * a / (SIGNAL_VARIANCE * (1 - RHO))

    low, high = 0.0, 10.0
    for _ in range(200):
        middle = (low + high) / 2
        low, high = (middle, high) if slope(middle) > 0 else (low, middle)
    a = (low + high) / 2

    posterior = Posterior(POINTS, [(0, 1, 1.0)], SCALE)
    mean, covariance = posterior.predict(POINTS)
    assert mean == pytest.approx([a, -a], abs=1e-6)
    expected = hand_posterior(math.sqrt(2) * a / NOISE, 1.0)
    assert covariance == pytest.approx(expected, abs=1e-6)


def test_a_tie_holds_the_two_together_at_zero() -> None:
    posterior = Posterior(POINTS, [(0, 1, 0.5), (1, 0, 0.5)], SCALE)
    mean, covariance = posterior.predict(POINTS)
    assert mean == pytest.approx([0, 0], abs=1e-9)
    # Two halves at z = 0 weigh as one choice there.
    assert covariance == pytest.approx(hand_posterior(0.0, 1.0), abs=1e-6)


def test_with_no_choices_the_posterior_is_the_prior() -> None:
    posterior = Posterior(POINTS, [], SCALE)
    mean, covariance = posterior.predict(numpy.array([[0.4], [0.9]]))
    assert mean == pytest.approx([0, 0])
    expected = kernel(numpy.array([[0.4], [0.9]]), numpy.array([[0.4], [0.9]]), SCALE)
    assert covariance == pytest.approx(expected, abs=1e-6)


def test_expected_improvement_is_the_closed_form_of_the_difference() -> None:
    posterior = Posterior(POINTS, [(0, 1, 1.0)], SCALE)
    draws = numpy.array([[0.1], [0.4], [0.9]])
    both = numpy.vstack([draws, POINTS[:1]])
    mean, covariance = posterior.predict(both)
    for i, value in enumerate(expected_improvement(posterior, draws, 0)):
        gap = mean[i] - mean[3]
        spread = math.sqrt(covariance[i, i] + covariance[3, 3] - 2 * covariance[i, 3])
        assert value == pytest.approx(gap * cdf(gap / spread) + spread * phi(gap / spread))
