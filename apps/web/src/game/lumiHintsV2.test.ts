import { describe, expect, it } from 'vitest';
import { LUMI_HINT_TEXT_V2, nextLumiHintV2, type LumiHintKeyV2 } from './lumiHintsV2';

// ============================================================================
// Genetics V2 — Slice 12: минимальная система подсказок Люми. Юнит-покрытие
// §4.14.4 GENETICS_GATE1_IMPLEMENTATION_CONTRACT.md — "максимум одна активная
// подсказка, каждая — не более одного раза". UI-таймер/подписка на события
// (`LumiHintBubble.tsx`) здесь не тестируется (компонент не покрыт vitest в
// этом репозитории), только чистая функция выбора.
// ============================================================================

const ALL_KEYS = Object.keys(LUMI_HINT_TEXT_V2) as LumiHintKeyV2[];

describe('nextLumiHintV2', () => {
  it('пустой список кандидатов — null', () => {
    expect(nextLumiHintV2([], [])).toBeNull();
  });

  it('первый кандидат, которого нет в alreadyShown — возвращается', () => {
    expect(nextLumiHintV2(['first_plant_ready', 'hybrid_unlocked'], [])).toBe('first_plant_ready');
  });

  it('уже показанные ключи пропускаются, возвращается следующий неотображённый', () => {
    expect(nextLumiHintV2(['first_plant_ready', 'hybrid_unlocked'], ['first_plant_ready'])).toBe('hybrid_unlocked');
  });

  it('все кандидаты уже показаны — null (не циклится обратно)', () => {
    expect(nextLumiHintV2(['first_plant_ready'], ['first_plant_ready'])).toBeNull();
  });

  it('порядок kандидатов определяет приоритет — не сортирует по каталогу', () => {
    expect(nextLumiHintV2(['hybrid_unlocked', 'first_plant_ready'], [])).toBe('hybrid_unlocked');
  });

  it('каждый ключ каталога §7.3 имеет непустой русский текст', () => {
    for (const key of ALL_KEYS) {
      expect(typeof LUMI_HINT_TEXT_V2[key]).toBe('string');
      expect(LUMI_HINT_TEXT_V2[key].length).toBeGreaterThan(0);
    }
  });
});
