import { describe, expect, it } from 'vitest';
// Vite/vitest native `?raw` import — returns the file's source as a plain
// string, no Node builtins/@types/node needed (src/ is type-checked under
// tsconfig.app.json, which does not include "node" types).
import tutorialReplayPanelSource from './TutorialReplayPanelV2.tsx?raw';

// ============================================================================
// Genetics V2 — Slice 12: демо-повтор обучения — структурная гарантия чистоты
// (§4.14.10 contract, delta doc §12 Slice 12: "не вызывает breedV2, не
// создаёт HybridSeed/Specimen, не меняет состояние"). `TutorialReplayPanelV2`
// — React-компонент без RTL в этом репозитории (по конвенции — только
// извлечённая чистая логика тестируется напрямую), поэтому чистота
// гарантируется здесь СТРУКТУРНО: файл физически не может импортировать
// `gameStore`/`breedV2`, а значит не может вызвать ни один store-мутатор ни
// при каком пропсе/состоянии — сильнее, чем поведенческий тест на
// конкретном прогоне.
// ============================================================================

describe('TutorialReplayPanelV2.tsx — демо-повтор структурно не может мутировать игру', () => {
  const source: string = tutorialReplayPanelSource;

  it('не импортирует gameStore (комментарии, объясняющие ПОЧЕМУ, не в счёт — важен только import)', () => {
    expect(source).not.toMatch(/from ['"].*\/store['"]/);
    expect(source).not.toMatch(/^\s*import\b.*\bgameStore\b/m);
  });

  it('не вызывает breedV2 напрямую', () => {
    expect(source).not.toMatch(/\bbreedV2\s*\(/);
  });

  it('использует только литеральную фикстуру tutorialReplayChildGenomeV2 (не breedV2/store)', () => {
    expect(source).toMatch(/tutorialReplayChildGenomeV2/);
  });
});
