import { exec } from "child_process";
import { mkdir, writeFile } from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import os from "os";
import path from "path";
import { promisify } from "util";
import { COMP_NAME } from "../../../../types/constants";

export const runtime = "nodejs";

const execAsync = promisify(exec);

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
  // memory. Every clip, plus any music/voice-over track (Phase 12), must
  // already be a real uploaded server path before we even attempt a
  // render.
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

  // Point at the already-running Next.js server directly, using an absolute
  // URL, rather than a path relative to Remotion's own bundle. Remotion
  // normally copies the whole public/ folder into a temporary snapshot
  // before rendering, and that copy step has proven unreliable for files
  // that were just uploaded — the live Next.js server is already serving
  // these files correctly, so there's no reason to route through a second,
  // less reliable copy of them. This has to cover every uploaded-file
  // field on inputProps, not just clips — music and voiceOvers (Phase 12)
  // are uploaded the exact same way and hit the exact same bundle-copy
  // unreliability if left as relative paths.
  const host = req.headers.get("host") || "localhost:3000";
  const toAbsolute = (src: string) =>
    src.startsWith("http") ? src : `http://${host}${src}`;

  const clipsWithAbsoluteUrls = inputProps.clips.map(
    (clip: { src: string }) => ({
      ...clip,
      src: toAbsolute(clip.src),
    }),
  );

  const musicWithAbsoluteUrl =
    inputProps.music && typeof inputProps.music.src === "string"
      ? { ...inputProps.music, src: toAbsolute(inputProps.music.src) }
      : inputProps.music;

  const voiceOversWithAbsoluteUrls = Array.isArray(inputProps.voiceOvers)
    ? inputProps.voiceOvers.map((voiceOver: { src: string }) => ({
        ...voiceOver,
        src: toAbsolute(voiceOver.src),
      }))
    : inputProps.voiceOvers;

  const hookWithAbsoluteUrl =
    inputProps.hook && typeof inputProps.hook.src === "string"
      ? { ...inputProps.hook, src: toAbsolute(inputProps.hook.src) }
      : inputProps.hook;

  const propsToWrite = {
    ...inputProps,
    clips: clipsWithAbsoluteUrls,
    music: musicWithAbsoluteUrl,
    voiceOvers: voiceOversWithAbsoluteUrls,
    hook: hookWithAbsoluteUrl,
  };

  const propsPath = path.join(os.tmpdir(), `rankflow-props-${Date.now()}.json`);
  await writeFile(propsPath, JSON.stringify(propsToWrite));

  const outputDir = path.join(process.cwd(), "public", "renders");
  await mkdir(outputDir, { recursive: true });
  const outputFilename = `output-${Date.now()}.mp4`;
  const outputPath = path.join(outputDir, outputFilename);

  // A random port per render (rather than a fixed one) so that two renders
  // happening close together in time — e.g. testing in two tabs, or a
  // second attempt started before the first finished — don't collide on
  // the same port. We avoid letting Remotion auto-pick entirely, since it
  // can end up choosing port 3000 (colliding with the Next.js dev server
  // itself) if a PORT environment variable happens to be inherited from
  // this very process.
  const renderPort = 7000 + Math.floor(Math.random() * 1000);

  const command = `npx remotion render src/remotion/index.ts ${COMP_NAME} "${outputPath}" --props="${propsPath}" --port=${renderPort} --bundle-cache=false --concurrency=1`;

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024 * 20, // Remotion's render logs can be verbose
    });

    console.log("Remotion render stdout:\n", stdout);
    if (stderr) {
      console.log("Remotion render stderr:\n", stderr);
    }

    return NextResponse.json({ url: `/renders/${outputFilename}` });
  } catch (error) {
    console.error("Local render failed:", error);
    const message =
      error instanceof Error
        ? error.message
        : "Render failed. Check the terminal running `npm run dev` for full details.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}