// Why a generated candidate was rejected, one typed value each, so an evaluation counts them by
// type (decision 0024). A valid candidate's reason is null.
export const REJECT_REASON = Object.freeze({
  /** The answer hit `max_tokens` and was cut off; no repair, since there are no errors to quote. */
  truncated: "truncated",
  noJson: "noJson",
  invalidJson: "invalidJson",
  /** More than one JSON object, so no one answer to take. */
  severalObjects: "severalObjects",
  /** The answer's shape or its genome fails the schema (decision 0005). */
  schemaErrors: "schemaErrors",
  /** The genome is valid and the linter rejects it (decision 0020). */
  lintErrors: "lintErrors",
  /** The request failed in the queue (timeout, busy past the wait, cancel, an error status): a
   * failure of the transport, not of the model. */
  requestFailed: "requestFailed",
  /** A nudge's draw landed on its base's genome or a sibling's, as when an int rounds back
   * (decision 0037). */
  repeated: "repeated",
});

/** @typedef {(typeof REJECT_REASON)[keyof typeof REJECT_REASON]} RejectReason */
