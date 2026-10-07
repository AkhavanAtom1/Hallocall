/**
 * Dev-only tool: rebuild the avatar sprite sheet from the source renders.
 *
 * Reads `src/lib/avatars.catalog.json`, looks for a matching 1:1 render in
 * `avatar-src/` for every entry and falls back to a generated "kit badge"
 * tile when a render is not there yet, so the sprite is always a full grid.
 *
 * Output: `public/avatars/legends.webp` + the committed base64 source
 * `src/assets/legends-avatars.b64` that `scripts/build-avatars.mjs` unpacks
 * during install/build (no ImageMagick needed on CI).
 *
 * Usage:  node scripts/compose-avatars.mjs
 * Needs:  ImageMagick 7 (`convert` / `montage`)
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(readFileSync(join(root, "src/lib/avatars.catalog.json"), "utf8"));
const { cols, rows, tile } = catalog.sprite;
const rendersDir = join(root, "avatar-src");
const workDir = join(root, ".sprite-work");
mkdirSync(workDir, { recursive: true });

const run = (args) => execFileSync("convert", args, { stdio: ["ignore", "pipe", "pipe"] });
const half = tile / 2;
const innerRadius = half - 12;
/** IM's `circle` takes the centre plus a point on the rim, so radii need this form. */
const disc = (radius) => `circle ${half},${half} ${half},${half - radius}`;

const toRgba = (hex, alpha) => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
};

/** Interim tile: accent halo + optional striped kit + monogram + surname. */
function placeholderTile(out, entry) {
  const base = join(workDir, "ph-base.png");
  run([
    "-size", `${tile}x${tile}`, "xc:#06080f",
    "-fill", toRgba(entry.accent, 0.26), "-draw", disc(half - 46),
    "-fill", "#0d1322", "-draw", disc(innerRadius),
    base,
  ]);

  if (Array.isArray(entry.kit)) {
    const stripes = join(workDir, "ph-stripes.png");
    const mask = join(workDir, "ph-mask.png");
    const band = Math.round(tile / 7);
    const rects = [];
    for (let x = band; x < tile; x += band * 2) rects.push(`rectangle ${x},0 ${x + band},${tile}`);
    run(["-size", `${tile}x${tile}`, `xc:${entry.kit[0]}`, "-fill", entry.kit[1], "-draw", rects.join(" "), stripes]);
    run(["-size", `${tile}x${tile}`, "xc:black", "-fill", "white", "-draw", disc(innerRadius), "-alpha", "off", mask]);
    run([stripes, mask, "-compose", "CopyOpacity", "-composite", "-alpha", "activate",
      "-channel", "RGB", "-evaluate", "Multiply", "0.42", "+channel", stripes]);
    run([base, "-gravity", "center", stripes, "-compose", "over", "-composite", base]);
  }

  run([
    base,
    "-stroke", entry.accent, "-strokewidth", Math.round(tile * 0.035), "-fill", "none",
    "-draw", disc(innerRadius - 5),
    "-stroke", toRgba(entry.accent, 0.32), "-strokewidth", 1,
    "-draw", disc(innerRadius - 22),
    "-font", "DejaVu-Sans-Bold", "-pointsize", Math.round(tile * (entry.mono.length > 2 ? 0.15 : 0.25)),
    "-fill", "#f8fafc", "-gravity", "center", "-annotate", "+0-6", entry.mono,
    "-font", "DejaVu-Sans-Bold", "-pointsize", Math.round(tile * (entry.jersey.length > 9 ? 0.038 : 0.05)),
    "-fill", toRgba(entry.accent, 0.95), "-gravity", "south", "-annotate", `+0+${Math.round(tile * 0.075)}`, entry.jersey.toUpperCase(),
    out,
  ]);
}

const tiles = [];
const pending = [];
catalog.avatars.forEach((entry, index) => {
  const source = join(rendersDir, entry.file);
  const out = join(workDir, `tile-${String(index).padStart(2, "0")}.png`);
  if (existsSync(source)) {
    run([source, "-resize", `${tile}x${tile}^`, "-gravity", "center", "-extent", `${tile}x${tile}`, "-strip", out]);
  } else {
    pending.push(entry.id);
    placeholderTile(out, entry);
  }
  tiles.push(out);
});

const sheet = join(workDir, "legends-sheet.png");
execFileSync("montage", [
  ...tiles, "-tile", `${cols}x${rows}`, "-geometry", `${tile}x${tile}+0+0`,
  "-background", "none", "-strip", sheet,
], { stdio: "inherit" });

const webp = join(root, "public/avatars/legends.webp");
mkdirSync(dirname(webp), { recursive: true });
run([sheet, "-quality", "80", "-define", "webp:method=6", "-define", "webp:exact=1", webp]);

const b64 = execFileSync("base64", ["-w", "0", webp], { encoding: "utf8" }).trim();
writeFileSync(join(root, "src/assets/legends-avatars.b64"), `${b64}\n`);

const bytes = readFileSync(webp).byteLength;
console.log(`✓ sprite ${cols}x${rows} @ ${tile}px  •  ${(bytes / 1024).toFixed(0)} KB webp  •  ${(b64.length / 1024).toFixed(0)} KB base64`);
console.log(`✓ renders: ${catalog.avatars.length - pending.length}/${catalog.avatars.length}`);
if (pending.length) console.log(`· kit badges still standing in for: ${pending.join(", ")}`);
