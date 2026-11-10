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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST" && req.method !== "GET") return json({ ok: false, error: "POST or GET" }, 405);

  let email = "";
  if (req.method === "GET") {
    email = normalizeEmail(new URL(req.url).searchParams.get("email"));
  } else {
    try { email = normalizeEmail((await req.json()).email); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
  }
  if (!isEmail(email)) return json({ ok: false, error: "Enter a valid email", status: "unknown" }, 400);

  const sb = admin();
  const { data, error } = await sb.from("fb_access_requests")
    .select("status, name")
    .eq("email", email)
    .maybeSingle();
  if (error) return json({ ok: false, error: "Server error" }, 500);
  if (!data) return json({ ok: true, status: "unknown" });
  return json({ ok: true, status: data.status, name: data.name || "" });
});
