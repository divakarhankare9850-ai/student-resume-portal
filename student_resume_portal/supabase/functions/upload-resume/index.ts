import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_BYTES = 10 * 1024 * 1024;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const form = await req.formData();
    const rawPrn = form.get("prn");
    const resume = form.get("resume");
    if (typeof rawPrn !== "string" || !(resume instanceof File)) {
      return json({ error: "PRN and PDF resume are required." }, 400);
    }

    const prn = rawPrn.trim().toUpperCase();
    if (!prn || prn.length > 80) return json({ error: "Enter a valid PRN." }, 400);
    if (resume.size <= 0 || resume.size > MAX_BYTES) {
      return json({ error: "PDF must be larger than 0 bytes and no more than 10 MB." }, 400);
    }
    if (resume.type !== "application/pdf" && !resume.name.toLowerCase().endsWith(".pdf")) {
      return json({ error: "Only PDF files are accepted." }, 400);
    }

    const bytes = new Uint8Array(await resume.arrayBuffer());
    const signature = new TextDecoder().decode(bytes.slice(0, 5));
    if (signature !== "%PDF-") return json({ error: "The uploaded file is not a valid PDF." }, 400);

    const { data: approved, error: prnError } = await supabase
      .from("approved_prns").select("prn").eq("prn", prn).eq("active", true).maybeSingle();
    if (prnError) throw prnError;
    if (!approved) return json({ error: "PRN not found in the approved student list." }, 403);

    // Validate fully before touching the current resume object.
    const storagePath = `${prn}/resume.pdf`;
    const safeName = resume.name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 180) || "resume.pdf";

    // One stable object path per PRN. `upsert: true` replaces that object's contents.
    const { error: uploadError } = await supabase.storage
      .from("student-resumes")
      .upload(storagePath, bytes, {
        contentType: "application/pdf",
        upsert: true,
        cacheControl: "0",
      });
    if (uploadError) throw uploadError;

    const { error: dbError } = await supabase.from("resumes").upsert({
      prn,
      storage_path: storagePath,
      original_name: safeName,
      size_bytes: resume.size,
      uploaded_at: new Date().toISOString(),
    }, { onConflict: "prn" });

    if (dbError) {
      // Storage object may already have been replaced if the metadata write fails.
      // Alert operators in logs; do not delete the new file or risk losing the current resume.
      console.error("Resume object uploaded but metadata upsert failed", { prn, message: dbError.message });
      return json({ error: "The file was received but metadata could not be updated. Please contact the placement cell before retrying." }, 500);
    }

    return json({ success: true, prn });
  } catch (error) {
    console.error("upload-resume error", error);
    return json({ error: error instanceof Error ? error.message : "Upload failed." }, 500);
  }
});
