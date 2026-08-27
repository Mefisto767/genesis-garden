// ============================================================================
// Этап 9 — состояние "видел ли онбординг" вынесено из UI-компонента в чистый
// модуль (тот же принцип, что и analytics/retention.ts) — так это можно
// протестировать без рендеринга React-дерева.
// ============================================================================

const SEEN_KEY = 'genesis-garden-onboarding-seen-v1';

export function hasSeenOnboarding(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) !== null;
  } catch {
    return true; // приватный режим/недоступен localStorage — не блокируем игру повторным показом
  }
}

export function markOnboardingSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // не критично — просто может показаться ещё раз при следующем визите
  }
}
