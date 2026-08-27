import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

// ============================================================================
// Этап 4 — облачный слой ВЫКЛЮЧЕН по умолчанию (feature flag), пока у
// проекта нет реального Supabase-проекта (URL/anon key от владельца).
// Игра продолжает работать полностью локально (GameStore + localStorage,
// см. Этапы 1-2) — это НЕ регрессия, а сознательная защита существующего,
// протестированного игрового цикла от непроверенной вживую интеграции с
// бэкендом, который нельзя было живьём протестировать в этой среде (см.
// docs/IMPLEMENTATION_STATUS.md, Этап 4).
//
// Как включить: см. apps/web/.env.example — VITE_SUPABASE_URL/ANON_KEY.
// ============================================================================

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(
  SUPABASE_URL && SUPABASE_ANON_KEY && !SUPABASE_URL.includes('your-project-ref')
);

/**
 * Явный флаг "включить облако" — отдельно от наличия ключей, чтобы можно
 * было завезти ключи в CI/окружение заранее, не меняя поведение приложения,
 * пока владелец не проверит путь руками (см. docs/DEPLOYMENT.md).
 */
export const isCloudSyncEnabled =
  isSupabaseConfigured && (import.meta.env.VITE_CLOUD_SYNC_ENABLED as string | undefined) === 'true';

let client: SupabaseClient<Database> | null = null;

/** null, если облако не настроено/не включено — вызывающий код обязан это проверять. */
export function getSupabaseClient(): SupabaseClient<Database> | null {
  if (!isSupabaseConfigured) return null;
  if (!client) {
    client = createClient<Database>(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}

/** Генератор идемпотентных request_id — один вызов на одну ПОПЫТКУ действия;
 * при retry (офлайн-очередь) переиспользуется тот же id. */
export function newRequestId(): string {
  return crypto.randomUUID();
}
