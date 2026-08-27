interface HUDProps {
  coins: number;
  onOpenShop: () => void;
  onOpenInventory: () => void;
}

export function HUD({ coins, onOpenShop, onOpenInventory }: HUDProps) {
  return (
    <div className="hud-bar">
      <div className="hud-coins">
        <img className="coin-icon" src="assets/ui/icon_coin.png" alt="монеты" />
        <span>{coins}</span>
      </div>
      <div className="hud-buttons">
        <button className="hud-btn" onClick={onOpenInventory}>
          Инвентарь
        </button>
        <button className="hud-btn hud-btn-accent" onClick={onOpenShop}>
          Магазин
        </button>
      </div>
    </div>
  );
}
