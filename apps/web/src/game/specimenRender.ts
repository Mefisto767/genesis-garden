// ============================================================================
// Композитинг генома в <canvas> для React-UI (Лаборатория/Альбом).
//
// В Phaser (buildPlantSprite в plantArt.ts) тонирование делает setTintFill —
// в DOM-canvas аналог: рисуем белую маску-слой в оффскрин-канвас, затем
// globalCompositeOperation='source-in' + заливка цветом, и уже тонированный
// слой накладываем на основной канвас обычным source-over. Порядок слоёв
// тот же, что и в движке: leaf -> secondary -> primary -> line (контур).
// ============================================================================

import type { Genome, AuraTier, RarityTier } from './genetics';
import { sizeScale } from './genetics';

const imageCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(url: string): Promise<HTMLImageElement> {
  let p = imageCache.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`failed to load ${url}`));
      img.src = url;
    });
    imageCache.set(url, p);
  }
  return p;
}

function layerUrl(speciesId: number, stage: number, layer: string): string {
  const s = String(speciesId).padStart(2, '0');
  return `assets/plants/plant_species${s}_stage${stage}_${layer}.png`;
}

const LAYER_ORDER: Array<{ name: string; tintKey: 'leaf' | 'secondary' | 'primary' | null }> = [
  { name: 'mask_leaf', tintKey: 'leaf' },
  { name: 'mask_secondary', tintKey: 'secondary' },
  { name: 'mask_primary', tintKey: 'primary' },
  { name: 'line', tintKey: null },
];

/** Рисует геном (вид + окрас + масштаб) на переданном канвасе. Отменяемо через AbortSignal. */
export async function renderGenomeToCanvas(
  canvas: HTMLCanvasElement,
  genome: Genome,
  stage = 3,
  signal?: AbortSignal
): Promise<void> {
  const size = canvas.width;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = false;

  const scale = sizeScale(genome.size);
  const drawSize = Math.round(size * scale);
  const offset = Math.round((size - drawSize) / 2);

  for (const layer of LAYER_ORDER) {
    const url = layerUrl(genome.shape, stage, layer.name);
    let img: HTMLImageElement;
    try {
      img = await loadImage(url);
    } catch {
      continue; // отсутствующий ассет — пропускаем слой, не роняем рендер
    }
    if (signal?.aborted) return;

    if (layer.tintKey) {
      const off = document.createElement('canvas');
      off.width = size;
      off.height = size;
      const octx = off.getContext('2d');
      if (!octx) continue;
      octx.imageSmoothingEnabled = false;
      octx.drawImage(img, offset, offset, drawSize, drawSize);
      octx.globalCompositeOperation = 'source-in';
      octx.fillStyle = genome[layer.tintKey];
      octx.fillRect(0, 0, size, size);
      ctx.drawImage(off, 0, 0);
    } else {
      ctx.drawImage(img, offset, offset, drawSize, drawSize);
    }
  }
}

export function auraGlowStyle(aura: AuraTier): string {
  switch (aura) {
    case 'faint':
      return '0 0 8px 2px rgba(255, 216, 110, 0.35)';
    case 'glow':
      return '0 0 14px 4px rgba(255, 200, 60, 0.55)';
    case 'radiant':
      return '0 0 24px 8px rgba(255, 170, 40, 0.8)';
    default:
      return 'none';
  }
}

export function rarityFrameUrl(rarity: RarityTier): string {
  return `assets/icons/rarity_frame_${rarity}.png`;
}

export const RARITY_LABEL: Record<RarityTier, string> = {
  common: 'Обычное',
  uncommon: 'Необычное',
  rare: 'Редкое',
  epic: 'Эпическое',
  legendary: 'Легендарное',
};
