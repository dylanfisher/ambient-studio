"""A Gaussian process over [0, 1]^d learned from pairwise choices (decision 0055).

The latent utility f has a zero-mean prior with a squared-exponential kernel. A choice of u over
v has probit likelihood Phi((f(u) - f(v)) / (sqrt(2) * NOISE)), after Chu and Ghahramani's
preference learning; a tie is two half-weight choices, one each way, as 4d reads a tie (0043).
The posterior is Laplace's: the mode found by Newton's method, as `preference.laplace` finds its
own, and the Gaussian whose precision is the Hessian there. Expected improvement is taken over
the difference f(x) - f(best), whose mean and variance the posterior gives.
"""

import math

import numpy as np
from numpy.typing import NDArray

Floats = NDArray[np.float64]

# The prior's variance of f at a point; utilities are only ever compared, so 1 sets the units.
SIGNAL_VARIANCE = 1.0
# The probit's noise, in units of f: a difference of 0.2 is chosen the right way 76% of the time.
NOISE = 0.2
# The kernel's length scale is this many draw steps per dimension, scaled by sqrt(d) as distances
# in [0, 1]^d are, so a draw one step from the best keeps a prior correlation with it of about
# exp(-1/8), 0.88, in any dimension.
LENGTH_STEPS = 2.0
# Added to the kernel's diagonal, so two points told at one place keep it invertible.
JITTER = 1e-8
# Newton's method stops when no utility moves more than this; the log-likelihood is concave and
# the prior strictly so, so it gets there in a few steps.
STEP_TOLERANCE = 1e-10
MAX_ITERATIONS = 100
# Below this z, Phi(z) is computed from its asymptotic series, since erfc underflows past -37.
TAIL = -20.0


def length_scale(step: float, dimension: int) -> float:
    return LENGTH_STEPS * step * math.sqrt(dimension)


def kernel(a: Floats, b: Floats, scale: float) -> Floats:
    """The squared-exponential covariance of each row of `a` with each row of `b`."""
    squared = ((a[:, None, :] - b[None, :, :]) ** 2).sum(axis=2)
    result: Floats = SIGNAL_VARIANCE * np.exp(-squared / (2 * scale**2))
    return result


def _log_cdf(z: float) -> float:
    """log Phi(z), finite for any z."""
    if z > TAIL:
        return math.log(0.5 * math.erfc(-z / math.sqrt(2)))
    # Phi(z) ~ phi(z) / -z * (1 - 1/z^2 + 3/z^4) for large -z.
    return (
        -0.5 * z * z - math.log(-z) - 0.5 * math.log(2 * math.pi) + math.log1p(-1 / z**2 + 3 / z**4)
    )


def _mills(z: float) -> float:
    """phi(z) / Phi(z), the derivative of log Phi at z."""
    if z > TAIL:
        return (
            math.exp(-0.5 * z * z) / math.sqrt(2 * math.pi) / (0.5 * math.erfc(-z / math.sqrt(2)))
        )
    return -z / (1 - 1 / z**2 + 3 / z**4)


def normal_cdf(z: Floats) -> Floats:
    return np.array([0.5 * math.erfc(-u / math.sqrt(2)) for u in z.tolist()])


def normal_pdf(z: Floats) -> Floats:
    result: Floats = np.exp(-0.5 * z * z) / math.sqrt(2 * math.pi)
    return result


Comparison = tuple[int, int, float]


