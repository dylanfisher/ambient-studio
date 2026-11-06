// Loads and validates tuning files (decision 0004). Two kinds: a relative tuning repeats its
// degrees every period and needs a key; an absolute tuning is a fixed list of frequencies in Hz.

/**
 * @typedef {object} Reference the frequency of one degree in one period, which fixes every
 *   other frequency of a relative tuning
 * @property {number} degree
 * @property {number} octave
 * @property {number} hz
 */

/**
 * @typedef {object} RelativeTuning
 * @property {string} id
 * @property {string} name
 * @property {"relative"} kind
 * @property {number} period frequency ratio after which the degrees repeat
 * @property {readonly number[]} degrees frequency ratios above degree 0, so `degrees[0]` is 1
 * @property {Reference} reference
 * @property {Readonly<Record<string, readonly number[]>>} scales degree indices, from 0, rising
 */

/**
 * @typedef {object} AbsoluteTuning
 * @property {string} id
 * @property {string} name
 * @property {"absolute"} kind
 * @property {readonly number[]} frequencies in Hz, rising
 * @property {Readonly<Record<string, readonly number[]>>} scales indices into `frequencies`
 */

/** @typedef {RelativeTuning | AbsoluteTuning} Tuning */

/** The scale every tuning has: each of its degrees. */
const ALL = "all";

const KEYS = {
  relative: ["name", "period", "steps", "degrees", "scala", "reference", "scales"],
  absolute: ["name", "frequencies", "scala", "baseHz", "scales"],
};

// A Scala pitch line: cents contain a period, anything else is a ratio. Text after the value is
// ignored, as the format says.
const SCALA_CENTS = /^(-?(?:\d+\.\d*|\.\d+))(?:\s|$)/;
const SCALA_RATIO = /^(\d+)(?:\/(\d+))?(?:\s|$)/;
const RATIO = /^(\d+)(?:\/(\d+))?$/;

/** @param {number} cents */
export const centsToRatio = (cents) => 2 ** (cents / 1200);

/** @param {string} numerator @param {string | undefined} denominator */
function ratio(numerator, denominator) {
  const value = Number(numerator) / Number(denominator ?? "1");
  return value > 0 && Number.isFinite(value) ? value : undefined;
}

/**
 * A pitch in a JSON tuning file: a number is cents, a string is a ratio ("3/2", or "2" for 2/1).
 * @param {string} id @param {string} what @param {unknown} value
 */
function pitchValue(id, what, value) {
  if (typeof value === "number" && Number.isFinite(value)) return centsToRatio(value);
  const match = typeof value === "string" ? RATIO.exec(value) : null;
  const parsed = match && ratio(match[1] ?? "", match[2]);
  if (parsed === undefined || parsed === null) {
    throw new Error(`${id}: ${what} must be cents (a number) or a ratio like "3/2", got ${value}`);
  }
  return parsed;
}

/**
 * The pitch lines of a Scala .scl file as frequency ratios above degree 0, which the format
 * leaves out.
 * @param {string} id @param {string} text
 */
function parseScala(id, text) {
  const lines = text
    .split(/\r?\n/)
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => !line.startsWith("!"));
  const countText = lines[1]?.line.trim() ?? "";
  if (!/^\d+$/.test(countText)) {
    throw new Error(`${id}: the Scala pitch count line must be a whole number, got "${countText}"`);
  }
  const pitchLines = lines.slice(2).filter(({ line }) => line.trim() !== "");
  if (pitchLines.length !== Number(countText)) {
    throw new Error(`${id}: the Scala file says ${countText} pitches, found ${pitchLines.length}`);
  }
  return pitchLines.map(({ line, number }) => {
    const value = line.trim();
    const cents = SCALA_CENTS.exec(value);
    if (cents) return centsToRatio(Number(cents[1]));
    const match = SCALA_RATIO.exec(value);
    const parsed = match && ratio(match[1] ?? "", match[2]);
    if (!parsed) throw new Error(`${id}: Scala line ${number} is not a pitch: "${line}"`);
    return parsed;
  });
}

