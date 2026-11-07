/**
 * How many candidates an evaluation asks for per vibe (decision 0030): 16 by default, so three
 * seed vibes make the 48 that phase 2's acceptance measures, and at most 64, about an hour of
 * omlx on the shared machine. In revision mode the page suggests 32 (0040): with about half of
 * first tries missing, as 0034's ranges aim for, 32 a vibe over three vibes gives about 48
 * revised first tries, well over the paired test's minimum of 20.
 */
export const EVALUATION_COUNT = Object.freeze({ default: 16, revise: 32, max: 64 });
