// Builds the UI into single self-contained HTML files (JS, CSS and the engine worker inlined):
//   dist/index.html     full document, embedded by the plugin (JUCE BinaryData → WebView)
//   dist/artifact.html  page body for the claude.ai artifact demo (the host adds the skeleton)
import { build, context } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const watch = process.argv.includes("--watch");
const FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;800&family=IBM+Plex+Mono:wght@400;600&display=swap">';
const TITLE = "<title>Fourierizer</title>";
const BODY = '<div id="app" class="fz"></div><div id="toast" role="status" aria-live="polite"></div>';

async function bundle(entry, define = {}) {
  const r = await build({ entryPoints: [entry], bundle: true, format: "iife", target: "es2022", minify: true, write: false, define, legalComments: "none" });
  return r.outputFiles[0].text;
}

async function once() {
  const t0 = Date.now();
  const worker = await bundle("src/worker.ts");
  const app = await bundle("src/main.ts", { __WORKER_SOURCE__: JSON.stringify(worker) });
  const css = await readFile("src/styles.css", "utf8");
  const js = app.replace(/<\/script/gi, "<\\/script");
  await mkdir("dist", { recursive: true });
  await writeFile("dist/index.html",
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${TITLE}${FONTS}<style>${css}</style></head><body>${BODY}<script>${js}</script></body></html>`);
  await writeFile("dist/artifact.html", `${TITLE}\n${FONTS}\n<style>${css}</style>\n${BODY}\n<script>${js}</script>\n`);
  console.log(`built dist/index.html and dist/artifact.html (${(js.length / 1024).toFixed(0)} KB js) in ${Date.now() - t0} ms`);
}

await once();
if (watch) {
  const ctx = await context({ entryPoints: ["src/main.ts", "src/worker.ts", "src/styles.css"], bundle: true, write: false, plugins: [{ name: "rebuild", setup(b) { b.onEnd(() => once().catch(console.error)); } }] });
  await ctx.watch();
  console.log("watching src/ …");
}
