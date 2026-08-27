// ============================================================================
// Этап 8 — session_started + честная клиентская аппроксимация day_1_return/
// day_7_return. Настоящая когортная ретеншн-аналитика обычно считается на
// сервере по датам создания аккаунта — здесь для MVP-беты (нет сервера
// расписаний/крон-джобов, см. docs/IMPLEMENTATION_STATUS.md) считаем на
// клиенте: помним первый визит в localStorage конкретного браузера и при
// каждом следующем визите проверяем, попадает ли разница в сутки-с-первого-
// раза (day_1) или в 7-е сутки (day_7). Это НЕ идеальная метрика (не ловит
// возврат с другого устройства/браузера), но честно посчитанная и рабочая
// для одного игрока на одном устройстве — с пометкой о своей неточности.
// ============================================================================

import { track } from './track';

const FIRST_SEEN_KEY = 'genesis-garden-first-seen-v1';
const DAY_MS = 24 * 60 * 60 * 1000;

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // приватный режим/квота — не роняем игру
  }
}

/** Вызывать один раз при старте приложения. */
export function recordSessionStart(now: number = Date.now()): void {
  track('session_started');

  const raw = safeGet(FIRST_SEEN_KEY);
  if (!raw) {
    safeSet(FIRST_SEEN_KEY, String(now));
    return; // первый визит этого браузера — рано мерить возврат
  }

  const firstSeen = Number(raw);
  if (!Number.isFinite(firstSeen)) {
    safeSet(FIRST_SEEN_KEY, String(now));
    return;
  }

  const daysSince = Math.floor((now - firstSeen) / DAY_MS);
  if (daysSince === 1) track('day_1_return');
  if (daysSince === 7) track('day_7_return');
}
