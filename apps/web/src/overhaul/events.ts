// Шина событий между Phaser-сценами overhaul-режима (EstateScene,
// LaboratoryScene) и React-оболочкой OverhaulApp — тот же приём, что
// game/events.ts (gardenEvents), переиспользуем Emitter оттуда, а не плодим
// вторую реализацию. gardenEvents (toast/requestPlant) используется overhaul
// напрямую тоже — грядки/тосты общие для обоих визуальных режимов.
import { Emitter } from '../game/events';
import type { HotspotShape } from './proceduralAssets';

export interface OverhaulEvents {
  enterLaboratory: object;
  exitLaboratory: object;
  openHotspot: { hotspot: HotspotShape };
  nearLabChanged: { near: boolean };
  nearGateChanged: { near: boolean };
  /** Genetics V2 — Slice 12 (onboarding spec §5/§7.3): игрок впервые выбрал
   * двух родителей РАЗНЫХ видов в `LabPanelV2` — событийный триггер Люми-
   * подсказки `first_interspecies_pair`. `LumiHintBubble` сам решает,
   * показывать ли что-то (once-per-event через `lumiHintsShown`) — эмиттер
   * может сработать и повторно без вреда. */
  firstInterspeciesPairSelected: object;
}

export const overhaulEvents = new Emitter<OverhaulEvents>();
