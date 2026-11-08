// GET /audio/:renderId (decision 0025): a render-cache MP3 (0048) by renders row id, sent with
// byte ranges by `sendMp3`.
/** @import { RouteContext } from "./routing.js" */
import { fileInside } from "./file-inside.js";
import { getRender } from "./render-store.js";
import { HttpError } from "./routing.js";
import { sendMp3 } from "./send-mp3.js";
import { MP3_EXTENSION } from "./write-mp3.js";

/**
 * @param {RouteContext} context
 * @returns {Promise<undefined>}
 */
export async function serveAudio({ request, response, params, app }) {
  const id = params.renderId ?? "";
  const render = /^[1-9]\d{0,15}$/.test(id) ? getRender(app.store, Number(id)) : undefined;
  if (!render) throw new HttpError(404, `no render ${id}`);
  // A WAV cached before excerpts were MP3s is rendered again before it is played.
  if (!render.file.endsWith(MP3_EXTENSION)) {
    throw new HttpError(404, `render ${id} is not an MP3; render the excerpt again`);
  }
  const file = await fileInside(app.paths.renderCache, [render.file]);
  if (!file) throw new HttpError(404, `render ${id} has no file in the render cache`);
  await sendMp3(request, response, file);
  return undefined;
}