/** @param {string} id @param {string} what @param {readonly number[]} values */
function checkRising(id, what, values) {
  values.forEach((value, i) => {
    if (i > 0 && !(value > (values[i - 1] ?? 0))) {
      throw new Error(`${id}: ${what} must rise, but ${value} follows ${values[i - 1]}`);
    }
  });
}

/** @param {string} id @param {string} what @param {unknown} value */
function positive(id, what, value) {
  if (typeof value !== "number" || !(value > 0) || !Number.isFinite(value)) {
    throw new Error(`${id}: ${what} must be a positive number, got ${value}`);
  }
  return value;
}

/**
 * Each named scale as a list, checked by `check`, plus `all`.
 * @param {string} id
 * @param {unknown} scales
 * @param {number} size how many degrees the tuning has
 * @param {(name: string, values: unknown[]) => number[]} toDegrees
 */
function loadScales(id, scales, size, toDegrees) {
  if (typeof scales !== "object" || scales === null || Array.isArray(scales)) {
    throw new Error(`${id}: "scales" must be an object of named scales`);
  }
  /** @type {Record<string, readonly number[]>} */
  const loaded = { [ALL]: Object.freeze(Array.from({ length: size }, (_, i) => i)) };
  for (const [name, values] of Object.entries(scales)) {
    if (name === ALL) throw new Error(`${id}: "${ALL}" is every degree and can't be redefined`);
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error(`${id}: scale "${name}" must be a non-empty list`);
    }
    loaded[name] = Object.freeze(toDegrees(name, values));
  }
  return Object.freeze(loaded);
}

/** @param {string} id @param {Record<string, unknown>} file */
function loadRelative(id, file) {
  const sources = ["steps", "degrees", "scala"].filter((key) => file[key] !== undefined);
  if (sources.length !== 1) {
    throw new Error(`${id}: give exactly one of "steps", "degrees" or "scala"`);
  }
  let period;
  /** @type {number[]} */
  let degrees;
  if (file.scala !== undefined) {
    if (file.period !== undefined) {
      throw new Error(`${id}: the period of a Scala tuning is its file's last pitch line`);
    }
    if (typeof file.scala !== "string") throw new Error(`${id}: "scala" must be the file's text`);
    const pitches = parseScala(id, file.scala);
    period = pitches.pop();
    degrees = [1, ...pitches];
  } else {
    if (file.period === undefined) throw new Error(`${id}: "period" is missing`);
    period = pitchValue(id, "the period", file.period);
    if (file.steps !== undefined) {
      const steps = file.steps;
      if (typeof steps !== "number" || !Number.isInteger(steps) || steps < 1) {
        throw new Error(`${id}: "steps" must be a whole number of at least 1, got ${steps}`);
      }
      const p = period;
      degrees = Array.from({ length: steps }, (_, i) => p ** (i / steps));
    } else {
      if (!Array.isArray(file.degrees)) throw new Error(`${id}: "degrees" must be a list`);
      degrees = [1, ...file.degrees.map((value, i) => pitchValue(id, `degree ${i + 1}`, value))];
    }
  }
  if (period === undefined || !(period > 1)) {
    throw new Error(`${id}: the period must be a ratio above 1, got ${period}`);
  }
  checkRising(id, "degrees", degrees);
  const highest = degrees.at(-1) ?? 1;
  if (!(highest < period)) {
    throw new Error(`${id}: every degree must lie below the period, but ${highest} doesn't`);
  }

  const reference = /** @type {Partial<Reference> | undefined} */ (file.reference);
  if (
    typeof reference !== "object" ||
    reference === null ||
    Object.keys(reference).sort().join() !== "degree,hz,octave" ||
    !Number.isInteger(reference.degree) ||
    (reference.degree ?? -1) < 0 ||
    (reference.degree ?? Infinity) >= degrees.length ||
    !Number.isInteger(reference.octave) ||
    !((reference.hz ?? 0) > 0 && Number.isFinite(reference.hz))
  ) {
    throw new Error(
      `${id}: "reference" must be { degree, octave, hz } with a degree of this tuning, ` +
        `a whole octave and a positive hz, got ${JSON.stringify(reference)}`,
    );
  }

  const scales = loadScales(id, file.scales, degrees.length, (name, values) => {
    const ok =
      values[0] === 0 &&
      values.every(
        (value, i) =>
          Number.isInteger(value) &&
          /** @type {number} */ (value) < degrees.length &&
          (i === 0 || /** @type {number} */ (value) > /** @type {number} */ (values[i - 1])),
      );
    if (!ok) {
      throw new Error(
        `${id}: scale "${name}" must list whole degrees from 0, rising, below ${degrees.length}`,
      );
    }
    return /** @type {number[]} */ (values);
  });

  return /** @type {RelativeTuning} */ (
    Object.freeze({
      id,
      name: file.name,
      kind: "relative",
      period,
      degrees: Object.freeze(degrees),
      reference: Object.freeze({ ...reference }),
      scales,
    })
  );
}

