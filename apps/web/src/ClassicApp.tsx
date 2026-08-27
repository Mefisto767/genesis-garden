import { useEffect, useRef, useState } from 'react';
import { createPhaserGame } from './game/PhaserGame';
import { useGameState } from './game/useGameState';
import { gardenEvents } from './game/events';
import { HUD } from './ui/HUD';
import { ShopPanel } from './ui/ShopPanel';
import { InventoryPanel } from './ui/InventoryPanel';
import { PlantPicker } from './ui/PlantPicker';
import { LabPanel } from './ui/LabPanel';
import { AlbumPanel } from './ui/AlbumPanel';
import { SocialPanel } from './ui/SocialPanel';
import { PurchasesPanel } from './ui/PurchasesPanel';
import { AdminPanel } from './ui/AdminPanel';
import { QuestPanel } from './ui/QuestPanel';
import { Onboarding } from './ui/Onboarding';
import { hasSeenOnboarding } from './onboarding/onboardingState';
import { OfflineBanner } from './ui/OfflineBanner';
import { Toast } from './ui/Toast';
import { useAuth } from './auth/useAuth';
import { isPaymentsEnabled } from './payments/PaymentProvider';
import { track } from './analytics/track';
import { recordSessionStart } from './analytics/retention';
import { checkIsAdmin } from './admin/adminData';
import { gameApi } from './sync/gameApi';
import { isCloudSyncEnabled } from './lib/supabaseClient';
import { questStatuses } from './game/quests';
import './App.css';

type Panel = 'shop' | 'inventory' | 'lab' | 'album' | 'social' | 'purchases' | 'admin' | 'quests' | null;

function ClassicApp() {
  const gameContainerRef = useRef<HTMLDivElement>(null);
  const phaserGameRef = useRef<ReturnType<typeof createPhaserGame> | null>(null);
  const state = useGameState();
  const auth = useAuth();
  const [panel, setPanel] = useState<Panel>(null);
  const [plantPlotId, setPlantPlotId] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => !hasSeenOnboarding());
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);

  useEffect(() => {
    if (!gameContainerRef.current) return;
    const game = createPhaserGame(gameContainerRef.current);
    phaserGameRef.current = game;
    return () => {
      phaserGameRef.current = null;
      game.destroy(true);
    };
  }, []);

  // Этап 9 — реальный баг, найденный e2e-тестом: Phaser по умолчанию слушает
  // mousedown/pointerdown на ВСЁМ window (MouseManager.onMouseDownWindow),
  // а не только на canvas, и сам переводит координаты клика в игровые —
  // не проверяя, какой DOM-элемент визуально стоит поверх канваса. Поэтому
  // клик по кнопке внутри модалки (онбординг, любой sheet-панели), если она
  // физически перекрывает грядку на канвасе, ДОХОДИЛ и до Phaser тоже —
  // игрок мог случайно разблокировать/посадить/собрать грядку под открытой
  // панелью. Решение — штатный переключатель Phaser (game.input.enabled),
  // выключаем его, пока открыта любая блокирующая панель поверх канваса.
  const isOverlayOpen = panel !== null || showOnboarding || plantPlotId !== null;
  useEffect(() => {
    const game = phaserGameRef.current;
    if (!game) return;
    game.input.enabled = !isOverlayOpen;
  }, [isOverlayOpen]);

  useEffect(() => {
    // session_started + day_1/day_7 return (см. analytics/retention.ts) —
    // сами по себе не-op, если облако выключено (track() проверяет это внутри).
    recordSessionStart();
  }, []);

  useEffect(() => {
    // Этап 8 — кнопка Admin появляется, только если сервер подтвердил
    // profiles.is_admin === true; клиент никогда не решает это сам (см.
    // admin/adminData.ts — запрос фильтрован по auth.uid(), обойти нельзя).
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
    // Этап 9 — офлайн-очередь (Этап 4) реально дренируется по событию 'online'
    // и при старте приложения, как и было задумано изначально (см. комментарий
    // в gameApi.drainQueue) — раньше метод существовал, но нигде не вызывался.
    // Актуально только когда есть настоящий облачный аккаунт: без него все
    // действия чисто локальные и в очередь никогда не попадают.
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
    return () => {
      offPlant();
      offToast();
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div className="app-shell">
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
      {panel === 'lab' && (
        <LabPanel
          specimens={state.specimens}
          coins={state.coins}
          geneticDust={state.geneticDust}
          pityCounter={state.pityCounter}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'album' && (
        <AlbumPanel specimens={state.specimens} geneticDust={state.geneticDust} onClose={() => setPanel(null)} />
      )}
      {panel === 'social' && <SocialPanel onClose={() => setPanel(null)} />}
      {panel === 'purchases' && <PurchasesPanel onClose={() => setPanel(null)} />}
      {panel === 'admin' && isAdmin && <AdminPanel onClose={() => setPanel(null)} />}
      {panel === 'quests' && <QuestPanel state={state} onClose={() => setPanel(null)} />}
      {showOnboarding && <Onboarding onFinish={() => setShowOnboarding(false)} />}
      {plantPlotId !== null && (
        <PlantPicker
          plotId={plantPlotId}
          inventory={state.inventory}
          onClose={() => setPlantPlotId(null)}
          onOpenShop={() => {
            track('store_opened');
            setPanel('shop');
          }}
        />
      )}
      {toast && <Toast text={toast} />}
    </div>
  );
}

export default ClassicApp;
