import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
await mkdir(resolve(dist, "popup"), { recursive: true });
await cp(resolve(root, "src/popup/popup.html"), resolve(dist, "popup/popup.html"));
await cp(resolve(root, "src/popup/popup.css"), resolve(dist, "popup/popup.css"));
