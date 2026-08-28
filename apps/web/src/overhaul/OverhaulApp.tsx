import { useEffect, useRef, useState } from 'react';
import { createOverhaulPhaserGame } from '../game/PhaserGameOverhaul';
import { useGameState } from '../game/useGameState';
import { gardenEvents } from '../game/events';
import { overhaulEvents } from './events';
import { HUD } from '../ui/HUD';
import { ShopPanel } from '../ui/ShopPanel';
import { InventoryPanel } from '../ui/InventoryPanel';
import { PlantPicker } from '../ui/PlantPicker';
import { LabPanel } from '../ui/LabPanel';
import { LabPanelV2 } from '../ui/LabPanelV2';
import { PlantPickerV2 } from '../ui/PlantPickerV2';
import { HybridCardPanel } from '../ui/HybridCardPanel';
import { AlbumPanel } from '../ui/AlbumPanel';
import { SocialPanel } from '../ui/SocialPanel';
import { PurchasesPanel } from '../ui/PurchasesPanel';
import { AdminPanel } from '../ui/AdminPanel';
import { QuestPanel } from '../ui/QuestPanel';
import { Onboarding } from '../ui/Onboarding';
import { hasSeenOnboarding } from '../onboarding/onboardingState';
import { OfflineBanner } from '../ui/OfflineBanner';
import { Toast } from '../ui/Toast';
import { useAuth } from '../auth/useAuth';
import { isPaymentsEnabled } from '../payments/PaymentProvider';
import { track } from '../analytics/track';
import { recordSessionStart } from '../analytics/retention';
import { checkIsAdmin } from '../admin/adminData';
import { gameApi } from '../sync/gameApi';
import { isCloudSyncEnabled } from '../lib/supabaseClient';
import { questStatuses } from '../game/quests';
import { GENETICS_V2_ENABLED } from '../game/featureFlags';
import '../App.css';

type Panel = 'shop' | 'inventory' | 'lab' | 'album' | 'social' | 'purchases' | 'admin' | 'quests' | null;
type WorldMode = 'estate' | 'laboratory';

/**
 * Visual Overhaul (ветка visual-overhaul, VITE_VISUAL_OVERHAUL_ENABLED).
 * Живое поместье + полноэкранная лаборатория вместо классической сетки
 * грядок (см. ClassicApp.tsx). Игровая модель, localStorage, все React-панели
 * (магазин/инвентарь/квесты/соц/покупки/admin/альбом/лаборатория) —
 * ПЕРЕИСПОЛЬЗОВАНЫ без изменений логики, только новый Phaser-слой снизу
 * (EstateScene/LaboratoryScene вместо GardenScene) и один новый режим
 * презентации у LabPanel (`fullscreenReveal`, см. ui/LabPanel.tsx).
 */
