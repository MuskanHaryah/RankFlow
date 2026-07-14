import { mkdir, writeFile } from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import path from "path";

export const runtime = "nodejs";

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
  const filename = `${Date.now()}-${crypto.randomUUID()}-${safeName}`;
  const filePath = path.join(uploadsDir, filename);

  const bytes = await file.arrayBuffer();
  await writeFile(filePath, new Uint8Array(bytes));

  // This path is servable by Next.js directly (anything under /public is
  // static-served at the site root) AND resolvable by Remotion's own local
  // render process later, since both treat /public the same way.
  return NextResponse.json({ url: `/uploads/${filename}` });
}