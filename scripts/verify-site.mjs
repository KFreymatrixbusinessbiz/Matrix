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

  if (file === "contact.html") {
    if (!/<a\s+href=["']#discussion-form["'][^>]*>[\s\S]*?Website inquiry/i.test(html)) {
      errors.push("contact.html: primary contact option must open the website inquiry form");
    }
    if (!/<form\b[^>]*id=["']discussion-form["']/i.test(html)) {
      errors.push("contact.html: missing discussion form");
    }
    if (!/contact-secondary-email[\s\S]*?mailto:contact@matrixbusiness\.biz/i.test(html)) {
      errors.push("contact.html: direct email must remain available as a secondary option");
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
  "https://matrix.kfrey.workers.dev/blank-3?source=legacy",
  "https://inpower.biz/?source=legacy"
);
await expectRedirect(
  "https://matrix.kfrey.workers.dev/new-inpower",
  "https://inpower.biz/"
);
await expectRedirect(
  "https://matrix.kfrey.workers.dev/government-solutions?source=legacy",
  "https://matrix.kfrey.workers.dev/practice-areas?source=legacy"
);
await expectRedirect(
  "https://matrix.kfrey.workers.dev/copy-of-government-solutions",
  "https://matrix.kfrey.workers.dev/how-we-work"
);
await expectRedirect(
  "https://www.matrixbusiness.biz/contact?source=www",
  "https://matrixbusiness.biz/contact?source=www"
);

for (const pathname of [
  "/capabilities-statement",
  "/about-5",
  "/cart-page",
  "/checkout",
  "/product-page",
  "/category"
]) {
  const response = await worker.fetch(
    new Request(`https://matrix.kfrey.workers.dev${pathname}`),
    assetEnvironment
  );
  if (response.status !== 410 || response.headers.has("location")) {
    errors.push(`worker retirement: ${pathname} expected 410 without redirect`);
  }
}

const unknownResponse = await worker.fetch(
  new Request("https://matrix.kfrey.workers.dev/not-a-real-matrix-route"),
  { ASSETS: { fetch: () => new Response("not found", { status: 404 }) } }
);
if (unknownResponse.status !== 404 || unknownResponse.headers.has("location")) {
  errors.push("worker routing: unknown paths must remain 404 without redirect");
}

const paymentPageResponse = await worker.fetch(
  new Request("https://matrix.kfrey.workers.dev/my-account"),
  assetEnvironment
);
if (paymentPageResponse.status !== 200 || paymentPageResponse.headers.has("location")) {
  errors.push("worker routing: /my-account must remain available without redirect");
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

const contactScript = await readFile(path.join(root, "contact-form.js"), "utf8");
for (const requiredPattern of [
  /form\.reportValidity\(\)/,
  /fetch\(["']\/api\/inquiry["']/,
  /method:\s*["']POST["']/,
  /status\.dataset\.state\s*=\s*["']success["']/,
  /status\.dataset\.state\s*=\s*["']error["']/
]) {
  if (!requiredPattern.test(contactScript)) {
    errors.push(`contact-form.js: missing required behavior ${requiredPattern}`);
  }
}

const configuredEnvironment = {
  ...assetEnvironment,
  MICROSOFT_CLIENT_ID: "test-client",
  MICROSOFT_CLIENT_SECRET: "test-secret",
  MICROSOFT_TENANT_ID: "test-tenant",
  MICROSOFT_SENDER_EMAIL: "sender@example.test",
  INQUIRY_RECIPIENTS: "recipient-one@example.test; recipient-two@example.test"
};
const inquiryRequest = (body) =>
  new Request("https://matrix.kfrey.workers.dev/api/inquiry", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://matrix.kfrey.workers.dev"
    },
    body: JSON.stringify(body)
  });
const validInquiry = {
  name: "Website Visitor",
  email: "visitor@example.test",
  phone: "",
  organization: "Example",
  topic: "Workplace technology",
  message: "This is a local verification message with sufficient detail.",
  website: "",
  startedAt: Date.now() - 3_000
};

const invalidInquiryResponse = await worker.fetch(
  inquiryRequest({ ...validInquiry, email: "invalid" }),
  configuredEnvironment
);
if (invalidInquiryResponse.status !== 422) {
  errors.push(`worker inquiry: invalid email expected 422, got ${invalidInquiryResponse.status}`);
}

const fastInquiryResponse = await worker.fetch(
  inquiryRequest({ ...validInquiry, startedAt: Date.now() }),
  configuredEnvironment
);
if (fastInquiryResponse.status !== 422) {
  errors.push(`worker inquiry: fast submission expected 422, got ${fastInquiryResponse.status}`);
}

let externalFetches = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  externalFetches.push({ url: String(url), options });
  if (String(url).includes("login.microsoftonline.com")) {
    return jsonResponse({ access_token: "test-token" });
  }
  if (String(url).includes("graph.microsoft.com")) {
    return new Response(null, { status: 202 });
  }
  throw new Error(`Unexpected external request: ${url}`);
};
try {
  const honeypotResponse = await worker.fetch(
    inquiryRequest({ ...validInquiry, website: "filled" }),
    configuredEnvironment
  );
  if (honeypotResponse.status !== 202 || externalFetches.length !== 0) {
    errors.push("worker inquiry: honeypot submission must be accepted without Graph delivery");
  }

  const deliveryResponse = await worker.fetch(
    inquiryRequest({ ...validInquiry, startedAt: Date.now() - 3_000 }),
    configuredEnvironment
  );
  if (deliveryResponse.status !== 201 || externalFetches.length !== 2) {
    errors.push("worker inquiry: valid submission must complete token and Graph delivery requests");
  } else {
    const [tokenRequest, mailRequest] = externalFetches;
    if (!tokenRequest.url.includes("/oauth2/v2.0/token")) {
      errors.push("worker inquiry: unexpected Microsoft token endpoint");
    }
    if (!mailRequest.url.includes("graph.microsoft.com/v1.0/users/") || !mailRequest.url.endsWith("/sendMail")) {
      errors.push("worker inquiry: unexpected Microsoft Graph mail endpoint");
    }
    const graphPayload = JSON.parse(String(mailRequest.options.body));
    const addresses = graphPayload.message.toRecipients.map((item) => item.emailAddress.address);
    if (addresses.length !== 2) errors.push("worker inquiry: configured recipients were not preserved");
    if (graphPayload.message.replyTo?.[0]?.emailAddress?.address !== validInquiry.email) {
      errors.push("worker inquiry: visitor Reply-To was not preserved");
    }
    if (graphPayload.saveToSentItems !== true) {
      errors.push("worker inquiry: Sent Items behavior was not preserved");
    }
  }
} finally {
  globalThis.fetch = originalFetch;
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`Verified ${files.length} Matrix pages and their local references.`);