export function OverhaulApp() {
  const gameContainerRef = useRef<HTMLDivElement>(null);
  const phaserGameRef = useRef<ReturnType<typeof createOverhaulPhaserGame> | null>(null);
  const state = useGameState();
  const auth = useAuth();
  const [panel, setPanel] = useState<Panel>(null);
  const [plantPlotId, setPlantPlotId] = useState<number | null>(null);
  // Genetics V2 — Slice 5 (delta doc §0.7 п.11): id грядки, для которой
  // открыта минимальная простая карточка постоянного V2-растения. Отдельный
  // от `panel`/`plantPlotId` кусок состояния — открывается только из
  // EstateScene по клику на mature-V2-грядку (см. events.ts requestHybridCard),
  // не пересекается с существующими панелями/плантпикером.
  const [hybridCardPlotId, setHybridCardPlotId] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => !hasSeenOnboarding());
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);
  const [mode, setMode] = useState<WorldMode>('estate');

  useEffect(() => {
    if (!gameContainerRef.current) return;
    const game = createOverhaulPhaserGame(gameContainerRef.current);
    phaserGameRef.current = game;
    return () => {
      phaserGameRef.current = null;
      game.destroy(true);
    };
  }, []);

  // Тот же баг/фикс, что ClassicApp.tsx (Этап 9): Phaser слушает pointerdown
  // на всём window, поэтому его нужно выключать, пока открыта любая
  // блокирующая React-панель поверх канваса — иначе клик по кнопке внутри
  // панели протекает и в EstateScene/LaboratoryScene тоже. Один и тот же
  // переключатель работает для обеих Phaser-сцен, т.к. активна всегда ровно
  // одна сцена в этом game-инстансе.
  const isOverlayOpen = panel !== null || showOnboarding || plantPlotId !== null || hybridCardPlotId !== null;
  useEffect(() => {
    const game = phaserGameRef.current;
    if (!game) return;
    game.input.enabled = !isOverlayOpen;
  }, [isOverlayOpen]);

  useEffect(() => {
    recordSessionStart();
  }, []);

  useEffect(() => {
    if (auth.status !== 'signed_in') {
      setIsAdmin(false);
      return;
    }
    let cancelled = false;
    checkIsAdmin().then((result) => {
      if (!cancelled) setIsAdmin(result);
    });
    return () => {
      cancelled = true;
    };
  }, [auth.status]);

  useEffect(() => {
    if (!isCloudSyncEnabled || auth.status !== 'signed_in') return;
    let cancelled = false;
    function drain() {
      gameApi.drainQueue().catch(() => {});
    }
    drain();
    function handleOnline() {
      if (cancelled) return;
      setIsOffline(false);
      drain();
    }
    function handleOffline() {
      if (!cancelled) setIsOffline(true);
    }
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      cancelled = true;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [auth.status]);

  useEffect(() => {
    const offPlant = gardenEvents.on('requestPlant', ({ plotId }) => setPlantPlotId(plotId));
    const offToast = gardenEvents.on('toast', ({ text }) => setToast(text));
    // Fix-pass (audit, bug 1): подписка на requestHybridCard — только при
    // активном GENETICS_V2_ENABLED. EstateScene и так никогда не эмитит этот
    // ивент, когда флаг выключен (см. EstateScene.ts renderHybridPlotCellReadOnly),
    // но подписка здесь дополнительно и независимо гарантирует, что в
    // Overhaul + Legacy Genetics не существует вообще ни одного пути открыть
    // HybridCardPanel — belt-and-suspenders, оба слоя проверяют флаг.
    const offHybridCard = GENETICS_V2_ENABLED
      ? gardenEvents.on('requestHybridCard', ({ plotId }) => setHybridCardPlotId(plotId))
      : undefined;
    return () => {
      offPlant();
      offToast();
      offHybridCard?.();
    };
  }, []);

  // Мост Phaser-сцены -> React: вход/выход из лаборатории и клики по
  // hotspot'ам LaboratoryScene открывают существующие React-панели —
  // "Рабочий стол" -> LabPanel (скрещивание), "Витрина" -> AlbumPanel
  // (коллекция). Остальные три hotspot'а честно помечены "скоро" уже внутри
  // самой LaboratoryScene (см. game/scenes/LaboratoryScene.ts).
  useEffect(() => {
    const offEnter = overhaulEvents.on('enterLaboratory', () => setMode('laboratory'));
    const offExit = overhaulEvents.on('exitLaboratory', () => {
      setMode('estate');
      setPanel(null);
    });
    const offHotspot = overhaulEvents.on('openHotspot', ({ hotspot }) => {
      if (hotspot === 'workbench') setPanel('lab');
      else if (hotspot === 'showcase') setPanel('album');
    });
    return () => {
      offEnter();
      offExit();
      offHotspot();
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div className={`app-shell overhaul-shell overhaul-mode-${mode}`}>
      <div id="game-root" ref={gameContainerRef} />
      <HUD
        coins={state.coins}
        onOpenShop={() => {
          track('store_opened');
          setPanel('shop');
        }}
        onOpenInventory={() => setPanel('inventory')}
        onOpenLab={() => setPanel('lab')}
        onOpenAlbum={() => setPanel('album')}
        onOpenSocial={auth.status === 'signed_in' ? () => setPanel('social') : undefined}
        onOpenPurchases={
          isPaymentsEnabled && auth.status === 'signed_in' ? () => setPanel('purchases') : undefined
        }
        onOpenAdmin={isAdmin ? () => setPanel('admin') : undefined}
        onOpenQuests={() => setPanel('quests')}
        hasClaimableQuest={questStatuses(state).some((q) => q.completed && !q.claimed)}
      />

      {isOffline && isCloudSyncEnabled && auth.status === 'signed_in' && <OfflineBanner />}

      {panel === 'shop' && <ShopPanel coins={state.coins} onClose={() => setPanel(null)} />}
      {panel === 'inventory' && <InventoryPanel inventory={state.inventory} onClose={() => setPanel(null)} />}
      {panel === 'lab' &&
        (GENETICS_V2_ENABLED ? (
          <LabPanelV2
            specimens={state.specimens}
            nurseryTray={state.nurseryTray}
            pollen={state.pollen}
            firstBreedFreeClaimed={state.firstBreedFreeClaimed}
            onClose={() => setPanel(null)}
          />
        ) : (
          <LabPanel
            specimens={state.specimens}
            coins={state.coins}
            geneticDust={state.geneticDust}
            pityCounter={state.pityCounter}
            onClose={() => setPanel(null)}
            fullscreenReveal
          />
        ))}
      {panel === 'album' && (
        <AlbumPanel specimens={state.specimens} geneticDust={state.geneticDust} onClose={() => setPanel(null)} />
      )}
      {panel === 'social' && <SocialPanel onClose={() => setPanel(null)} />}
      {panel === 'purchases' && <PurchasesPanel onClose={() => setPanel(null)} />}
      {panel === 'admin' && isAdmin && <AdminPanel onClose={() => setPanel(null)} />}
      {panel === 'quests' && <QuestPanel state={state} onClose={() => setPanel(null)} />}
      {showOnboarding && <Onboarding onFinish={() => setShowOnboarding(false)} />}
      {plantPlotId !== null &&
        (GENETICS_V2_ENABLED ? (
          <PlantPickerV2
            plotId={plantPlotId}
            inventory={state.inventory}
            nurseryTray={state.nurseryTray}
            onClose={() => setPlantPlotId(null)}
            onOpenShop={() => {
              track('store_opened');
              setPanel('shop');
            }}
          />
        ) : (
          <PlantPicker
            plotId={plantPlotId}
            inventory={state.inventory}
            onClose={() => setPlantPlotId(null)}
            onOpenShop={() => {
              track('store_opened');
              setPanel('shop');
            }}
          />
        ))}
      {/* Fix-pass (audit, bug 1): рендер тоже под флагом (defense-in-depth —
          hybridCardPlotId физически не может быть выставлен без флага, см.
          подписку выше, но проверка здесь ничего не стоит и защищает от
          будущих регрессий, если кто-то добавит ещё один способ его выставить). */}
      {GENETICS_V2_ENABLED && hybridCardPlotId !== null && (
        <HybridCardPanel plotId={hybridCardPlotId} onClose={() => setHybridCardPlotId(null)} />
      )}
      {toast && <Toast text={toast} />}
    </div>
  );
}