/** @param {string} id @param {Record<string, unknown>} file */
function loadAbsolute(id, file) {
  const sources = ["frequencies", "scala"].filter((key) => file[key] !== undefined);
  if (sources.length !== 1) throw new Error(`${id}: give exactly one of "frequencies" or "scala"`);
  /** @type {number[]} */
  let frequencies;
  if (file.scala !== undefined) {
    if (typeof file.scala !== "string") throw new Error(`${id}: "scala" must be the file's text`);
    const baseHz = positive(id, `"baseHz" (the frequency of degree 0)`, file.baseHz);
    frequencies = [baseHz, ...parseScala(id, file.scala).map((r) => baseHz * r)];
  } else {
    if (file.baseHz !== undefined) throw new Error(`${id}: "baseHz" only goes with "scala"`);
    if (!Array.isArray(file.frequencies)) throw new Error(`${id}: "frequencies" must be a list`);
    frequencies = file.frequencies.map((hz, i) => positive(id, `frequency ${i}`, hz));
  }
  checkRising(id, "frequencies", frequencies);

  const scales = loadScales(id, file.scales, frequencies.length, (name, values) => {
    const degrees = values.map((hz) => {
      const degree = typeof hz === "number" ? frequencies.indexOf(hz) : -1;
      if (degree === -1) {
        throw new Error(`${id}: scale "${name}": ${hz} Hz is not a frequency of the tuning`);
      }
      return degree;
    });
    checkRising(id, `scale "${name}"`, degrees);
    return degrees;
  });

  return /** @type {AbsoluteTuning} */ (
    Object.freeze({
      id,
      name: file.name,
      kind: "absolute",
      frequencies: Object.freeze(frequencies),
      scales,
    })
  );
}

/**
 * @param {Tuning} tuning
 * @returns {tuning is AbsoluteTuning}
 */
export const isAbsolute = (tuning) => tuning.kind === "absolute";

/**
 * Validates a tuning file's contents and returns the tuning, or throws naming what's wrong. A
 * file with `frequencies` or `baseHz` is absolute; any other is relative.
 * @param {string} id the file's name without its extension
 * @param {unknown} file
 * @returns {Tuning}
 */
export function loadTuning(id, file) {
  if (typeof file !== "object" || file === null || Array.isArray(file)) {
    throw new Error(`${id}: a tuning file must hold an object`);
  }
  const fields = /** @type {Record<string, unknown>} */ (file);
  const kind =
    fields.frequencies !== undefined || fields.baseHz !== undefined ? "absolute" : "relative";
  for (const key of Object.keys(fields)) {
    if (fields[key] !== undefined && !KEYS[kind].includes(key)) {
      throw new Error(`${id}: unknown key "${key}" for a ${kind} tuning`);
    }
  }
  if (typeof fields.name !== "string" || fields.name === "") {
    throw new Error(`${id}: "name" must be a non-empty string`);
  }
  return kind === "relative" ? loadRelative(id, fields) : loadAbsolute(id, fields);
}
