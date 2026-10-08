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

const missing = catalog.avatars.filter((a) => !existsSync(resolve(root, "public/avatars", a.file)));
if (missing.length) {
  console.warn(`! ${missing.length} profiles still missing artwork: ${missing.map((m) => m.file).join(", ")}`);
}
