// The app's route table (decision 0025). Each step adds its routes here; `matchRoute` takes
// the first whose path and method match, so a literal path goes before a `:name` one.
/** @import { Route } from "./routing.js" */
import { ARCHIVE_ROUTES } from "./archive-routes.js";
import { ATTACHMENT_ROUTES } from "./attachment-routes.js";
import { EMBEDDING_ROUTES } from "./embedding-routes.js";
import { EVALUATION_ROUTES } from "./evaluation-routes.js";
import { LINEAGE_ROUTES } from "./lineage-routes.js";
import { LOCK_ROUTES } from "./lock-routes.js";
import { OPTIMIZER_TEST_ROUTES } from "./optimizer-test-routes.js";
import { PREFERENCE_ROUTES } from "./preference-routes.js";
import { PROPOSAL_ROUTES } from "./proposal-routes.js";
import { RATING_ROUTES } from "./rating-routes.js";
import { REFERENCE_ROUTES } from "./reference-routes.js";
import { REGION_ANALYSIS_ROUTES } from "./region-analysis-routes.js";
import { serveAudio } from "./serve-audio.js";
import { SESSION_ROUTES } from "./session-routes.js";
import { TRACK_RENDER_ROUTES } from "./track-render-routes.js";
import { TRACK_ROUTES } from "./track-routes.js";
import { VIBE_ROUTES } from "./vibe-routes.js";

/** @type {Route[]} */
export const ROUTES = [
  { method: "GET", path: "/audio/:renderId", handle: serveAudio },
  ...VIBE_ROUTES,
  ...LOCK_ROUTES,
  ...LINEAGE_ROUTES,
  ...SESSION_ROUTES,
  ...RATING_ROUTES,
  ...EVALUATION_ROUTES,
  ...EMBEDDING_ROUTES,
  ...PREFERENCE_ROUTES,
  ...OPTIMIZER_TEST_ROUTES,
  ...REFERENCE_ROUTES,
  ...REGION_ANALYSIS_ROUTES,
  ...ATTACHMENT_ROUTES,
  ...ARCHIVE_ROUTES,
  ...TRACK_ROUTES,
  ...TRACK_RENDER_ROUTES,
  ...PROPOSAL_ROUTES,
];
