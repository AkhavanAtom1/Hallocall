import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "src/assets/football-legends-avatars.b64");
const output = resolve(root, "public/avatars/football-legends.webp");

const base64 = (await readFile(source, "utf8")).replace(/\s+/g, "");
await mkdir(dirname(output), { recursive: true });
await writeFile(output, Buffer.from(base64, "base64"));
console.log("✓ Football legend avatar sprite generated.");
