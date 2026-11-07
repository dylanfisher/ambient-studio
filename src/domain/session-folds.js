// Leave-one-session-out folds over a training set (decision 0043). A candidate is a genome: a
// test pair that names a genome the fold trains on, through a pair or thumbs, would let the model
// score an excerpt it was fitted on, so that pair is held back from the test.
/** @import { Pair, Thumb, TrainingSet } from "./training-set.js" */

/**
 * @typedef {object} Fold
 * @property {number} sessionId the session held out
 * @property {{ pairs: Pair[], thumbs: Thumb[] }} train every other session's pairs and thumbs
 * @property {Pair[]} test the held-out session's pairs that share no genome with `train`
 * @property {Pair[]} leaked the held-out session's other pairs, scored by no one
 */

/**
 * One fold per session that has pairs, by session id. A session with only thumbs is never held
 * out, since it has no pairs to score, but its thumbs train every fold.
 * @param {TrainingSet} set
 * @returns {Fold[]}
 */
export function sessionFolds({ pairs, thumbs }) {
  const sessions = [...new Set(pairs.map((p) => p.sessionId))].sort((x, y) => x - y);
  return sessions.map((sessionId) => {
    const train = {
      pairs: pairs.filter((p) => p.sessionId !== sessionId),
      thumbs: thumbs.filter((t) => t.sessionId !== sessionId),
    };
    const trained = new Set([
      ...train.pairs.flatMap((p) => [p.winner.genomeId, p.loser.genomeId]),
      ...train.thumbs.map((t) => t.item.genomeId),
    ]);
    const held = pairs.filter((p) => p.sessionId === sessionId);
    const leaks = (/** @type {Pair} */ p) =>
      trained.has(p.winner.genomeId) || trained.has(p.loser.genomeId);
    return {
      sessionId,
      train,
      test: held.filter((p) => !leaks(p)),
      leaked: held.filter(leaks),
    };
  });
}
