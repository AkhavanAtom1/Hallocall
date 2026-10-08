import { mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Dev-only helper: turns raw 1024×1024 generations in `.gen/` into the final
 * 512×512 WebP portraits committed to `image/` (the single source of truth).
 * Requires ImageMagick (`convert`). `scripts/build-avatars.mjs` later copies
 * `image/` into `public/avatars/` at build time.
 *
 *   node scripts/compose-avatars.mjs
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(await readFile(resolve(root, "src/lib/avatars.catalog.json"), "utf8"));

const genDir = join(root, ".gen");
const imageDir = join(root, catalog.source.folder);
await mkdir(imageDir, { recursive: true });

const done = [];
const missing = [];

for (const avatar of catalog.avatars) {
  const target = join(imageDir, avatar.file);
  if (existsSync(target)) {
    done.push(avatar.file);
    continue;
  }
  const rawName = avatar.file.replace(/\.webp$/, ".png");
  const raw = join(genDir, rawName);
  if (!existsSync(raw)) {
    missing.push(rawName);
    continue;
  }
  execFileSync("convert", [
    raw, "-resize", "512x512^", "-gravity", "center", "-extent", "512x512",
    "-quality", "85", "-strip", target,
  ]);
  done.push(avatar.file);
  console.log(`✓ composed ${avatar.file}`);
}

console.log(`\n${done.length}/${catalog.avatars.length} profiles ready in image/`);
if (missing.length) {
  console.log(`still waiting for raw generations in .gen/: ${missing.join(", ")}`);
}
