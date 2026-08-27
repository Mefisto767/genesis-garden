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
import { Toast } from './ui/Toast';
import './App.css';

type Panel = 'shop' | 'inventory' | 'lab' | 'album' | null;

function App() {
  const gameContainerRef = useRef<HTMLDivElement>(null);
  const state = useGameState();
  const [panel, setPanel] = useState<Panel>(null);
  const [plantPlotId, setPlantPlotId] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!gameContainerRef.current) return;
    const game = createPhaserGame(gameContainerRef.current);
    return () => {
      game.destroy(true);
    };
  }, []);

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
        onOpenShop={() => setPanel('shop')}
        onOpenInventory={() => setPanel('inventory')}
        onOpenLab={() => setPanel('lab')}
        onOpenAlbum={() => setPanel('album')}
      />

      {panel === 'shop' && <ShopPanel coins={state.coins} onClose={() => setPanel(null)} />}
      {panel === 'inventory' && <InventoryPanel inventory={state.inventory} onClose={() => setPanel(null)} />}
      {panel === 'lab' && (
        <LabPanel specimens={state.specimens} coins={state.coins} onClose={() => setPanel(null)} />
      )}
      {panel === 'album' && (
        <AlbumPanel specimens={state.specimens} geneticDust={state.geneticDust} onClose={() => setPanel(null)} />
      )}
      {plantPlotId !== null && (
        <PlantPicker
          plotId={plantPlotId}
          inventory={state.inventory}
          onClose={() => setPlantPlotId(null)}
          onOpenShop={() => setPanel('shop')}
        />
      )}
      {toast && <Toast text={toast} />}
    </div>
  );
}

export default App;
