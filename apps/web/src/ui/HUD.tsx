interface HUDProps {
  coins: number;
  onOpenShop: () => void;
  onOpenInventory: () => void;
  onOpenLab: () => void;
  onOpenAlbum: () => void;
}

export function HUD({ coins, onOpenShop, onOpenInventory, onOpenLab, onOpenAlbum }: HUDProps) {
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
        <button className="hud-btn" onClick={onOpenAlbum}>
          Альбом
        </button>
        <button className="hud-btn" onClick={onOpenLab}>
          Лаборатория
        </button>
        <button className="hud-btn hud-btn-accent" onClick={onOpenShop}>
          Магазин
        </button>
      </div>
    </div>
  );
}
