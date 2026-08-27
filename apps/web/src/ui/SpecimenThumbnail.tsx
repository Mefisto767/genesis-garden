import { useEffect, useRef } from 'react';
import type { Genome } from '../game/genetics';
import { rarityOf } from '../game/genetics';
import { renderGenomeToCanvas, auraGlowStyle, rarityFrameUrl } from '../game/specimenRender';

interface SpecimenThumbnailProps {
  genome: Genome;
  size?: number;
  showFrame?: boolean;
}

export function SpecimenThumbnail({ genome, size = 88, showFrame = true }: SpecimenThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const controller = new AbortController();
    renderGenomeToCanvas(canvas, genome, 3, controller.signal);
    return () => controller.abort();
    // genome — плоский объект генов, сравниваем по значению через JSON, чтобы
    // не перерисовывать канвас на каждый ре-рендер родителя без реальных изменений.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(genome)]);

  const rarity = rarityOf(genome);

  return (
    <div
      className="specimen-thumb"
      style={{ width: size, height: size, boxShadow: auraGlowStyle(genome.aura) }}
    >
      <canvas ref={canvasRef} width={size} height={size} className="specimen-canvas" />
      {showFrame && <img className="specimen-frame" src={rarityFrameUrl(rarity)} alt="" />}
    </div>
  );
}
