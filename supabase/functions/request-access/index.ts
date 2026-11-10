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

const FORMSUBMIT = "https://formsubmit.co/ajax/" + OWNER_EMAIL;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  let body: { email?: string; name?: string } = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

  const email = normalizeEmail(body.email);
  const name = String(body.name || "").trim().slice(0, 120);
  if (!isEmail(email)) return json({ ok: false, error: "Enter a valid email" }, 400);

  const sb = admin();

  const { count: recent, error: countErr } = await sb
    .from("fb_access_requests")
    .select("id", { count: "exact", head: true })
    .gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());
  if (countErr) return json({ ok: false, error: "Server error" }, 500);
  if ((recent || 0) >= 8) return json({ ok: false, error: "Too many requests. Please try again later." }, 429);

  const { data: existing, error: selErr } = await sb
    .from("fb_access_requests")
    .select("id, email, name, status, token, created_at, decided_at")
    .eq("email", email)
    .maybeSingle();
  if (selErr) return json({ ok: false, error: "Server error" }, 500);

  if (existing?.status === "approved") {
    return json({ ok: true, status: "approved", already: true });
  }

  const now = new Date();
  let token = existing?.token as string | undefined;
  let status = "pending";
  let resend = true;

  if (existing?.status === "pending") {
    const age = now.getTime() - new Date(existing.created_at).getTime();
    resend = age > 24 * 60 * 60 * 1000;
    status = "pending";
    if (!token) token = newToken();
  } else if (existing?.status === "rejected") {
    token = newToken();
    status = "pending";
    const { error: upErr } = await sb.from("fb_access_requests")
      .update({ name: name || existing.name, status: "pending", token, decided_at: null })
      .eq("id", existing.id);
    if (upErr) return json({ ok: false, error: "Server error" }, 500);
  } else {
    token = newToken();
    const { error: insErr } = await sb.from("fb_access_requests")
      .insert({ email, name: name || null, status: "pending", token });
    if (insErr) return json({ ok: false, error: "Server error" }, 500);
  }

  let email_sent = false;
  let email_detail = "skipped";
  if (resend) {
    const approve = `${APP_URL}#decide/approve/${token}`;
    const reject = `${APP_URL}#decide/reject/${token}`;
    const testLabel = /^test\b/i.test(name) || /(?:^|[+._-])test(?:[+._@-]|$)/i.test(email);
    const subject = testLabel
      ? "TEST — Fashion Builder access request (ignore if unexpected)"
      : "Fashion Builder — access request";
    const payload = {
      _subject: subject,
      _template: "box",
      _captcha: "false",
      _replyto: email,
      name: name || "(no name given)",
      email,
      requested_at: israelTime(now),
      message: [
        testLabel ? "THIS IS A TEST REQUEST from Fashion Builder setup." : "A designer requested access to Fashion Builder.",
        "",
        `Name: ${name || "—"}`,
        `Email: ${email}`,
        `Time: ${israelTime(now)}`,
        "",
        "Approve this person:",
        approve,
        "",
        "Reject this person:",
        reject,
      ].join("\n"),
      approve_link: approve,
      reject_link: reject,
    };
    try {
      const fr = await fetch(FORMSUBMIT, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(payload),
      });
      const text = await fr.text();
      email_detail = text.slice(0, 400);
      email_sent = fr.ok;
      try {
        const parsed = JSON.parse(text);
        if (parsed?.success === false) email_sent = false;
        if (parsed?.success === true) email_sent = true;
      } catch { /* keep http ok */ }
    } catch (e) {
      email_detail = String(e);
      email_sent = false;
    }
  } else {
    email_detail = "already pending; notification not re-sent within 24h";
  }

  return json({ ok: true, status, already: Boolean(existing && existing.status === "pending"), email_sent, email_detail: email_sent ? "sent" : email_detail });
});