class Posterior:
    """The Laplace posterior over f at `points`, given choices (winner, loser, weight) between
    them, each an index into `points`."""

    def __init__(self, points: Floats, comparisons: list[Comparison], scale: float) -> None:
        self.points = points
        self.scale = scale
        n = len(points)
        self.prior = kernel(points, points, scale) + JITTER * np.eye(n)
        # Row k maps f to choice k's scaled difference, (f[winner] - f[loser]) / (sqrt 2 NOISE).
        self.differences = np.zeros((len(comparisons), n))
        self.weights = np.array([w for _, _, w in comparisons])
        for k, (winner, loser, _) in enumerate(comparisons):
            self.differences[k, winner] += 1 / (math.sqrt(2) * NOISE)
            self.differences[k, loser] -= 1 / (math.sqrt(2) * NOISE)
        self.mode, self.alpha, self.iterations = self._newton()
        precision = self._likelihood_hessian(self.mode)
        # (K + W^-1)^-1, which the predictive covariance takes off the prior's. W may be
        # singular, so W^-1 is never formed: (K + W^-1)^-1 = W (I + K W)^-1.
        self.reduction: Floats = precision @ np.linalg.inv(np.eye(n) + self.prior @ precision)

    def _log_likelihood(self, f: Floats) -> float:
        z = self.differences @ f
        return float(sum(w * _log_cdf(u) for w, u in zip(self.weights, z.tolist(), strict=True)))

    def _gradient(self, f: Floats) -> Floats:
        z = self.differences @ f
        mills = np.array([_mills(u) for u in z.tolist()])
        result: Floats = self.differences.T @ (self.weights * mills)
        return result

    def _likelihood_hessian(self, f: Floats) -> Floats:
        """W, minus the Hessian of the log-likelihood: -d^2/dz^2 log Phi(z) = r (z + r)."""
        z = self.differences @ f
        mills = np.array([_mills(u) for u in z.tolist()])
        curvature = self.weights * mills * (z + mills)
        result: Floats = self.differences.T @ (self.differences * curvature[:, None])
        return result

    def _newton(self) -> tuple[Floats, Floats, int]:
        """The mode of log p(choices | f) - f' K^-1 f / 2, and alpha = K^-1 f there. Each step is
        f = K (I + W K)^-1 (W f + gradient), halved until the objective rises."""
        n = len(self.points)
        f = np.zeros(n)
        alpha = np.zeros(n)

        def objective(f: Floats, alpha: Floats) -> float:
            return self._log_likelihood(f) - 0.5 * float(f @ alpha)

        iterations = 0
        while True:
            if iterations == MAX_ITERATIONS:
                raise ArithmeticError(f"the GP didn't converge in {MAX_ITERATIONS} Newton steps")
            iterations += 1
            hessian = self._likelihood_hessian(f)
            b = hessian @ f + self._gradient(f)
            next_alpha = np.linalg.solve(np.eye(n) + hessian @ self.prior, b)
            next_f = self.prior @ next_alpha
            before = objective(f, alpha)
            t = 1.0
            while objective(f + t * (next_f - f), alpha + t * (next_alpha - alpha)) < before:
                t /= 2
                if t < 1e-12:
                    raise ArithmeticError("the GP found no step that raises its objective")
            moved = t * (next_f - f)
            f, alpha = f + moved, alpha + t * (next_alpha - alpha)
            if np.max(np.abs(moved), initial=0.0) < STEP_TOLERANCE:
                return f, alpha, iterations

    def predict(self, x: Floats) -> tuple[Floats, Floats]:
        """The posterior mean of f at each row of `x`, and their covariance."""
        cross = kernel(x, self.points, self.scale)
        mean: Floats = cross @ self.alpha
        covariance: Floats = kernel(x, x, self.scale) - cross @ self.reduction @ cross.T
        return mean, (covariance + covariance.T) / 2


def expected_improvement(posterior: Posterior, draws: Floats, best: int) -> Floats:
    """E[max(0, f(x) - f(best))] for each draw x, under the posterior's joint Gaussian of the
    two."""
    cross = kernel(draws, posterior.points, posterior.scale)
    best_cross = kernel(posterior.points[best : best + 1], posterior.points, posterior.scale)[0]
    mean = cross @ posterior.alpha - best_cross @ posterior.alpha
    reduction = posterior.reduction
    variance: Floats = SIGNAL_VARIANCE - np.einsum("ij,jk,ik->i", cross, reduction, cross)
    best_variance = SIGNAL_VARIANCE - best_cross @ reduction @ best_cross
    prior_covariance = kernel(draws, posterior.points[best : best + 1], posterior.scale)[:, 0]
    covariance = prior_covariance - cross @ reduction @ best_cross
    spread = np.sqrt(np.maximum(variance + best_variance - 2 * covariance, 0.0))
    # A draw on the best itself has no spread, and no improvement past its mean gap.
    improvement: Floats = np.maximum(mean, 0.0)
    moving = spread > 0
    gamma = mean[moving] / spread[moving]
    improvement[moving] = mean[moving] * normal_cdf(gamma) + spread[moving] * normal_pdf(gamma)
    return improvement
