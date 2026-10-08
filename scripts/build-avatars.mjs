import { copyFile, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Copies every profile portrait from the committed `image/` folder into
 * `public/avatars/` so Vite/Workers Static Assets can serve them, and unpacks
 * the app badge. `image/` is the single source of truth for all 30 profiles.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

await mkdir(resolve(root, "public/avatars"), { recursive: true });

const catalog = JSON.parse(await readFile(resolve(root, "src/lib/avatars.catalog.json"), "utf8"));

let copied = 0;
for (const avatar of catalog.avatars) {
  const from = resolve(root, catalog.source.folder, avatar.file);
  if (!existsSync(from)) {
    console.warn(`! missing profile image: ${from}`);
    continue;
  }
  await copyFile(from, resolve(root, "public/avatars", avatar.file));
  copied++;
}
console.log(`✓ ${copied}/${catalog.avatars.length} profile portraits → public/avatars/`);

const base64 = (await readFile(resolve(root, "src/assets/hallocall-avatar.b64"), "utf8")).replace(/\s+/g, "");
await writeFile(resolve(root, "public/avatars/hallocall.webp"), Buffer.from(base64, "base64"));
console.log("✓ HalloCall app avatar → public/avatars/hallocall.webp");

/* Static interface artwork (home hero, call-room illustration) lives next to the
   portraits in `image/site/` so the whole art set stays in one folder; it is
   copied to `public/site/` here. Purely decorative → never blocks the UI. */
const siteDir = resolve(root, catalog.source.folder, "site");
if (existsSync(siteDir)) {
  await mkdir(resolve(root, "public/site"), { recursive: true });
  const art = (await readdir(siteDir)).filter((f) => /\.(webp|avif|png|jpg|svg)$/i.test(f));
  for (const file of art) {
    await copyFile(resolve(siteDir, file), resolve(root, "public/site", file));
  }
  console.log(`✓ ${art.length} interface artwork files → public/site/`);
} else {
  console.warn("! image/site/ not found — interface artwork will fall back to gradients");
}

const missing = catalog.avatars.filter((a) => !existsSync(resolve(root, "public/avatars", a.file)));
if (missing.length) {
  console.warn(`! ${missing.length} profiles still missing artwork: ${missing.map((m) => m.file).join(", ")}`);
}

/* Guard rail: the Worker only accepts avatar ids it knows about, and that list
   lives in src/lib/types.ts. Warn as soon as the catalog and the backend drift. */
const typesSource = await readFile(resolve(root, "src/lib/types.ts"), "utf8");
const selectable = typesSource.match(/SELECTABLE_AVATAR_IDS\s*=\s*\[([\s\S]*?)\]\s*as const/);
if (selectable) {
  const declared = new Set([...selectable[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  const notInTypes = catalog.avatars.filter((a) => !declared.has(a.id)).map((a) => a.id);
  if (notInTypes.length) {
    console.warn(`! avatar ids missing from SELECTABLE_AVATAR_IDS in src/lib/types.ts: ${notInTypes.join(", ")}`);
  }
}
