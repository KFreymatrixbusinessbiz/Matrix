const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff"
};

const MAX_BODY_BYTES = 16_384;
const MIN_COMPLETION_MS = 2_500;
const MAX_COMPLETION_MS = 86_400_000;

const PRODUCTION_HOST = "matrixbusiness.biz";
const WWW_HOST = "www.matrixbusiness.biz";
const PRIVATE_HOST_SUFFIX = ".workers.dev";

const LEGACY_REDIRECTS = new Map([
  ["/s-projects-side-by-side", "/copiers-multifunction"],
  ["/services-7", "/technology"],
  ["/government-solutions", "/practice-areas"],
  ["/copy-of-government-solutions", "/how-we-work"],
  ["/about-1", "/about"],
  ["/blank-4", "/contact"],
  ["/blank-3", "https://inpower.biz/"],
  ["/new-inpower", "https://inpower.biz/"]
]);

const RETIRED_PATHS = new Set([
  "/capabilities-statement",
  "/about-5",
  "/cart-page",
  "/checkout",
  "/product-page",
  "/category"
]);

const PUBLIC_PAGE_PATHS = new Set([
  "/about",
  "/acquisition-support",
  "/brother-business",
  "/brother-titan",
  "/contact",
  "/copiers-multifunction",
  "/epson-colorworks",
  "/epson-large-format",
  "/how-we-work",
  "/label-printing",
  "/modern-workplace",
  "/my-account",
  "/operating-scenarios",
  "/papercut-workflow",
  "/perspectives",
  "/practice-areas",
  "/printers-scanners",
  "/technology",
  "/visual-communications"
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const hostname = url.hostname.toLowerCase();

    if (hostname === WWW_HOST) {
      const destination = new URL(url.pathname + url.search, `https://${PRODUCTION_HOST}`);
      return Response.redirect(destination, 301);
    }

    const redirect = canonicalRedirect(url);
    if (redirect) return redirect;

    if (RETIRED_PATHS.has(url.pathname)) {
      return withIndexingPolicy(
        new Response("This legacy page is no longer available.", {
          status: 410,
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "public, max-age=86400",
            "x-content-type-options": "nosniff"
          }
        }),
        hostname
      );
    }

    if (url.pathname === "/api/inquiry") {
      if (request.method === "OPTIONS") {
        return withIndexingPolicy(new Response(null, { status: 204 }), hostname);
      }
      if (request.method !== "POST") {
        return withIndexingPolicy(
          json({ ok: false, error: "Method not allowed." }, 405),
          hostname
        );
      }
      return withIndexingPolicy(await handleInquiry(request, env), hostname);
    }

    return withIndexingPolicy(await env.ASSETS.fetch(request), hostname);
  }
};

function canonicalRedirect(url) {
  const legacyDestination = LEGACY_REDIRECTS.get(url.pathname);
  if (legacyDestination) {
    return permanentRedirect(url, legacyDestination);
  }

  if (url.pathname === "/index.html") {
    return permanentRedirect(url, "/");
  }

  if (url.pathname.endsWith(".html")) {
    const extensionlessPath = url.pathname.slice(0, -5);
    if (PUBLIC_PAGE_PATHS.has(extensionlessPath)) {
      return permanentRedirect(url, extensionlessPath);
    }
  }

  return null;
}

function permanentRedirect(source, target) {
  const destination = new URL(target, source.origin);
  destination.search = source.search;
  return Response.redirect(destination, 301);
}

