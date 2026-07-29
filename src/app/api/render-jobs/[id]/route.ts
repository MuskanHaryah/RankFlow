import { NextRequest, NextResponse } from "next/server";
import { cancelQueuedJob } from "../../../../server/renderQueue";

export const runtime = "nodejs";

/**
 * Phase 16 — removes a job that's still waiting in line. Only works while
 * a job is still "queued" (see cancelQueuedJob's own doc comment for why
 * an already-rendering job can't be cancelled this way) — returns 400
 * rather than silently no-op'ing so the queue panel can tell the
 * difference and leave the job showing instead of assuming it vanished.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const cancelled = cancelQueuedJob(id);

  if (!cancelled) {
    return NextResponse.json(
      { error: "Job not found, or it's already rendering or finished." },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}