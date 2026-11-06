// Where on a genome's timeline a rated excerpt starts (decision 0007). Ratings on excerpts stand
// for the sound a long render plays, so the excerpt is a window of the same timeline, drawn
// between the fades rather than always at the start.
/** @import { Genome } from "./genome-schema.js" */
import { draw, GENOME_SLOT } from "./prng.js";

/**
 * Seconds left once an excerpt of `length` has taken its place between the fades; negative when it
 * doesn't fit. The one place the subtraction order is fixed, because floating point makes
 * another order disagree at the boundary: `excerptOffset` throws on a negative room, and the
 * genome linter's excerpt floor passes on a room of 0 or more.
 * @param {Pick<Genome, "duration" | "fadeIn" | "fadeOut">} genome
 * @param {number} length the excerpt's length in seconds
 * @returns {number}
 */
export function excerptRoom({ duration, fadeIn, fadeOut }, length) {
  return duration - fadeOut - fadeIn - length;
}

/**
 * The excerpt's offset in seconds: the whole excerpt lies after the fade-in and before the
 * fade-out, so the offset is 0 only when there is no fade-in. It reads the duration and the
 * fades only, so voices and their order never move it.
 * @param {Pick<Genome, "duration" | "fadeIn" | "fadeOut">} genome
 * @param {number} seed the render's seed
 * @param {number} length the excerpt's length in seconds
 * @returns {number}
 */
export function excerptOffset(genome, seed, length) {
  const { duration, fadeIn, fadeOut } = genome;
  if (!(length > 0)) throw new RangeError(`excerpt length must be above 0 s, got ${length}`);
  const room = excerptRoom(genome, length);
  if (room < 0) {
    throw new RangeError(
      `a ${length} s excerpt doesn't fit the ${duration - fadeIn - fadeOut} s between the fades`,
    );
  }
  return fadeIn + room * draw(seed, "", 0, GENOME_SLOT.excerpt);
}
