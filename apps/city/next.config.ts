import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

// One .env for the whole repository. Values already set in the environment win.
const rootEnv = join(repoRoot, ".env");
if (existsSync(rootEnv)) {
  const before = { ...process.env };
  process.loadEnvFile(rootEnv);
  for (const [k, v] of Object.entries(before)) if (v !== undefined) process.env[k] = v;
}

/**
 * Security headers for every response. Script-src allows inline scripts because Next.js injects
 * its hydration data inline; everything else is locked to this origin plus the two voice endpoints.
 */
const csp = [
  "default-src 'self'",
  // React needs eval only in development for its debugging tools. Production never allows it.
  `script-src 'self' 'unsafe-inline' blob:${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "media-src 'self' blob: data:",
  "connect-src 'self' https://api.elevenlabs.io wss://api.elevenlabs.io wss://*.elevenlabs.io",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  transpilePackages: ["@porchlight/protocol"],
  serverExternalPackages: ["pg"],
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
