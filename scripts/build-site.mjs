import { cpSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(root, "dist");
const srcDir = resolve(root, "src");

rmSync(distDir, { recursive: true, force: true });
mkdirSync(resolve(distDir, "data"), { recursive: true });
cpSync(srcDir, distDir, { recursive: true });
