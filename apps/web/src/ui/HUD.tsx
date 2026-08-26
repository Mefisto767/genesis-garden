interface HUDProps {
  coins: number;
  onOpenShop: () => void;
  onOpenInventory: () => void;
}

export function HUD({ coins, onOpenShop, onOpenInventory }: HUDProps) {
  return (
    <div className="hud-bar">
      <div className="hud-coins">🪙 {coins}</div>
      <div className="hud-buttons">
        <button className="hud-btn" onClick={onOpenInventory}>
          🎒 Инвентарь
        </button>
        <button className="hud-btn" onClick={onOpenShop}>
          🛒 Магазин
        </button>
      </div>
    </div>
  );
}
