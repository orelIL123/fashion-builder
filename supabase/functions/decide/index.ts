import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const OWNER_EMAIL = "orel895@gmail.com";
const APP_URL = "https://orelil123.github.io/fashion-builder/";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

function admin() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function normalizeEmail(raw: unknown): string {
  return String(raw || "").trim().toLowerCase();
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 200;
}

function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function israelTime(d = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    dateStyle: "full",
    timeStyle: "short",
  });
  return `${fmt.format(d)} (Asia/Jerusalem)`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"'`]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c]!));
}

function page(title: string, heading: string, body: string, ok: boolean): Response {
  const html = `<!doctype html>
<html lang="he">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root{color-scheme:dark}
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#141613;color:#e9ece4;
      font-family:"Familjen Grotesk","Helvetica Neue",Arial,sans-serif;padding:24px}
    .card{max-width:480px;width:100%;background:#1b1e1a;border:1px solid #30352e;border-radius:16px;padding:28px 24px;display:grid;gap:12px}
    h1{margin:0;font-size:26px;letter-spacing:-.02em}
    p{margin:0;color:#9aa294;line-height:1.5}
    .ok{color:#f2c14e;font-weight:700}
    .no{color:#e5625c;font-weight:700}
    a{color:#f2c14e}
    .he{direction:rtl}
  </style>
</head>
<body>
  <div class="card">
    <div style="font-weight:600;color:#f2c14e">Fashion Builder</div>
    <h1 class="${ok ? "ok" : "no"}">${heading}</h1>
    ${body}
  </div>
</body>
</html>`;
  return new Response(html, { status: 200, headers: { ...CORS, "Content-Type": "text/html; charset=utf-8" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  let token = url.searchParams.get("token") || "";
  let action = (url.searchParams.get("action") || "").toLowerCase();

  if (req.method === "POST") {
    try {
      const body = await req.json();
      token = String(body.token || token);
      action = String(body.action || action).toLowerCase();
    } catch { /* keep query */ }
  }

  if (!token || token.length < 32) {
    return page("Invalid link", "This link is not valid", "<p>The approval link is missing or incomplete. Ask the requester to send a new request.</p><p class='he'>הקישור לא תקין או חסר.</p>", false);
  }
  if (action !== "approve" && action !== "reject") {
    return page("Invalid action", "Choose Approve or Reject", "<p>This decision link needs an action.</p>", false);
  }

  const sb = admin();
  const { data: row, error } = await sb.from("fb_access_requests")
    .select("id, email, name, status, token")
    .eq("token", token)
    .maybeSingle();
  if (error) return page("Error", "Could not update this request", `<p>Please try again in a moment.</p>`, false);
  if (!row) return page("Not found", "This link has expired", "<p>The request was not found. The person can submit a new request from the app.</p><p class='he'>הקישור לא נמצא או שפג תוקפו.</p>", false);

  const next = action === "approve" ? "approved" : "rejected";
  if (row.status !== next) {
    const { error: upErr } = await sb.from("fb_access_requests")
      .update({ status: next, decided_at: new Date().toISOString() })
      .eq("id", row.id);
    if (upErr) return page("Error", "Could not save the decision", "<p>Please try the link again.</p>", false);
  }

  const payload = {
    ok: true,
    status: next,
    email: row.email,
    name: row.name || "",
  };
  if (req.method === "POST") return json(payload);

  const who = escapeHtml(row.name ? `${row.name} (${row.email})` : row.email);
  if (next === "approved") {
    return page(
      "Approved",
      "Access approved",
      `<p><b>${who}</b> can now enter Fashion Builder by typing their email on the access screen.</p>
       <p class="he"><b>${who}</b> יכול/ה להיכנס עכשיו — פשוט להקליד את האימייל במסך הגישה.</p>
       <p><a href="${APP_URL}">Open Fashion Builder</a></p>`,
      true,
    );
  }
  return page(
    "Rejected",
    "Request declined",
    `<p><b>${who}</b> will see a short message if they check their status. No further action is needed.</p>
     <p class="he">הבקשה של <b>${who}</b> נדחתה. אם יבדקו סטטוס, יוצג להם מסר קצר.</p>`,
    false,
  );
});
