import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL || import.meta.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
export const adminEmail =
  (import.meta.env.VITE_ADMIN_EMAIL || import.meta.env.NEXT_PUBLIC_ADMIN_EMAIL || "").trim().toLowerCase();
const configuredSiteUrl =
  import.meta.env.VITE_SITE_URL ||
  import.meta.env.NEXT_PUBLIC_SITE_URL ||
  import.meta.env.VITE_APP_URL ||
  import.meta.env.NEXT_PUBLIC_APP_URL ||
  "";

export const siteUrl = (configuredSiteUrl || "https://log.dayza.site").replace(/\/+$/, "");

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
