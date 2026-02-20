import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

export function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function writeText(filePath, content) {
  ensureDir(path.dirname(filePath));
  writeFileSync(filePath, content, "utf8");
}

export function readJsonSafe(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function relativeToRoot(root, filePath) {
  return path.relative(root, filePath) || ".";
}
