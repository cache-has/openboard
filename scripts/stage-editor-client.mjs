#!/usr/bin/env node
// Stages src/editor-client/ as <pkg>/editor-client/ for packing, and removes it
// afterwards.
//
// The browser editor is bundled on demand at runtime by esbuild against
// TypeScript source (see src/server/editor-bundle.ts) rather than being a tsup
// entry point. tsup flattens its output into <pkg>/dist/, so at runtime
// `__dirname` is <pkg>/dist and the first candidate path resolves to
// <pkg>/editor-client/main.ts. Without this staging step the published package
// installs fine but throws "Could not locate editor-client entry" the first
// time anyone opens the editor.
//
// This mirrors exactly what the Dockerfile does with its
// `COPY --from=builder /app/src/editor-client ./editor-client` line.

import { cpSync, rmSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = resolve(__dirname, "../src/editor-client");
const dest = resolve(__dirname, "../editor-client");

if (process.argv.includes("--clean")) {
  rmSync(dest, { recursive: true, force: true });
  process.exit(0);
}

if (!existsSync(src)) {
  console.error(`stage-editor-client: source not found at ${src}`);
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
