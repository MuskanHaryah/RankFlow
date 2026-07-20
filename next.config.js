/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // ffmpeg-static resolves its bundled binary's path at require-time based
  // on its own location on disk. If webpack bundles it like normal
  // application code, that path calculation breaks — the require() gets
  // rewritten to point inside .next/.../vendor-chunks instead of the real
  // node_modules/ffmpeg-static folder, and the binary "disappears" (ENOENT)
  // even though it's still sitting right there in node_modules. Marking it
  // external tells Next.js to leave it as a real Node require() at runtime
  // instead of bundling it.
  serverExternalPackages: ["ffmpeg-static"],
  async headers() {
    return [
      {
        // Covers /uploads/* and /renders/* (anything under public/)
        source: "/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, HEAD, OPTIONS" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;