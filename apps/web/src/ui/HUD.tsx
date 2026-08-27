interface HUDProps {
  coins: number;
  onOpenShop: () => void;
  onOpenInventory: () => void;
  onOpenLab: () => void;
  onOpenAlbum: () => void;
  /** Этап 6 — кнопка появляется только когда есть настоящий облачный аккаунт (иначе дарить нечему/некому). */
  onOpenSocial?: () => void;
  /** Этап 7 — только когда включены платежи (VITE_PAYMENTS_ENABLED) и есть облачный аккаунт (entitlements облачные). */
  onOpenPurchases?: () => void;
  /** Этап 8 — только после подтверждения profiles.is_admin === true (см. App.tsx), клиент не решает это сам. */
  onOpenAdmin?: () => void;
}

export function HUD({
  coins,
  onOpenShop,
  onOpenInventory,
  onOpenLab,
  onOpenAlbum,
  onOpenSocial,
  onOpenPurchases,
  onOpenAdmin,
}: HUDProps) {
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
        {onOpenSocial && (
          <button className="hud-btn" onClick={onOpenSocial}>
            Друзья
          </button>
        )}
        {onOpenPurchases && (
          <button className="hud-btn" onClick={onOpenPurchases}>
            Поддержать
          </button>
        )}
        {onOpenAdmin && (
          <button className="hud-btn" onClick={onOpenAdmin}>
            Admin
          </button>
        )}
        <button className="hud-btn hud-btn-accent" onClick={onOpenShop}>
          Магазин
        </button>
      </div>
    </div>
  );
}
