import { exec } from "child_process";
import { mkdir, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";
import { COMP_NAME } from "../../types/constants";

const execAsync = promisify(exec);

export type RenderJobStatus = "queued" | "rendering" | "done" | "error";

/**
 * Phase 16 — everything about a render job that's safe (and useful) to
 * send to the browser: no clip data, no file paths on this machine, just
 * enough to show a queue. The actual render inputs live separately in
 * `pendingInputs` below, so polling /api/render-jobs never has to
 * serialize a whole project's worth of clips back down to the client.
 */
export type RenderJob = {
  id: string;
  label: string;
  status: RenderJobStatus;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  outputUrl: string | null;
  error: string | null;
};

// Module-level singleton — this only needs to survive for the lifetime of
// the single, locally-run Next.js server process (there's no separate
// database or worker service here, and none is warranted for a personal,
// one-machine tool like this one). `next dev`/`next start` keep this
// module's state alive across requests as long as the process itself
// keeps running, which is exactly what lets a render started from one
// request still be tracked and polled by a completely different request
// later — including from a different tab, or after switching projects in
// the same tab.
const jobs = new Map<string, RenderJob>();
const queueOrder: string[] = [];
// Kept separate from `jobs` (see RenderJob's own doc comment above) —
// this is the part of a job that should never be sent to the client.
const pendingInputs = new Map<
  string,
  { inputProps: unknown; host: string }
>();
let isProcessing = false;

/** Most recently created first — what a queue panel wants to show. */
export const getAllJobs = (): RenderJob[] =>
  queueOrder
    .map((id) => jobs.get(id))
    .filter((job): job is RenderJob => job !== undefined)
    .reverse();

export const getJob = (id: string): RenderJob | undefined => jobs.get(id);

export const enqueueRenderJob = (input: {
  inputProps: unknown;
  host: string;
  label: string;
}): RenderJob => {
  const id = crypto.randomUUID();
  const job: RenderJob = {
    id,
    label: input.label,
    status: "queued",
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    outputUrl: null,
    error: null,
  };
  jobs.set(id, job);
  queueOrder.push(id);
  pendingInputs.set(id, { inputProps: input.inputProps, host: input.host });

  // Fire-and-forget — deliberately not awaited. This is what lets the API
  // route respond the instant the job is recorded, rather than blocking
  // on the whole render the way the old synchronous /api/render-local
  // endpoint did. If a render is already in progress, processQueue()
  // below just returns immediately and does nothing; it'll be called
  // again the moment that render finishes.
  void processQueue();

  return job;
};

/**
 * Removes a job that hasn't started rendering yet. Jobs already
 * "rendering" can't be cancelled here — we shell out to the Remotion CLI
 * as a child process (see runRender below) and don't hold a handle to
 * kill it mid-render; limiting cancellation to queued-only jobs keeps
 * this simple and avoids ever leaving an orphaned render process behind.
 */
export const cancelQueuedJob = (id: string): boolean => {
  const job = jobs.get(id);
  if (!job || job.status !== "queued") {
    return false;
  }
  jobs.delete(id);
  pendingInputs.delete(id);
  const index = queueOrder.indexOf(id);
  if (index !== -1) {
    queueOrder.splice(index, 1);
  }
  return true;
};

/**
 * Phase 16 — the entire concurrency limit lives in this one `isProcessing`
 * flag: at most one render ever runs at a time. Every other queued job
 * just waits until the current one's `finally` block calls this again.
 */
const processQueue = async (): Promise<void> => {
  if (isProcessing) {
    return;
  }
  const nextId = queueOrder.find((id) => jobs.get(id)?.status === "queued");
  if (!nextId) {
    return;
  }

  const job = jobs.get(nextId);
  const input = pendingInputs.get(nextId);
  if (!job || !input) {
    return;
  }

  isProcessing = true;
  job.status = "rendering";
  job.startedAt = Date.now();

  try {
    job.outputUrl = await runRender(input.inputProps, input.host);
    job.status = "done";
  } catch (err) {
    job.status = "error";
    job.error =
      err instanceof Error
        ? err.message
        : "Render failed. Check the terminal running `npm run dev` for full details.";
    console.error(`Render job ${job.id} failed:`, err);
  } finally {
    job.finishedAt = Date.now();
    pendingInputs.delete(nextId);
    isProcessing = false;
    void processQueue();
  }
};

/**
 * Recursively rewrites every string that looks like an uploaded file path
 * (starts with "/uploads/") into an absolute URL — anywhere in the given
 * value's object/array tree, regardless of field name or nesting depth.
 *
 * This replaces a hand-maintained list of fields (clips[].src, music.src,
 * voiceOvers[].src, hook.src, transition.soundSrc, ...) that had to be
 * updated every single time a new feature introduced another uploaded-file
 * field — and reliably forgot to, three times in a row (music, then hook,
 * then transition), each producing the exact same "404 during background
 * render" symptom. A tree-walk that keys off the *value's shape* (does
 * this string start with "/uploads/"?) rather than the *field's name*
 * can't forget a field, because it never enumerates field names at all —
 * any future feature that stores an uploaded file's path this same way is
 * covered automatically, with zero changes needed here.
 *
 * "/uploads/" is a namespace this app only ever uses for real uploaded
 * media paths (see the upload route), so this is safe: nothing else in
 * the schema — header text, hex colors, labels, enum values — could ever
 * coincidentally start with exactly that prefix.
 */
const absolutizeUploadedUrls = <T>(value: T, host: string): T => {
  if (typeof value === "string") {
    return (value.startsWith("/uploads/")
      ? `http://${host}${value}`
      : value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => absolutizeUploadedUrls(item, host)) as T;
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(
      value as Record<string, unknown>,
    )) {
      result[key] = absolutizeUploadedUrls(val, host);
    }
    return result as T;
  }
  return value;
};

/**
 * The actual render, moved here unchanged from the old synchronous
 * /api/render-local route — same temp props file, same random port per
 * render, same `remotion render` CLI invocation. Only the calling
 * convention changed: this used to run inline inside the POST handler
 * (blocking the whole HTTP request until it finished); now it runs inside
 * processQueue's background loop instead.
 */
const runRender = async (
  inputProps: unknown,
  host: string,
): Promise<string> => {
  const propsToWrite = absolutizeUploadedUrls(inputProps, host);

  const propsPath = path.join(
    os.tmpdir(),
    `rankflow-props-${Date.now()}-${Math.floor(Math.random() * 1e6)}.json`,
  );
  await writeFile(propsPath, JSON.stringify(propsToWrite));

  const outputDir = path.join(process.cwd(), "public", "renders");
  await mkdir(outputDir, { recursive: true });
  const outputFilename = `output-${Date.now()}.mp4`;
  const outputPath = path.join(outputDir, outputFilename);

  // A random port per render (rather than a fixed one) so that two
  // renders happening close together — including two queued back-to-back
  // by this very queue — don't collide on the same port.
  const renderPort = 7000 + Math.floor(Math.random() * 1000);

  const command = `npx remotion render src/remotion/index.ts ${COMP_NAME} "${outputPath}" --props="${propsPath}" --port=${renderPort} --bundle-cache=false --concurrency=1`;

  const { stdout, stderr } = await execAsync(command, {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024 * 20, // Remotion's render logs can be verbose
  });

  console.log("Remotion render stdout:\n", stdout);
  if (stderr) {
    console.log("Remotion render stderr:\n", stderr);
  }

  return `/renders/${outputFilename}`;
};