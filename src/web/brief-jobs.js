// What a page over a whole brief (the lineage page, decision 0039, and the map, 0057) shares:
// its ids from the address, the open session its new candidates go to, and starting and
// following the jobs its buttons add, each in a box with Cancel, reading the page again as a
// job moves.
/** @import { JobStatus } from "./job-progress.js" */
/** @import { statusLine } from "./status-line.js" */
/** @import { StartJob } from "./steer-controls.js" */
import { getJson, jobPath, postJson, sessionPath, startJob } from "./api.js";
import { followJob } from "./follow-job.js";
import { endedText, JOB_STATE } from "./job-progress.js";
import { jobBox } from "./job-view.js";

/**
 * A row id from the address, shown on the status line and thrown when it isn't one.
 * @param {ReturnType<typeof statusLine>} status
 * @param {URLSearchParams} query
 * @param {string} name
 * @param {string} what what the id names, for the message
 */
function queryId(status, query, name, what) {
  const text = query.get(name);
  if (text !== null && /^[1-9]\d{0,15}$/.test(text)) return Number(text);
  const error = new Error(
    `This page's address needs ?${name}= and ${what} id, got ${JSON.stringify(text)}.`,
  );
  status.fail(error);
  throw error;
}

/**
 * The brief the address names in `id`, and the session in `session` the page was opened from,
 * which new candidates go to while it is open; null when it names none.
 * @param {ReturnType<typeof statusLine>} status
 * @param {string} search `location.search`
 */
export function briefQuery(status, search) {
  const query = new URLSearchParams(search);
  return {
    vibeId: queryId(status, query, "id", "a brief"),
    fromSession: query.has("session") ? queryId(status, query, "session", "a session") : null,
  };
}

/** Why a job button is off on a brief's page with no open session. */
export const NO_OPEN_SESSION =
  "Turned off: every session of this brief is stopped. Start a session from the brief page first.";

/**
 * The open session new candidates go to: the one the page was opened from while it is open,
 * else the brief's newest open one, or null when every session is stopped.
 * @param {readonly { id: number, stoppedAt: number | null }[]} sessions the brief's
 * @param {number | null} fromSession
 * @returns {number | null}
 */
export function targetSession(sessions, fromSession) {
  const open = sessions.filter((session) => session.stoppedAt === null);
  const found =
    open.find((session) => session.id === fromSession)?.id ??
    open.reduce((newest, session) => Math.max(newest, session.id), -1);
  return found === -1 ? null : found;
}

/**
 * Starting and following the page's jobs.
 * @param {object} options
 * @param {ReturnType<typeof statusLine>} options.status
 * @param {HTMLElement} options.boxes where each job's box goes
 * @param {() => Promise<void>} options.reload reads the page again, when a job's count or step
 *   moves and when it ends
 * @param {string} options.done what the status line says once a job is done
 * @param {() => string} options.started what it says once one has started
 * @param {() => void} options.settle turns the page's buttons back to what they should be,
 *   once a job ends or a start fails
 * @returns {{ follow: (job: JobStatus) => Promise<void>, start: StartJob,
 *   resume: (sessionId: number | null) => Promise<void> }} `resume` follows the session's
 *   unfinished jobs, as when the page opens
 */
export function briefJobs({ status, boxes, reload, done, started, settle }) {
  /** @type {Map<number, ReturnType<typeof jobBox>>} */
  const shown = new Map();
  /** @type {Set<number>} */
  const following = new Set();

  /** @param {JobStatus} job */
  async function follow(job) {
    if (following.has(job.id)) return;
    following.add(job.id);
    const box = jobBox((current) =>
      status.run(async () => box.show(await postJson(`${jobPath(current.id)}/cancel`, {}))),
    );
    shown.get(job.id)?.root.remove();
    shown.set(job.id, box);
    boxes.append(box.root);
    let seen = "";
    try {
      const finished = await followJob(job, async (current) => {
        box.show(current);
        const now = `${current.progress?.done}/${current.progress?.step}`;
        if (now !== seen) {
          seen = now;
          await reload();
        }
      });
      await reload();
      status.say(finished.state === JOB_STATE.done ? done : endedText(finished));
    } finally {
      following.delete(job.id);
    }
  }

  /** @type {StartJob} */
  async function start(control, path, body) {
    control.wait();
    try {
      const { job, refused } = await startJob(path, body);
      control.hold(job);
      status.say(refused ? `${refused} Showing that job's progress.` : started());
      status.run(async () => {
        try {
          await follow(job);
        } finally {
          control.release();
          settle();
        }
      });
    } catch (error) {
      control.release();
      settle();
      throw error;
    }
  }

  /** @param {number | null} sessionId */
  async function resume(sessionId) {
    if (sessionId === null) return;
    const { jobs } = await getJson(sessionPath(sessionId));
    for (const job of jobs.filter((/** @type {JobStatus} */ j) => j.finishedAt === null)) {
      status.run(() => follow(job));
    }
  }

  return { follow, start, resume };
}
