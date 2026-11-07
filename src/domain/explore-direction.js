// What an explore's direction may be (decision 0038): one line of at most `DIRECTION_CHARS`
// characters. The server refuses any other, and the pages check before they send.

/** The most characters a direction may hold, as "slower" or "less bell". */
export const DIRECTION_CHARS = 200;

/**
 * What a one-line direction may not hold: a control character (line breaks, tab, NUL, DEL and
 * NEL among them) or a line or paragraph separator, which `JSON.stringify` leaves as they are.
 */
export const NOT_ONE_LINE = /[\p{Cc}\u2028\u2029]/u;
