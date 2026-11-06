// The index page's one check: that this browser loads the engine's modules from the server
// (decision 0025). The pages of step 2j take over from here.
import { ENGINE_VERSION } from "../engine/engine-version.js";

const line = document.getElementById("engine-version");
if (!line) throw new Error("index.html has no #engine-version element");
line.textContent = `Engine version ${ENGINE_VERSION} loaded.`;
