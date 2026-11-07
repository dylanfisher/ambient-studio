/** @import { ModelTerms } from "../domain/model-key-text.js" */
/** @import { TrainingSet } from "../domain/training-set.js" */
import { modelKeyText } from "../domain/model-key-text.js";
import { sha256Hex } from "./sha256-hex.js";

/**
 * SHA-256 of `modelKeyText`, in hex: the name every model, report and ranking of a fit carries
 * (decision 0043).
 * @param {TrainingSet} set
 * @param {ModelTerms} terms
 * @returns {string}
 */
export function modelKey(set, terms) {
  return sha256Hex(modelKeyText(set, terms));
}
