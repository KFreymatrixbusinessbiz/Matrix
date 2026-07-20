import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const files = (await readdir(root)).filter((name) => name.endsWith(".html")).sort();
const errors = [];

const localReferences = (html) => {
  const refs = [];
  const pattern = /(?:href|src)=["']([^"']+)["']/gi;
  for (const match of html.matchAll(pattern)) {
    const ref = match[1];
    if (/^(?:https?:|mailto:|tel:|data:|javascript:|#)/i.test(ref)) continue;
    refs.push(ref.split(/[?#]/)[0]);
  }
  return refs.filter(Boolean);
};

for (const file of files) {
  const html = await readFile(path.join(root, file), "utf8");
  if (!/<html\b[^>]*\blang=["']en["']/i.test(html)) errors.push(`${file}: missing language declaration`);
  if (!/<meta\b[^>]*name=["']viewport["']/i.test(html)) errors.push(`${file}: missing viewport metadata`);
  if (!/<title>[^<]+<\/title>/i.test(html)) errors.push(`${file}: missing title`);
  if (file !== "404.html" && !/<meta\b[^>]*name=["']description["']/i.test(html)) errors.push(`${file}: missing description`);
  if (file !== "404.html" && !/<link\b[^>]*rel=["']canonical["']/i.test(html)) errors.push(`${file}: missing canonical URL`);

  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/gi)].map((match) => match[1]);
  for (const id of new Set(ids)) {
    if (ids.filter((value) => value === id).length > 1) errors.push(`${file}: duplicate id ${id}`);
  }

  for (const ref of localReferences(html)) {
    try {
      await access(path.join(root, ref));
    } catch {
      errors.push(`${file}: missing local reference ${ref}`);
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`Verified ${files.length} Matrix pages and their local references.`);
