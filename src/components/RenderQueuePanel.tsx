"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { InputContainer } from "./Container";
import { ErrorComp } from "./Error";

type RenderJobStatus = "queued" | "rendering" | "done" | "error";

type RenderJob = {
  id: string;
  label: string;
  status: RenderJobStatus;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  outputUrl: string | null;
  error: string | null;
};

// Polled while at least one job is still queued or rendering — frequently
// enough to feel live, without hammering the server. Backs off to a much
// slower poll once the queue is idle, so a job added from a different tab
// (or a different project loaded later in this same tab) still eventually
// shows up here without needing this panel actively watched.
const ACTIVE_POLL_MS = 1500;
const IDLE_POLL_MS = 8000;

const formatElapsed = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
};

const StatusPill: React.FC<{ status: RenderJobStatus }> = ({ status }) => {
  if (status === "queued") {
    return (
      <span className="rounded-full bg-panel-raised px-2 py-0.5 text-[11px] text-subtitle">
        queued
      </span>
    );
  }
  if (status === "rendering") {
    return (
      <span className="flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent">
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full bg-accent animate-spinner"
        />
        rendering
      </span>
    );
  }
  if (status === "done") {
    return (
      <span className="rounded-full bg-geist-success/10 px-2 py-0.5 text-[11px] text-geist-success">
        done
      </span>
    );
  }
  return (
    <span className="rounded-full bg-geist-error/10 px-2 py-0.5 text-[11px] text-geist-error">
      failed
    </span>
  );
};

/**
 * Phase 16 — the queue panel every render job shows up in, regardless of
 * which project is currently loaded in the editor above it. Jobs live
 * server-side (see src/server/renderQueue.ts), so this keeps showing
 * accurate status even after switching to a different project or
 * reloading the page — the queue itself doesn't depend on this component
 * staying mounted at all.
 */
export const RenderQueuePanel: React.FC = () => {
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Forces a re-render every second while anything is queued/rendering, so
  // the "Xs so far" readouts actually tick instead of only updating
  // whenever the next poll happens to land.
  const [, forceTick] = useState(0);
  // A live view of the latest jobs for poll() to read without needing to
  // be re-created every time jobs changes (it's only ever created once,
  // via the empty dependency array below).
  const jobsRef = useRef<RenderJob[]>([]);
  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  const poll = useCallback(async () => {
    try {
      const response = await fetch("/api/render-jobs");
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Could not load the render queue.");
      }
      setJobs(data.jobs ?? []);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Could not load the render queue.",
      );
    } finally {
      const hasActiveJob = jobsRef.current.some(
        (job) => job.status === "queued" || job.status === "rendering",
      );
      timeoutRef.current = setTimeout(
        poll,
        hasActiveJob ? ACTIVE_POLL_MS : IDLE_POLL_MS,
      );
    }
  }, []);

  useEffect(() => {
    poll();
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [poll]);

  useEffect(() => {
    const hasActiveJob = jobs.some(
      (job) => job.status === "queued" || job.status === "rendering",
    );
    if (!hasActiveJob) {
      return;
    }
    const tickId = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(tickId);
  }, [jobs]);

  const handleCancel = async (id: string) => {
    try {
      await fetch(`/api/render-jobs/${id}`, { method: "DELETE" });
    } finally {
      poll();
    }
  };

  return (
    <InputContainer>
      <label className="text-sm font-medium">Render queue</label>
      <p className="text-[11px] text-subtitle">
        Renders run one at a time in the background — keep editing (even
        switch to a different project) while these finish.
      </p>

      {loadError ? <ErrorComp message={loadError}></ErrorComp> : null}

      {jobs.length === 0 && !loadError ? (
        <p className="text-sm text-subtitle">
          Nothing queued yet — render a video from the Export panel above.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {jobs.map((job) => {
            const elapsedMs =
              job.status === "queued"
                ? Date.now() - job.createdAt
                : job.status === "rendering" && job.startedAt
                  ? Date.now() - job.startedAt
                  : job.startedAt && job.finishedAt
                    ? job.finishedAt - job.startedAt
                    : 0;

            return (
              <li
                key={job.id}
                className="flex flex-col gap-1.5 rounded-geist border border-unfocused-border-color bg-background p-geist-half text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                    {job.label}
                  </span>
                  <StatusPill status={job.status} />
                  {job.status === "queued" ? (
                    <button
                      type="button"
                      onClick={() => handleCancel(job.id)}
                      className="text-xs text-subtitle hover:text-geist-error hover:underline"
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
                <p className="font-mono-tabular text-xs text-subtitle">
                  {job.status === "queued" && `queued ${formatElapsed(elapsedMs)} ago`}
                  {job.status === "rendering" &&
                    `rendering — ${formatElapsed(elapsedMs)} so far`}
                  {job.status === "done" && `done in ${formatElapsed(elapsedMs)}`}
                  {job.status === "error" && `failed after ${formatElapsed(elapsedMs)}`}
                </p>
                {job.status === "done" && job.outputUrl ? (
                  <a
                    className="text-sm text-accent underline"
                    href={job.outputUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open your rendered video
                  </a>
                ) : null}
                {job.status === "error" && job.error ? (
                  <ErrorComp message={job.error}></ErrorComp>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </InputContainer>
  );
};