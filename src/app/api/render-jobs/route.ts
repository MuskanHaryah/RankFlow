import { NextRequest, NextResponse } from "next/server";
import { enqueueRenderJob, getAllJobs } from "../../../server/renderQueue";

export const runtime = "nodejs";

/** Phase 16 — polled by the Render Queue panel to show job statuses. */
export async function GET() {
  return NextResponse.json({ jobs: getAllJobs() });
}

/**
 * Phase 16 — enqueues a render and returns immediately (before the render
 * itself has even started, let alone finished) — the render runs in the
 * background via src/server/renderQueue.ts's own queue processor, one job
 * at a time. Same validation as the old synchronous /api/render-local
 * route: a job that's doomed to fail on a blob: URL is exactly as
 * useless queued as it was rendered synchronously.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const inputProps = body.inputProps;

  if (
    !inputProps ||
    !Array.isArray(inputProps.clips) ||
    inputProps.clips.length === 0
  ) {
    return NextResponse.json(
      { error: "No clips provided to render." },
      { status: 400 },
    );
  }

  // A local render process runs in Node, completely outside the browser —
  // it can never read a blob: URL, since those only exist in browser
  // memory. Every clip, plus any music/voice-over/hook track, must
  // already be a real uploaded server path before this job can ever
  // succeed.
  const hasUnuploadedClip = inputProps.clips.some(
    (clip: { src?: string }) =>
      typeof clip.src !== "string" || clip.src.startsWith("blob:"),
  );
  const hasUnuploadedMusic =
    inputProps.music &&
    inputProps.music.src !== null &&
    (typeof inputProps.music.src !== "string" ||
      inputProps.music.src.startsWith("blob:"));
  const hasUnuploadedVoiceOver =
    Array.isArray(inputProps.voiceOvers) &&
    inputProps.voiceOvers.some(
      (voiceOver: { src?: string }) =>
        typeof voiceOver.src !== "string" ||
        voiceOver.src.startsWith("blob:"),
    );
  const hasUnuploadedHook =
    inputProps.hook &&
    inputProps.hook.src !== null &&
    (typeof inputProps.hook.src !== "string" ||
      inputProps.hook.src.startsWith("blob:"));

  if (
    hasUnuploadedClip ||
    hasUnuploadedMusic ||
    hasUnuploadedVoiceOver ||
    hasUnuploadedHook
  ) {
    return NextResponse.json(
      {
        error:
          "One or more clips, the music track, the hook video, or a voice-over haven't finished uploading to the server yet. Wait for everything to show 'uploaded' before rendering.",
      },
      { status: 400 },
    );
  }

  const host = req.headers.get("host") || "localhost:3000";

  // A recognizable label for the queue panel — the video's own header
  // text if it has one, since that's what actually identifies a project
  // at a glance, rather than an opaque job id or timestamp.
  const words = Array.isArray(inputProps.header?.words)
    ? inputProps.header.words
    : [];
  const label =
    words.length > 0
      ? words.map((w: { word: string }) => w.word).join(" ")
      : "Untitled render";

  const job = enqueueRenderJob({ inputProps, host, label });
  return NextResponse.json({ job });
}