function withIndexingPolicy(response, hostname) {
  if (!hostname.endsWith(PRIVATE_HOST_SUFFIX)) return response;

  const headers = new Headers(response.headers);
  headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function handleInquiry(request, env) {
  const missing = requiredConfiguration(env);
  if (missing.length) {
    console.error("Matrix inquiry endpoint is missing configuration:", missing.join(", "));
    return json({ ok: false, error: "The discussion form is temporarily unavailable." }, 503);
  }

  const contentType = request.headers.get("content-type") || "";
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (!contentType.includes("application/json") || contentLength > MAX_BODY_BYTES) {
    return json({ ok: false, error: "Invalid submission." }, 400);
  }
  if (!isSameSiteRequest(request)) {
    return json({ ok: false, error: "Invalid submission source." }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid submission." }, 400);
  }

  if (JSON.stringify(body).length > MAX_BODY_BYTES) {
    return json({ ok: false, error: "Submission is too large." }, 413);
  }

  const inquiry = normalizeInquiry(body);
  const validationError = validateInquiry(inquiry);
  if (validationError) return json({ ok: false, error: validationError }, 422);
  if (inquiry.website) return json({ ok: true }, 202);

  const completionMs = Date.now() - inquiry.startedAt;
  if (completionMs < MIN_COMPLETION_MS || completionMs > MAX_COMPLETION_MS) {
    return json({ ok: false, error: "Please reload the page and try again." }, 422);
  }

  try {
    await sendMicrosoftNotification(inquiry, env);
  } catch (error) {
    console.error("Microsoft inquiry notification failed", error);
    return deliveryError();
  }

  return json({ ok: true }, 201);
}

function requiredConfiguration(env) {
  return [
    "MICROSOFT_CLIENT_ID",
    "MICROSOFT_CLIENT_SECRET",
    "MICROSOFT_TENANT_ID",
    "MICROSOFT_SENDER_EMAIL",
    "INQUIRY_RECIPIENTS"
  ].filter((name) => !env[name]);
}

async function sendMicrosoftNotification(inquiry, env) {
  const tokenResponse = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(env.MICROSOFT_TENANT_ID)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.MICROSOFT_CLIENT_ID,
        client_secret: env.MICROSOFT_CLIENT_SECRET,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials"
      })
    }
  );

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text();
    throw new Error(`Microsoft token request failed ${tokenResponse.status}: ${error.slice(0, 1_000)}`);
  }

  const tokenData = await tokenResponse.json();
  const recipients = parseRecipients(env.INQUIRY_RECIPIENTS);
  if (!recipients.length) throw new Error("No valid inquiry recipients are configured.");

  const message = {
    subject: `New Matrix Website Inquiry: ${inquiry.topic}`,
    body: {
      contentType: "HTML",
      content: buildInquiryEmail(inquiry)
    },
    toRecipients: recipients.map((address) => ({ emailAddress: { address } })),
    replyTo: [{ emailAddress: { address: inquiry.email, name: inquiry.name } }]
  };

  const mailResponse = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env.MICROSOFT_SENDER_EMAIL)}/sendMail`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokenData.access_token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ message, saveToSentItems: true })
    }
  );

  if (!mailResponse.ok) {
    const error = await mailResponse.text();
    throw new Error(`Microsoft sendMail failed ${mailResponse.status}: ${error.slice(0, 1_000)}`);
  }
}

function buildInquiryEmail(inquiry) {
  const submittedAt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    dateStyle: "full",
    timeStyle: "long"
  }).format(new Date());

  const row = (label, value) => `
    <tr>
      <th style="padding:10px 14px;text-align:left;vertical-align:top;border-bottom:1px solid #ddd;background:#f5f3ed;width:160px;">${escapeHtml(label)}</th>
      <td style="padding:10px 14px;border-bottom:1px solid #ddd;">${escapeHtml(value || "Not provided")}</td>
    </tr>`;

  return `<!doctype html>
  <html>
    <body style="margin:0;padding:24px;background:#f3f1eb;color:#151817;font-family:Arial,sans-serif;">
      <div style="max-width:720px;margin:0 auto;background:#fff;border:1px solid #d8d4ca;">
        <div style="padding:24px 28px;background:#17272c;color:#fff;">
          <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#d6a245;">Matrix Business Systems</div>
          <h1 style="margin:8px 0 0;font-size:26px;">New Website Inquiry</h1>
        </div>
        <table role="presentation" style="width:100%;border-collapse:collapse;font-size:15px;line-height:1.5;">
          ${row("Name", inquiry.name)}
          ${row("Email", inquiry.email)}
          ${row("Phone", inquiry.phone)}
          ${row("Organization", inquiry.organization)}
          ${row("Discussion area", inquiry.topic)}
          ${row("Source", "matrixbusiness.biz")}
          ${row("Submitted", `${submittedAt} (Central Time)`)}
        </table>
        <div style="padding:24px 28px;">
          <h2 style="margin:0 0 10px;font-size:18px;">What they are trying to accomplish</h2>
          <div style="white-space:pre-wrap;line-height:1.6;">${escapeHtml(inquiry.message)}</div>
          <p style="margin:24px 0 0;font-size:13px;color:#5f6668;">Reply to this email to respond directly to ${escapeHtml(inquiry.name)}.</p>
        </div>
      </div>
    </body>
  </html>`;
}

function parseRecipients(value) {
  return String(value || "")
    .split(/[;,]/)
    .map((address) => address.trim())
    .filter((address) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address));
}

function normalizeInquiry(body) {
  return {
    name: clean(body.name, 120),
    email: clean(body.email, 254).toLowerCase(),
    phone: clean(body.phone, 40),
    organization: clean(body.organization, 160),
    topic: clean(body.topic, 80),
    message: clean(body.message, 2_500),
    website: clean(body.website, 200),
    startedAt: Number(body.startedAt || 0)
  };
}

function validateInquiry(inquiry) {
  if (!inquiry.name || inquiry.name.length < 2) return "Please enter your name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inquiry.email)) {
    return "Please enter a valid work email address.";
  }
  if (!inquiry.topic) return "Please select a discussion area.";
  if (!inquiry.message || inquiry.message.length < 20) {
    return "Please tell us a little more about what you are trying to accomplish.";
  }
  return "";
}

function clean(value, limit) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isSameSiteRequest(request) {
  const requestHost = new URL(request.url).host;
  for (const header of ["origin", "referer"]) {
    const value = request.headers.get(header);
    if (!value) continue;
    try {
      return new URL(value).host === requestHost;
    } catch {
      return false;
    }
  }
  return false;
}

function deliveryError() {
  return json(
    { ok: false, error: "We could not send your message. Please email contact@matrixbusiness.biz." },
    502
  );
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}
