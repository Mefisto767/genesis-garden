import { getSupabaseClient } from '../lib/supabaseClient';
import type { ProgressSummary } from './migration';

/** Только чтение (обычный SELECT под RLS), поэтому безопасно вызывать сразу
 * после входа без дополнительных мер — в худшем случае просто не покажет числа. */
export async function fetchCloudProgressSummary(): Promise<ProgressSummary | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const { data: garden, error: gardenError } = await supabase
    .from('gardens')
    .select('id, coins, genetic_dust')
    .single();
  if (gardenError || !garden) return null;

  const [plantsResult, plotsResult] = await Promise.all([
    supabase.from('plants').select('id', { count: 'exact', head: true }).eq('garden_id', garden.id),
    supabase.from('plots').select('id', { count: 'exact', head: true }).eq('garden_id', garden.id).eq('unlocked', true),
  ]);

  return {
    coins: garden.coins,
    geneticDust: garden.genetic_dust,
    plantsCount: plantsResult.count ?? 0,
    unlockedPlots: plotsResult.count ?? 0,
  };
}
