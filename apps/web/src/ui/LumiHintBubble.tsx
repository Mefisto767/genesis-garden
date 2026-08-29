import { useEffect, useMemo, useState } from 'react';
import { gameStore } from '../game/store';
import { useGameState } from '../game/useGameState';
import { overhaulEvents } from '../overhaul/events';
import { LUMI_HINT_TEXT_V2, nextLumiHintV2, type LumiHintKeyV2 } from '../game/lumiHintsV2';
import { secondTutorialLessonAvailable } from '../game/tutorialV2';

/**
 * Genetics V2 — Slice 12 (onboarding spec §7): минимальная система
 * контекстных подсказок Люми. Не полноценная диалоговая система — максимум
 * одна активная подсказка (`visibleKey`), одна короткая фраза, не модальна
 * (не блокирует ни игру, ни другие панели — рендерится как небольшой
 * пузырь в углу, поверх Estate/Laboratory, без `sheet-backdrop`). Каждая
 * событийная подсказка помечается показанной (`gameStore.markLumiHintShownV2`)
 * В МОМЕНТ показа, не в момент закрытия — гарантирует «не более одного
 * раза» независимо от того, закрыл ли игрок пузырь явно или просто
 * продолжил играть (onboarding spec §17 — подсказки не настаивают).
 *
 * Существует только в Overhaul+V2 — рендерится условно из `OverhaulApp.tsx`
 * под `GENETICS_V2_ENABLED`, сам компонент не проверяет флаг (тот же
 * принцип, что `LabPanelV2`/`HybridCardPanel`).
 */
export function LumiHintBubble() {
  const state = useGameState();
  const [interspeciesSelected, setInterspeciesSelected] = useState(false);
  const [visibleKey, setVisibleKey] = useState<LumiHintKeyV2 | null>(null);

  useEffect(() => overhaulEvents.on('firstInterspeciesPairSelected', () => setInterspeciesSelected(true)), []);

  // Порядок совпадает с onboarding spec §7.3 (момент появления в игре) —
  // не влияет на выбор (`nextLumiHintV2` берёт первый ещё не показанный),
  // но облегчает чтение кода в том же порядке, что таблица спеки.
  const candidates = useMemo<LumiHintKeyV2[]>(() => {
    const list: LumiHintKeyV2[] = [];
    const hasReadyLegacyPlot = state.plots.some((p) => !!p.seedId && gameStore.plotStatus(p)?.ready);
    const v2CandidateCount = state.specimens.filter((s) => !!s.genomeV2).length;

    if (hasReadyLegacyPlot && state.pollen === 0 && !state.firstBreedFreeClaimed) {
      list.push('first_plant_ready');
    }
    if (state.pollen > 0 && !state.firstBreedFreeClaimed) {
      list.push('first_pollen_collected');
    }
    if (state.firstBreedFreeClaimed && state.nurseryTray.length > 0) {
      list.push('first_reveal_seed_wait');
    }
    if (state.firstHybridRewardClaimed) {
      list.push('hybrid_unlocked');
    }
    // Genetics V2 — Slice 12 fix-pass (contract §4.14.14, owner review §4):
    // gated on the SAME predicate that gates the guaranteed second tutorial
    // breed itself (first hybrid matured AND its Reveal acknowledged) — not
    // merely `firstBreedFreeClaimed` (owner review §4, explicit).
    if (secondTutorialLessonAvailable(state)) {
      list.push('second_breed_available');
    }
    if (interspeciesSelected) {
      list.push('first_interspecies_pair');
    }
    if (v2CandidateCount >= 5 && state.geneticDust === 0) {
      list.push('surplus_specimen');
    }
    if (state.geneticDust > 0) {
      list.push('first_dust_earned');
    }
    return list;
  }, [state, interspeciesSelected]);

  useEffect(() => {
    if (visibleKey) return;
    const next = nextLumiHintV2(candidates, state.lumiHintsShown ?? []);
    if (next) {
      setVisibleKey(next);
      gameStore.markLumiHintShownV2(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, state.lumiHintsShown]);

  if (!visibleKey) return null;

  return (
    <div className="lumi-hint-bubble" role="status">
      <p className="lumi-hint-text">{LUMI_HINT_TEXT_V2[visibleKey]}</p>
      <button className="lumi-hint-dismiss" onClick={() => setVisibleKey(null)} aria-label="Закрыть подсказку">
        ✕
      </button>
    </div>
  );
}
