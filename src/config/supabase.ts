import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from './env';

// Service-role client: bypasses RLS, used for server-side operations only.
// NEVER expose this to the client.
export const supabase: SupabaseClient = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// Anon client: subject to RLS policies, safe for delegated operations.
export const supabaseAnon: SupabaseClient = createClient(
  config.supabase.url,
  config.supabase.anonKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);
