const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff"
};

const MAX_BODY_BYTES = 16_384;
const MIN_COMPLETION_MS = 2_500;
const MAX_COMPLETION_MS = 86_400_000;
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/inquiry") {
      if (request.method === "OPTIONS") return new Response(null, { status: 204 });
      if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
      return handleInquiry(request, env);
    }
    return env.ASSETS.fetch(request);
  }
};

async function handleInquiry(request, env) {
  if (!env.WIX_API_KEY || !env.WIX_SITE_ID) {
    console.error("Matrix inquiry endpoint is missing its Wix configuration.");
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

  let fieldKeys;
  try {
    fieldKeys = await resolveInquiryFieldKeys(env);
  } catch (error) {
    console.error("Wix inquiry fields could not be resolved", error);
    return json({ ok: false, error: "The discussion form is temporarily unavailable." }, 503);
  }

  const info = {
    name: splitName(inquiry.name),
    emails: { items: [{ tag: "WORK", email: inquiry.email, primary: true }] },
    company: inquiry.organization || undefined,
    phones: inquiry.phone
      ? { items: [{ tag: "WORK", phone: inquiry.phone, primary: true }] }
      : undefined,
    extendedFields: {
      items: {
        [fieldKeys.topic]: inquiry.topic,
        [fieldKeys.message]: inquiry.message,
        [fieldKeys.source]: "matrixbusiness.biz"
      }
    }
  };

  try {
    const wixResponse = await fetch("https://www.wixapis.com/v4/contacts", {
      method: "POST",
      headers: wixHeaders(env, true),
      body: JSON.stringify({ info, allowDuplicates: true })
    });
    if (!wixResponse.ok) {
      const wixError = await wixResponse.text();
      console.error("Wix contact creation failed", wixResponse.status, wixError.slice(0, 1_000));
      return deliveryError();
    }
    return json({ ok: true }, 201);
  } catch (error) {
    console.error("Wix contact request failed", error);
    return deliveryError();
  }
}

async function resolveInquiryFieldKeys() {
  return {
    topic: "custom.inquiry-topic",
    message: "custom.inquiry-message",
    source: "custom.inquiry-source"
  };
}

function wixHeaders(env, jsonBody = false) {
  return {
    authorization: env.WIX_API_KEY,
    "wix-site-id": env.WIX_SITE_ID,
    ...(jsonBody ? { "content-type": "application/json" } : {})
  };
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

function splitName(fullName) {
  const parts = fullName.split(/\s+/);
  if (parts.length === 1) return { first: parts[0] };
  return { first: parts.slice(0, -1).join(" "), last: parts.at(-1) };
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

