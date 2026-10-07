/**
 * Dev-only tool: rebuild the avatar sprite sheet from the source renders.
 *
 * Reads `src/lib/avatars.catalog.json`, looks for a matching 1:1 render in
 * `avatar-src/` for every entry and falls back to a generated "kit badge"
 * tile when a render is not there yet, so the sprite is always a full grid.
 *
 * Entries that carry a `print` block get their shirt name/number composited by
 * this script (the image service refuses to render some player surnames), so the
 * source renders stay name-free and the sprite stays correct.
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
const work = tile * 2; // render at 2x, downsample at the end for crisp printing
const half = work / 2;
const innerRadius = half - work * 0.0375;

const rendersDir = join(root, "avatar-src");
const workDir = join(root, ".sprite-work");
mkdirSync(workDir, { recursive: true });

const run = (args) => execFileSync("convert", args, { stdio: ["ignore", "pipe", "pipe"] });
/** ImageMagick's `circle` takes a centre plus a point on the rim. */
const disc = (radius) => `circle ${half},${half} ${half},${half - radius}`;

function toRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Interim tile: accent halo + optional striped kit + monogram + surname. */
function placeholderTile(out, entry) {
  const base = join(workDir, "ph-base.png");
  run([
    "-size", `${work}x${work}`, "xc:#06080f",
    "-fill", toRgba(entry.accent, 0.26), "-draw", disc(half - work * 0.145),
    "-fill", "#0d1322", "-draw", disc(innerRadius),
    base,
  ]);

  if (Array.isArray(entry.kit)) {
    const stripes = join(workDir, "ph-stripes.png");
    const mask = join(workDir, "ph-mask.png");
    const band = Math.round(work / 7);
    const rects = [];
    for (let x = band; x < work; x += band * 2) rects.push(`rectangle ${x},0 ${x + band},${work}`);
    run(["-size", `${work}x${work}`, `xc:${entry.kit[0]}`, "-fill", entry.kit[1], "-draw", rects.join(" "), stripes]);
    run(["-size", `${work}x${work}`, "xc:black", "-fill", "white", "-draw", disc(innerRadius), "-alpha", "off", mask]);
    run([stripes, mask, "-compose", "CopyOpacity", "-composite", "-alpha", "activate",
      "-channel", "RGB", "-evaluate", "Multiply", "0.42", "+channel", stripes]);
    run([base, stripes, "-compose", "over", "-composite", base]);
  }

  run([
    base,
    "-stroke", entry.accent, "-strokewidth", Math.round(work * 0.035), "-fill", "none",
    "-draw", disc(innerRadius - work * 0.016),
    "-stroke", toRgba(entry.accent, 0.32), "-strokewidth", 1,
    "-draw", disc(innerRadius - work * 0.069),
    "-font", "DejaVu-Sans-Bold", "-pointsize", Math.round(work * (entry.mono.length > 2 ? 0.075 : 0.125)),
    "-fill", "#f8fafc", "-gravity", "center", "-annotate", "+0-6", entry.mono,
    "-font", "DejaVu-Sans-Bold", "-pointsize", Math.round(work * (entry.jersey.length > 9 ? 0.019 : 0.025)),
    "-fill", toRgba(entry.accent, 0.95), "-gravity", "south", "-annotate", `+0+${Math.round(work * 0.075)}`, entry.jersey.toUpperCase(),
    out,
  ]);
}

/** Shirt printing: name + number with a soft ink shadow, blurred into the fabric. */
function printLayer(out, entry) {
  const p = entry.print;
  const nameSize = Math.round(work * p.nameSize);
  const numSize = Math.round(work * p.numberSize);
  const nameY = Math.round((p.nameY - 0.5) * work);
  const numY = Math.round((p.numberY - 0.5) * work);
  const ink = p.color ?? "#ffd400";
  const shade = p.shadow ?? "rgba(4,8,20,.55)";
  const kern = String(Math.round(nameSize * 0.14));
  run([
    "-size", `${work}x${work}`, "xc:none",
    "-font", "DejaVu-Sans-Bold", "-gravity", "center", "-stroke", "none",
    "-fill", shade,
    "-kerning", kern, "-pointsize", String(nameSize), "-annotate", `+1+${nameY + 3}`, p.name,
    "-kerning", "0", "-pointsize", String(numSize), "-annotate", `+2+${numY + 4}`, p.number,
    "-fill", ink,
    "-kerning", kern, "-pointsize", String(nameSize), "-annotate", `+0+${nameY}`, p.name,
    "-kerning", "0", "-pointsize", String(numSize), "-annotate", `+0+${numY}`, p.number,
    "-blur", "0x1.6",
    "-channel", "A", "-evaluate", "multiply", String(p.opacity ?? 0.94), "+channel",
    out,
  ]);
}

const tiles = [];
const pending = [];
catalog.avatars.forEach((entry, index) => {
  const source = join(rendersDir, entry.file);
  const out = join(workDir, `tile-${String(index).padStart(2, "0")}.png`);
  if (existsSync(source)) {
    run([source, "-resize", `${work}x${work}^`, "-gravity", "center", "-extent", `${work}x${work}`, out]);
    if (entry.print) {
      const layer = join(workDir, "print-layer.png");
      printLayer(layer, entry);
      run([out, layer, "-compose", "over", "-composite", out]);
    }
  } else {
    pending.push(entry.id);
    placeholderTile(out, entry);
  }
});

const allTiles = catalog.avatars.map((_, index) => join(workDir, `tile-${String(index).padStart(2, "0")}.png`));
const sheet = join(workDir, "legends-sheet.png");
execFileSync("montage", [
  ...allTiles, "-tile", `${cols}x${rows}`, "-geometry", `${work}x${work}+0+0`,
  "-background", "none", "-strip", sheet,
], { stdio: "inherit" });

const webp = join(root, "public/avatars/legends.webp");
mkdirSync(dirname(webp), { recursive: true });
run([sheet, "-resize", `${cols * tile}x${rows * tile}`, "-unsharp", "0x0.7+0.6+0.02",
  "-quality", "80", "-define", "webp:method=6", "-define", "webp:exact=1", webp]);

const b64 = execFileSync("base64", ["-w", "0", webp], { encoding: "utf8" }).trim();
writeFileSync(join(root, "src/assets/legends-avatars.b64"), `${b64}\n`);

const bytes = readFileSync(webp).byteLength;
console.log(`✓ sprite ${cols}x${rows} @ ${tile}px  •  ${(bytes / 1024).toFixed(0)} KB webp  •  ${(b64.length / 1024).toFixed(0)} KB base64`);
console.log(`✓ renders: ${catalog.avatars.length - pending.length}/${catalog.avatars.length}`);
if (pending.length) console.log(`· kit badges still standing in for: ${pending.join(", ")}`);
