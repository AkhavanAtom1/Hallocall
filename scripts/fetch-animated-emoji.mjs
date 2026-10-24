import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Downloads the animated emoji used by reactions and chat into `public/emoji/`
 * so they are served from this site (fast, works offline, nothing depends on a
 * third-party host while people are in a call).
 *
 *   • Pack: "Noto Emoji Animation" by Google — licensed CC BY 4.0
 *     (https://googlefonts.github.io/noto-emoji-animation/). The attribution is
 *     shown in the app's settings and written to public/emoji/ATTRIBUTION.txt.
 *   • The list lives in src/lib/animatedEmoji.json (shared with the app).
 *   • Files that already exist are kept, so after the first run — or after you
 *     commit public/emoji/ — builds need no network at all.
 *   • This step NEVER fails the build: missing files simply fall back to the
 *     normal system emoji at runtime.
 *
 * Set EMOJI_STRICT=1 to make failures fatal, EMOJI_SIZE=256 to change the
 * stored size (only applied when `sharp` happens to be installed).
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(process.env.EMOJI_OUT || resolve(root, "public/emoji"));
const catalog = JSON.parse(await readFile(resolve(root, "src/lib/animatedEmoji.json"), "utf8"));
const size = Math.min(512, Math.max(64, Number(process.env.EMOJI_SIZE) || 256));
const strict = process.env.EMOJI_STRICT === "1";

await mkdir(outDir, { recursive: true });

let sharp = null;
try { sharp = (await import("sharp")).default; } catch { /* optional: files are then stored as downloaded (512 px) */ }

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function exists(path) {
  try { return (await stat(path)).size > 2000; } catch { return false; }
}

async function download(code) {
  const url = `${catalog.cdn}/${code}/512.webp`;
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 2000 || bytes.subarray(0, 4).toString("latin1") !== "RIFF") throw new Error("not a WebP file");
      return bytes;
    } catch (error) {
      last = error;
      await sleep(400 * attempt);
    }
  }
  throw last;
}

async function shrink(bytes) {
  if (!sharp) return bytes;
  try {
    const smaller = await sharp(bytes, { animated: true }).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 80, effort: 4 }).toBuffer();
    return smaller.length > 2000 && smaller.length < bytes.length ? smaller : bytes;
  } catch {
    return bytes;
  }
}

const pending = [];
let have = 0;
const failed = [];

async function work(item) {
  const file = resolve(outDir, `${item.code}.webp`);
  if (await exists(file)) { have += 1; return; }
  try {
    const bytes = await shrink(await download(item.code));
    await writeFile(file, bytes);
    have += 1;
  } catch (error) {
    failed.push(`${item.emoji} ${item.code} (${error instanceof Error ? error.message : error})`);
  }
}

/* A few downloads at a time keeps it polite and quick. */
const queue = [...catalog.emojis];
await Promise.all(Array.from({ length: 6 }, async () => {
  while (queue.length) await work(queue.shift());
}));
void pending;

await writeFile(resolve(outDir, "ATTRIBUTION.txt"),
`Animated emoji: "Noto Emoji Animation" © Google, licensed under CC BY 4.0
https://creativecommons.org/licenses/by/4.0/
Source and original files: ${catalog.source}
Files are used unmodified or only scaled down. HalloCall is not affiliated with Google.
`);

console.log(`✓ ${have}/${catalog.emojis.length} animated emoji → ${outDir.replace(root + "/", "")}${sharp ? ` (resized to ${size}px)` : ""}`);
if (failed.length) {
  console.warn(`! ${failed.length} emoji could not be downloaded; the app will show the normal emoji for them:\n  ${failed.join("\n  ")}`);
  if (strict) process.exit(1);
}
