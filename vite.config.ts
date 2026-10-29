import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";

/**
 * Builds sw.js with the list of files to precache, so the app works offline after
 * the first visit. Keeps the project free of a PWA plugin dependency.
 */
function serviceWorker(): Plugin {
  return {
    name: "patchbook-service-worker",
    apply: "build",
    generateBundle(_options, bundle) {
      const publicDir = join(import.meta.dirname, "public");
      const walk = (dir: string): string[] =>
        readdirSync(dir).flatMap((f) => {
          const p = join(dir, f);
          return statSync(p).isDirectory() ? walk(p) : [relative(publicDir, p).split("\\").join("/")];
        });
      const files = ["./", ...Object.keys(bundle), ...walk(publicDir)]
        .filter((f) => !f.endsWith(".map") && f !== "sw.js")
        .map((f) => (f === "./" ? f : `./${f}`));
      const version = createHash("sha256").update(files.join("|")).update(String(Date.now())).digest("hex").slice(0, 12);
      const template = readFileSync(join(import.meta.dirname, "src/sw-template.js"), "utf8");
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: template.replace("__VERSION__", version).replace("__PRECACHE__", JSON.stringify(files)),
      });
    },
  };
}

/**
 * Adds a Content-Security-Policy to the built page: scripts, styles, fonts and images only from
 * this site, and network requests only to this site and the sync server (when sync is set up).
 * React's style attributes need 'unsafe-inline' for styles; scripts stay strict. Frame and
 * other HTTP-only headers are in vercel.json.
 */
function contentSecurityPolicy(syncUrl?: string): Plugin {
  let connect = "'self'";
  if (syncUrl) {
    try {
      connect += ` ${new URL(syncUrl).origin}`;
    } catch {
      /* no sync */
    }
  }
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connect}`,
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  return {
    name: "patchbook-csp",
    apply: "build",
    transformIndexHtml: () => [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: policy }, injectTo: "head-prepend" }],
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    base: "./",
    plugins: [react(), serviceWorker(), contentSecurityPolicy(env.VITE_SYNC_URL)],
    build: { target: "es2022", sourcemap: true },
  };
});
