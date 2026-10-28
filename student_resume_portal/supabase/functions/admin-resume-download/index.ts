import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Sign in as an administrator first." }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const publicKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const adminClient = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const userClient = createClient(url, publicKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: "Invalid session." }, 401);

    const { data: adminRow, error: adminError } = await adminClient
      .from("admin_users").select("user_id").eq("user_id", userData.user.id).maybeSingle();
    if (adminError || !adminRow) return json({ error: "Administrator access is required." }, 403);

    const body = await req.json();
    const prn = typeof body?.prn === "string" ? body.prn.trim().toUpperCase() : "";
    if (!prn) return json({ error: "PRN is required." }, 400);

    const { data: row, error: rowError } = await adminClient
      .from("resumes").select("storage_path").eq("prn", prn).maybeSingle();
    if (rowError) throw rowError;
    if (!row) return json({ error: "Resume not found." }, 404);

    const { data: signed, error: signedError } = await adminClient.storage
      .from("student-resumes").createSignedUrl(row.storage_path, 60);
    if (signedError) throw signedError;
    return json({ url: signed.signedUrl });
  } catch (error) {
    console.error("admin-resume-download error", error);
    return json({ error: error instanceof Error ? error.message : "Could not create download link." }, 500);
  }
});
