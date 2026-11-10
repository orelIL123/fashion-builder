import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

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

function normalizeCode(raw: unknown): string {
  const compact = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.startsWith("FB") && compact.length === 10) {
    return `FB-${compact.slice(2, 6)}-${compact.slice(6, 10)}`;
  }
  return String(raw || "").toUpperCase().replace(/\s+/g, "").trim();
}

function isCodeFormat(c: string): boolean {
  return /^FB-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c);
}

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getPepper(sb: ReturnType<typeof admin>): Promise<string> {
  const { data, error } = await sb.from("fb_beta_settings").select("value").eq("key", "pepper").maybeSingle();
  if (error || !data?.value) throw new Error("Server not configured");
  return data.value as string;
}

function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function issueSession(sb: ReturnType<typeof admin>, pepper: string, codeId: string, email: string): Promise<string> {
  const token = newToken();
  const token_hash = await sha256hex(pepper + "\nsession:" + token);
  const { error } = await sb.from("fb_beta_sessions").insert({ token_hash, code_id: codeId, email });
  if (error) throw new Error("Server error");
  return token;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  let body: { email?: string; code?: string } = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

  const email = normalizeEmail(body.email);
  const code = normalizeCode(body.code);
  if (!isEmail(email)) return json({ ok: false, error: "Enter a valid email / הזן אימייל תקין" }, 400);
  if (!isCodeFormat(code)) return json({ ok: false, error: "Enter a valid access code / הזן קוד גישה תקין" }, 400);

  const sb = admin();
  let pepper: string;
  try { pepper = await getPepper(sb); } catch { return json({ ok: false, error: "Server not configured" }, 500); }

  const code_hash = await sha256hex(pepper + "\ncode:" + code);

  const { data: row, error: selErr } = await sb
    .from("fb_beta_codes")
    .select("id, status, used_by_email")
    .eq("code_hash", code_hash)
    .maybeSingle();
  if (selErr) return json({ ok: false, error: "Server error" }, 500);

  if (!row) {
    return json({ ok: false, error: "Invalid code / קוד לא תקין" }, 400);
  }
  if (row.status === "revoked") {
    return json({ ok: false, error: "This code was revoked / הקוד נחסם", code: "revoked" }, 403);
  }
  if (row.status === "used") {
    if (row.used_by_email && row.used_by_email === email) {
      try {
        const token = await issueSession(sb, pepper, row.id, email);
        return json({ ok: true, status: "ok", email, token, returning: true });
      } catch {
        return json({ ok: false, error: "Server error" }, 500);
      }
    }
    return json({ ok: false, error: "This code has already been used / הקוד כבר שומש", code: "used" }, 409);
  }

  const now = new Date().toISOString();
  const { data: claimed, error: upErr } = await sb
    .from("fb_beta_codes")
    .update({ status: "used", used_by_email: email, used_at: now, updated_at: now })
    .eq("id", row.id)
    .eq("status", "active")
    .select("id")
    .maybeSingle();
  if (upErr) return json({ ok: false, error: "Server error" }, 500);
  if (!claimed) {
    // Lost a race — re-read and apply the same used-code rules.
    const { data: again } = await sb
      .from("fb_beta_codes")
      .select("id, status, used_by_email")
      .eq("id", row.id)
      .maybeSingle();
    if (again?.status === "used" && again.used_by_email === email) {
      try {
        const token = await issueSession(sb, pepper, again.id, email);
        return json({ ok: true, status: "ok", email, token, returning: true });
      } catch {
        return json({ ok: false, error: "Server error" }, 500);
      }
    }
    return json({ ok: false, error: "This code has already been used / הקוד כבר שומש", code: "used" }, 409);
  }

  try {
    const token = await issueSession(sb, pepper, claimed.id, email);
    return json({ ok: true, status: "ok", email, token, returning: false });
  } catch {
    return json({ ok: false, error: "Server error" }, 500);
  }
});
