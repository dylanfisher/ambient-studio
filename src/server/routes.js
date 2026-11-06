// The app's route table (decision 0025). Each step adds its routes here; `matchRoute` takes
// the first whose path and method match, so a literal path goes before a `:name` one.
/** @import { Route } from "./routing.js" */
import { serveAudio } from "./serve-audio.js";

/** @type {Route[]} */
export const ROUTES = [{ method: "GET", path: "/audio/:renderId", handle: serveAudio }];
