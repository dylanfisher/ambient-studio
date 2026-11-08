// What a breed asks for by default (decision 0058): children by the model's crossover of two
// sketches, each then nudged once at the small step. The pages send the count too.

/** How many crossover children one breed makes when the request doesn't say. */
export const DEFAULT_BREEDS = 4;

/** Which half of a breed made a candidate, in its `operatorParams.stage`. */
export const BREED_STAGE = Object.freeze({ crossover: "crossover", mutation: "mutation" });

/** What a refusal calls each parent; A is shown first in the prompt and kept longer. */
export const PARENT_NAME = Object.freeze({ a: "parent A", b: "parent B" });

/** The step of the one nudge each crossover child gets. */
export const MUTATION_STEP = /** @type {const} */ ("small");
