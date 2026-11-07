// The operators a candidate stores, naming how it was made (decisions 0036–0038); a first try
// from a plain request stores null. The server writes them and the pages read them.
export const OPERATOR = Object.freeze({
  /** The model's one revision of a first try whose excerpt missed (0036). */
  revise: "revise",
  /** 3h's control arm: the same follow-up without the measurements, never shown. */
  reviseControl: "revise-control",
  /** Seeded steps in the vector view, with no model request (0037). */
  nudge: "nudge",
  /** A fresh first prompt holding a base (0038). */
  explore: "explore",
});
