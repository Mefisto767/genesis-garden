import ClassicApp from './ClassicApp';
import { OverhaulApp } from './overhaul/OverhaulApp';
import { VISUAL_OVERHAUL_ENABLED } from './game/featureFlags';

/**
 * Точка входа-переключатель (Visual Overhaul, ветка visual-overhaul).
 * VITE_VISUAL_OVERHAUL_ENABLED=false (по умолчанию, в т.ч. в production) —
 * рендерит ClassicApp, byte-for-byte старое поведение (это прежний App.tsx,
 * см. git history). true — рендерит новый OverhaulApp (живое поместье,
 * персонаж, полноэкранная лаборатория). Обе ветки читают один и тот же
 * gameStore/localStorage — переключение флага не мигрирует и не теряет
 * сохранение.
 */
function App() {
  return VISUAL_OVERHAUL_ENABLED ? <OverhaulApp /> : <ClassicApp />;
}

export default App;
