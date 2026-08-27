// ============================================================================
// Этап 8 — track(): единственная точка входа для отправки аналитики из UI.
// Не идёт нигде, если облако выключено — локальная офлайн-игра пишет
// аналитику в analytics_events (облачная таблица), поэтому без облака
// писать физически некуда, и мы не притворяемся, что что-то отправили.
// ============================================================================

import { isCloudSyncEnabled } from '../lib/supabaseClient';
import { gameApi } from '../sync/gameApi';
import type { AnalyticsEventName } from './events';

export function track(event: AnalyticsEventName, payload: Record<string, unknown> = {}): void {
  if (!isCloudSyncEnabled) return;
  // Fire-and-forget: аналитика не должна блокировать UI и не должна ронять
  // игру при сетевой ошибке — ошибку тихо проглатываем (см. trackEvent).
  void gameApi.trackEvent(event, payload).catch(() => {});
}
