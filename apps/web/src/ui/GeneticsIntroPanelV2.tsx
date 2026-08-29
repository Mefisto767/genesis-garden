/**
 * Genetics V2 — Slice 12 (onboarding spec §3.1): первый контекстный экран
 * генетики — один короткий экран прямо в лаборатории (не серия слайдов, в
 * отличие от legacy `Onboarding.tsx`), показывается ровно перед первым
 * настоящим V2-скрещиванием. Точный текст — дословно из onboarding spec §0/
 * §3.1/§13.1, без добавлений. Не имеет кнопки «Пропустить» (спека §17 —
 * это один короткий экран перед бесплатным, гарантированно понятным
 * скрещиванием, не тур, который хотелось бы промотать).
 */
interface GeneticsIntroPanelV2Props {
  onDismiss: () => void;
}

export function GeneticsIntroPanelV2({ onDismiss }: GeneticsIntroPanelV2Props) {
  return (
    <div className="sheet-empty-block sheet-empty-centered genetics-intro-v2">
      <p className="sheet-empty">
        Выбери два растения. Новое растение получит часть признаков от каждого. Иногда появляется совершенно
        новый признак.
      </p>
      <button className="sheet-buy-btn" onClick={onDismiss}>
        Понятно, начать
      </button>
    </div>
  );
}
