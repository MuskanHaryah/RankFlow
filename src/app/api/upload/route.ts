import { execFile } from "child_process";
import ffmpegPathFromPackage from "ffmpeg-static";
import { existsSync } from "fs";
import { mkdir, unlink, writeFile } from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { promisify } from "util";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

/**
 * ffmpeg-static computes its bundled binary's path at require-time based on
 * its own location on disk. Even with serverExternalPackages set (which
 * should prevent this), a stale `.next` cache or a subtly different
 * bundling path can still hand back a path pointing inside
 * `.next/.../vendor-chunks/` instead of the real `node_modules/ffmpeg-static`
 * folder. This re-derives the real path directly from node_modules as a
 * fallback whenever the imported path doesn't actually exist on disk, so a
 * bundling quirk can't silently break every upload.
 */
const resolveFfmpegPath = (): string => {
  if (ffmpegPathFromPackage && existsSync(ffmpegPathFromPackage)) {
    return ffmpegPathFromPackage;
  }

  const binaryName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const fallbackPath = path.join(
    process.cwd(),
    "node_modules",
    "ffmpeg-static",
    binaryName,
  );

  if (existsSync(fallbackPath)) {
    return fallbackPath;
  }

  throw new Error(
    `Could not locate the ffmpeg binary (tried "${ffmpegPathFromPackage}" and "${fallbackPath}"). Try deleting the .next folder and node_modules/ffmpeg-static, then running npm install again.`,
  );
};

/**
 * Re-encodes a clip into a standard, decode-safe format: constant frame
 * rate, yuv420p pixel format, H.264 + AAC, and `+faststart` so the moov
 * atom is at the front of the file. Clips downloaded/re-exported by social
 * apps (variable frame rate, unusual pixel formats, moov atom at the end)
 * are the #1 cause of "No frame found at position ..." compositor errors
 * during render — those errors are a decode-compatibility problem with the
 * *source file itself*, not the render pipeline, and normalizing on upload
 * fixes it at the root for every clip, not just the one that happened to
 * fail today.
 */
const normalizeVideo = async (
  inputPath: string,
  outputPath: string,
): Promise<void> => {
  const ffmpegPath = resolveFfmpegPath();

  await execFileAsync(ffmpegPath, [
    "-i",
    inputPath,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30", // matches VIDEO_FPS in types/constants.ts
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    "-y",
    outputPath,
  ]);
};

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file");

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  const uploadsDir = path.join(process.cwd(), "public", "uploads");
  await mkdir(uploadsDir, { recursive: true });

  // Strip anything that isn't a safe filename character — your clip
  // filenames are full of emoji, hashtags, and spaces, which are fine in
  // the browser but can break file paths on disk.
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const uniquePrefix = `${Date.now()}-${crypto.randomUUID()}`;
  // The raw upload is written to a temp path first, then normalized into
  // the real, servable filename. The raw copy never gets served or
  // rendered from directly.
  const rawPath = path.join(uploadsDir, `${uniquePrefix}-raw-${safeName}`);
  const filename = `${uniquePrefix}-${safeName}`;
  const filePath = path.join(uploadsDir, filename);

  const bytes = await file.arrayBuffer();
  await writeFile(rawPath, new Uint8Array(bytes));

  try {
    await normalizeVideo(rawPath, filePath);
  } catch (error) {
    console.error(`ffmpeg normalization failed for "${file.name}":`, error);
    return NextResponse.json(
      {
        error: `Could not process "${file.name}" — the file may be corrupted or in an unsupported format.`,
      },
      { status: 500 },
    );
  } finally {
    // Best-effort cleanup — a leftover raw temp file isn't harmful, just
    // wasted disk space, so a failed unlink shouldn't fail the request.
    await unlink(rawPath).catch(() => {});
  }

  // This path is servable by Next.js directly (anything under /public is
  // static-served at the site root) AND resolvable by Remotion's own local
  // render process later, since both treat /public the same way.
  return NextResponse.json({ url: `/uploads/${filename}` });
}