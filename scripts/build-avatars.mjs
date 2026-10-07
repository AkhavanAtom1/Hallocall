import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Binary assets are committed as base64 so a plain `npm ci && build` works on CI
 * without image tooling. They are produced by `node scripts/compose-avatars.mjs`.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const targets = [
  { source: "src/assets/legends-avatars.b64", output: "public/avatars/legends.webp", label: "Legend avatar sprite (30 profiles)" },
  { source: "src/assets/hallocall-avatar.b64", output: "public/avatars/hallocall.webp", label: "HalloCall app avatar + favicon" },
];

for (const target of targets) {
  const base64 = (await readFile(resolve(root, target.source), "utf8")).replace(/\s+/g, "");
  const output = resolve(root, target.output);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, Buffer.from(base64, "base64"));
  console.log(`✓ ${target.label} → ${target.output}`);
}
