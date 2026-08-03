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
      if (request.method !== "POST") {
        return json({ ok: false, error: "Method not allowed." }, 405);
      }
      return handleInquiry(request, env);
    }

    return env.ASSETS.fetch(request);
  }
};

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

  const wixResult = await createWixContact(inquiry, env);

  try {
    await sendMicrosoftNotification(inquiry, env);
  } catch (error) {
    console.error("Microsoft inquiry notification failed", error);
    return deliveryError();
  }

  if (!wixResult.ok) {
    console.error("The inquiry email was sent, but the Wix contact was not recorded.");
  }

  return json({ ok: true, contactRecorded: wixResult.ok }, 201);
}

function requiredConfiguration(env) {
  return [
    "WIX_API_KEY",
    "WIX_SITE_ID",
    "MICROSOFT_CLIENT_ID",
    "MICROSOFT_CLIENT_SECRET",
    "MICROSOFT_TENANT_ID",
    "MICROSOFT_SENDER_EMAIL",
    "INQUIRY_RECIPIENTS"
  ].filter((name) => !env[name]);
}

async function createWixContact(inquiry, env) {
  const info = {
    name: splitName(inquiry.name),
    emails: { items: [{ tag: "WORK", email: inquiry.email, primary: true }] },
    company: inquiry.organization || undefined,
    phones: inquiry.phone
      ? { items: [{ tag: "WORK", phone: inquiry.phone, primary: true }] }
      : undefined,
    extendedFields: {
      items: {
        "custom.inquiry-topic": inquiry.topic,
        "custom.inquiry-message": inquiry.message,
        "custom.inquiry-source": "matrixbusiness.biz"
      }
    }
  };

  try {
    const response = await fetch("https://www.wixapis.com/contacts/v4/contacts", {
      method: "POST",
      headers: {
        authorization: env.WIX_API_KEY,
        "wix-site-id": env.WIX_SITE_ID,
        "content-type": "application/json"
      },
      body: JSON.stringify({ info, allowDuplicates: true })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("Wix contact creation failed", response.status, error.slice(0, 1_000));
      return { ok: false };
    }

    return { ok: true };
  } catch (error) {
    console.error("Wix contact request failed", error);
    return { ok: false };
  }
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

function splitName(fullName) {
  const parts = fullName.split(/\s+/);
  if (parts.length === 1) return { first: parts[0] };
  return { first: parts.slice(0, -1).join(" "), last: parts.at(-1) };
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
