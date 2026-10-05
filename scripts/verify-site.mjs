import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const files = (await readdir(root)).filter((name) => name.endsWith(".html")).sort();
const errors = [];

const resolveLocalReference = (ref) => {
  const clean = ref.replace(/^\//, "");
  if (!clean) return "index.html";
  if (path.extname(clean)) return clean;
  return `${clean}.html`;
};

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

  const canonical = html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1];
  if (canonical?.includes(".html")) errors.push(`${file}: canonical URL is not extensionless`);

  for (const match of html.matchAll(/href=["']([^"']+\.html(?:[?#][^"']*)?)["']/gi)) {
    errors.push(`${file}: internal HTML link is not extensionless: ${match[1]}`);
  }

  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/gi)].map((match) => match[1]);
  for (const id of new Set(ids)) {
    if (ids.filter((value) => value === id).length > 1) errors.push(`${file}: duplicate id ${id}`);
  }

  for (const ref of localReferences(html)) {
    try {
      await access(path.join(root, resolveLocalReference(ref)));
    } catch {
      errors.push(`${file}: missing local reference ${ref}`);
    }
  }
}

const sitemap = await readFile(path.join(root, "sitemap.xml"), "utf8");
const sitemapUrls = [...sitemap.matchAll(/<loc>(https:\/\/matrixbusiness\.biz\/[^<]*)<\/loc>/g)]
  .map((match) => new URL(match[1]));

if (!sitemapUrls.some((url) => url.pathname === "/about")) {
  errors.push("sitemap.xml: missing /about");
}
if (sitemapUrls.some((url) => url.pathname === "/my-account")) {
  errors.push("sitemap.xml: /my-account must remain excluded");
}

for (const url of sitemapUrls) {
  if (url.pathname.includes(".html")) {
    errors.push(`sitemap.xml: URL is not extensionless: ${url.pathname}`);
  }
  try {
    await access(path.join(root, resolveLocalReference(url.pathname)));
  } catch {
    errors.push(`sitemap.xml: missing destination ${url.pathname}`);
  }
}

const { default: worker } = await import("../worker.js");
const assetEnvironment = {
  ASSETS: {
    fetch: () => new Response("asset", { status: 200 })
  }
};

const expectRedirect = async (source, expected) => {
  const response = await worker.fetch(new Request(source), assetEnvironment);
  if (response.status !== 301 || response.headers.get("location") !== expected) {
    errors.push(
      `worker redirect: ${source} expected 301 ${expected}, got ${response.status} ${response.headers.get("location")}`
    );
  }
};

await expectRedirect(
  "https://matrix.kfrey.workers.dev/technology.html?source=legacy",
  "https://matrix.kfrey.workers.dev/technology?source=legacy"
);
await expectRedirect(
  "https://matrix.kfrey.workers.dev/services-7",
  "https://matrix.kfrey.workers.dev/technology"
);
await expectRedirect(
  "https://matrix.kfrey.workers.dev/s-projects-side-by-side",
  "https://matrix.kfrey.workers.dev/copiers-multifunction"
);
await expectRedirect(
  "https://matrix.kfrey.workers.dev/about-1",
  "https://matrix.kfrey.workers.dev/about"
);
await expectRedirect(
  "https://matrix.kfrey.workers.dev/blank-4",
  "https://matrix.kfrey.workers.dev/contact"
);
await expectRedirect(
  "https://www.matrixbusiness.biz/contact?source=www",
  "https://matrixbusiness.biz/contact?source=www"
);

for (const pathname of [
  "/blank-3",
  "/government-solutions",
  "/copy-of-government-solutions",
  "/capabilities-statement",
  "/about-5"
]) {
  const response = await worker.fetch(
    new Request(`https://matrix.kfrey.workers.dev${pathname}`),
    assetEnvironment
  );
  if (response.status !== 200 || response.headers.has("location")) {
    errors.push(`worker redirect: deferred path must not redirect: ${pathname}`);
  }
}

const privateResponse = await worker.fetch(
  new Request("https://matrix.kfrey.workers.dev/contact"),
  assetEnvironment
);
if (privateResponse.headers.get("x-robots-tag") !== "noindex, nofollow, noarchive") {
  errors.push("worker indexing: workers.dev response is missing noindex protection");
}

const productionResponse = await worker.fetch(
  new Request("https://matrixbusiness.biz/contact"),
  assetEnvironment
);
if (productionResponse.headers.has("x-robots-tag")) {
  errors.push("worker indexing: production marketing response must not include x-robots-tag");
}

const originalConsoleError = console.error;
console.error = () => {};
try {
  const missingConfigurationResponse = await worker.fetch(
    new Request("https://matrix.kfrey.workers.dev/api/inquiry", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://matrix.kfrey.workers.dev"
      },
      body: "{}"
    }),
    assetEnvironment
  );
  if (missingConfigurationResponse.status !== 503) {
    errors.push(
      `worker inquiry: missing Graph configuration expected 503, got ${missingConfigurationResponse.status}`
    );
  }
} finally {
  console.error = originalConsoleError;
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`Verified ${files.length} Matrix pages and their local references.`);
