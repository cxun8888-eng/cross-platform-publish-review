import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const ignored = new Set([".git", "node_modules", "dist", ".pytest_cache"]);

function markdownFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    if (ignored.has(name)) return [];
    const path = join(directory, name);
    return statSync(path).isDirectory() ? markdownFiles(path) : extname(path) === ".md" ? [path] : [];
  });
}

const failures = [];
for (const file of markdownFiles(root)) {
  const text = readFileSync(file, "utf8");
  const links = text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g);
  for (const match of links) {
    const target = match[1].trim().replace(/^<|>$/g, "");
    if (!target || /^(?:https?:|mailto:|#)/.test(target)) continue;
    const pathPart = decodeURIComponent(target.split("#", 1)[0]);
    if (!pathPart || existsSync(resolve(dirname(file), pathPart))) continue;
    failures.push(`${file.slice(root.length + 1)} -> ${target}`);
  }
}

if (failures.length) {
  console.error(`发现 ${failures.length} 个失效的本地文档链接：`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log("本地 Markdown 文件链接检查通过");
}
