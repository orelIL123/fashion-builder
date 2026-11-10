import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const ALPH = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

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

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function getPepper(sb: ReturnType<typeof admin>): Promise<string> {
  const { data, error } = await sb.from("fb_beta_settings").select("value").eq("key", "pepper").maybeSingle();
  if (error || !data?.value) throw new Error("Server not configured");
  return data.value as string;
}

async function assertAdmin(req: Request, body: Record<string, unknown>, sb: ReturnType<typeof admin>, pepper: string): Promise<boolean> {
  const key = String(req.headers.get("x-admin-key") || body.admin_key || "").trim();
  if (!key) return false;
  const hash = await sha256hex(pepper + "\nadmin:" + key);
  const { data, error } = await sb.from("fb_beta_settings").select("value").eq("key", "admin_key_hash").maybeSingle();
  if (error || !data?.value) return false;
  return timingSafeEqual(hash, data.value as string);
}

function newCode(): string {
  const part = () => {
    const out = [];
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    for (let i = 0; i < 4; i++) out.push(ALPH[bytes[i] % ALPH.length]);
    return out.join("");
  };
  return `FB-${part()}-${part()}`;
}

function hintOf(code: string): string {
  return code.slice(0, 7) + "-••••";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

  const sb = admin();
  let pepper: string;
  try { pepper = await getPepper(sb); } catch { return json({ ok: false, error: "Server not configured" }, 500); }

  if (!(await assertAdmin(req, body, sb, pepper))) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  const action = String(body.action || "list").toLowerCase();

  if (action === "list" || action === "check") {
    const { data, error } = await sb
      .from("fb_beta_codes")
      .select("id, code_hint, status, used_by_email, used_at, created_at, note")
      .order("created_at", { ascending: true });
    if (error) return json({ ok: false, error: "Server error" }, 500);
    return json({ ok: true, codes: data || [] });
  }

  if (action === "generate") {
    const note = String(body.note || "").trim().slice(0, 200);
    let code = "";
    let code_hash = "";
    for (let i = 0; i < 8; i++) {
      code = newCode();
      code_hash = await sha256hex(pepper + "\ncode:" + code);
      const { data: exists } = await sb.from("fb_beta_codes").select("id").eq("code_hash", code_hash).maybeSingle();
      if (!exists) break;
      code = "";
    }
    if (!code) return json({ ok: false, error: "Could not generate a unique code" }, 500);
    const hint = hintOf(code);
    const { data, error } = await sb
      .from("fb_beta_codes")
      .insert({ code_hash, code_hint: hint, status: "active", note: note || null })
      .select("id, code_hint, status, used_by_email, used_at, created_at, note")
      .single();
    if (error || !data) return json({ ok: false, error: "Server error" }, 500);
    return json({ ok: true, code, item: data });
  }

  if (action === "revoke" || action === "restore" || action === "delete") {
    const id = String(body.id || "").trim();
    if (!id) return json({ ok: false, error: "Missing id" }, 400);
    const { data: row, error: selErr } = await sb
      .from("fb_beta_codes")
      .select("id, status, used_by_email, note")
      .eq("id", id)
      .maybeSingle();
    if (selErr) return json({ ok: false, error: "Server error" }, 500);
    if (!row) return json({ ok: false, error: "Code not found" }, 404);

    if (action === "revoke") {
      const now = new Date().toISOString();
      const { error } = await sb.from("fb_beta_codes").update({ status: "revoked", updated_at: now }).eq("id", id);
      if (error) return json({ ok: false, error: "Server error" }, 500);
      return json({ ok: true, id, status: "revoked" });
    }

    if (action === "restore") {
      const now = new Date().toISOString();
      const next = row.used_by_email ? "used" : "active";
      const { error } = await sb.from("fb_beta_codes").update({ status: next, updated_at: now }).eq("id", id);
      if (error) return json({ ok: false, error: "Server error" }, 500);
      return json({ ok: true, id, status: next });
    }

    // delete: only TEST notes, so production invite codes cannot be wiped from the admin UI by accident.
    const note = String(row.note || "");
    if (!/^TEST\b/i.test(note)) {
      return json({ ok: false, error: "Only TEST codes can be deleted. Use Revoke to block a tester." }, 400);
    }
    const { error } = await sb.from("fb_beta_codes").delete().eq("id", id);
    if (error) return json({ ok: false, error: "Server error" }, 500);
    return json({ ok: true, deleted: id });
  }

  return json({ ok: false, error: "Unknown action" }, 400);
});
