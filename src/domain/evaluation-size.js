/**
 * How many candidates an evaluation asks for per vibe (decision 0030): 16 by default, so three
 * seed vibes make the 48 that phase 2's acceptance measures, and at most 64, about an hour of
 * omlx on the shared machine.
 */
export const EVALUATION_COUNT = Object.freeze({ default: 16, max: 64 });
