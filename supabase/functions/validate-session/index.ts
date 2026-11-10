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

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getPepper(sb: ReturnType<typeof admin>): Promise<string> {
  const { data, error } = await sb.from("fb_beta_settings").select("value").eq("key", "pepper").maybeSingle();
  if (error || !data?.value) throw new Error("Server not configured");
  return data.value as string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  let body: { email?: string; token?: string } = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

  const email = normalizeEmail(body.email);
  const token = String(body.token || "").trim();
  if (!isEmail(email) || !token || token.length < 32) {
    return json({ ok: true, valid: false, reason: "invalid" });
  }

  const sb = admin();
  let pepper: string;
  try { pepper = await getPepper(sb); } catch { return json({ ok: false, error: "Server not configured" }, 500); }

  const token_hash = await sha256hex(pepper + "\nsession:" + token);
  const { data: sess, error } = await sb
    .from("fb_beta_sessions")
    .select("id, email, code_id")
    .eq("token_hash", token_hash)
    .maybeSingle();
  if (error) return json({ ok: false, error: "Server error" }, 500);
  if (!sess || sess.email !== email) {
    return json({ ok: true, valid: false, reason: "invalid" });
  }

  const { data: code, error: cErr } = await sb
    .from("fb_beta_codes")
    .select("id, status, used_by_email")
    .eq("id", sess.code_id)
    .maybeSingle();
  if (cErr) return json({ ok: false, error: "Server error" }, 500);
  if (!code || code.status === "revoked") {
    return json({ ok: true, valid: false, reason: "revoked" });
  }
  if (code.used_by_email && code.used_by_email !== email) {
    return json({ ok: true, valid: false, reason: "invalid" });
  }
  return json({ ok: true, valid: true, email, status: "ok" });
});
