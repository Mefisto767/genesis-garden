import { useState } from 'react';

/**
 * Genetics V2 — Slice 12 (delta doc §12, onboarding spec §12): Ботаническая
 * книга — раздел «Генетика» с пятью рабочими подразделами (Родители,
 * Наследование, Скрытые признаки, Мутации и pity, Пыльца и генетическая
 * пыль) + шестой раздел «Ночные и погодные условия», честно помеченный
 * «Скоро» (навигация книги существует, содержимого нет — та же дисциплина,
 * что уже применена к остальным hotspot'ам `LaboratoryScene`). Здесь
 * допустимы термины locus/allele/dominance и точные проценты pity — книга
 * открывается добровольно (onboarding spec §0/§12). Не показывает: `GeneLock`
 * как уже доступную функцию, Lab L3/L4, стабилизацию мутаций, реализованное
 * влияние погоды, другие будущие механики как существующие.
 *
 * «Показать обучение генетике заново» — отдельное действие книги (onboarding
 * spec §14), не замена шестого раздела — открывает `TutorialReplayPanelV2`
 * поверх книги, не мутирует ни один игровой флаг/ресурс.
 *
 * На мобильном открывается почти полноэкранным слоем (`sheet-fullscreen`) —
 * onboarding spec §18. Горизонтальный скролл не используется нигде внутри.
 */

type BookSection = 'parents' | 'inheritance' | 'hidden' | 'mutations' | 'dust' | 'weather';

const SECTIONS: { id: BookSection; label: string; comingSoon?: boolean }[] = [
  { id: 'parents', label: 'Родители' },
  { id: 'inheritance', label: 'Наследование' },
  { id: 'hidden', label: 'Скрытые признаки' },
  { id: 'mutations', label: 'Мутации и pity' },
  { id: 'dust', label: 'Пыльца и генетическая пыль' },
  { id: 'weather', label: 'Ночные и погодные условия', comingSoon: true },
];

function sectionBody(section: BookSection): string {
  switch (section) {
    case 'parents':
      return 'Первый выбранный специмен — Seed Parent, он задаёт вид и общий силуэт гибрида. Второй — Pollen Parent, он тоже передаёт свои признаки потомку. Для одновидовой пары порядок не влияет на внешний вид, для межвидовой — определяет, каким видом будет ребёнок.';
    case 'inheritance':
      return 'Locus — это позиция или категория наследуемого признака растения (например, форма цветка или основной цвет). По каждому locus растение несёт два аллеля — по одному от каждого родителя. Один аллель может доминировать над другим: доминантный аллель проявляется у растения, рецессивный остаётся скрытым, но может передаться дальше следующему поколению.';
    case 'hidden':
      return 'Не у каждого растения все аллели видны — рецессивный аллель может быть скрыт под доминантным. Раскрыть скрытый признак можно микроскопом (за генетическую пыль) или естественно — если он проявится у одного из потомков этого растения.';
    case 'mutations':
      return 'При каждом скрещивании есть небольшой шанс мутации — от 3% до 100% на десятой попытке без мутации (система pity гарантирует, что мутация рано или поздно случится). Мутация повышает минимальную редкость результата и добавляет уникальный признак.';
    case 'dust':
      return 'Пыльца тратится на скрещивание и появляется при сборе урожая. Генетическая пыль появляется при переработке лишних растений и семян и тратится на раскрытие скрытых признаков микроскопом.';
    case 'weather':
      return '';
  }
}

interface BotanicalBookPanelProps {
  onClose: () => void;
  onOpenReplay: () => void;
}

export function BotanicalBookPanel({ onClose, onOpenReplay }: BotanicalBookPanelProps) {
  const [section, setSection] = useState<BookSection>('parents');
  const active = SECTIONS.find((s) => s.id === section)!;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet sheet-fullscreen" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>Ботаническая книга — Генетика</h2>
          <button className="sheet-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="book-nav">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={`book-nav-btn ${section === s.id ? 'is-selected' : ''}`}
              onClick={() => setSection(s.id)}
            >
              {s.label}
              {s.comingSoon && <span className="book-soon-badge">Скоро</span>}
            </button>
          ))}
        </div>

        <div className="sheet-list">
          {active.comingSoon ? (
            <p className="sheet-empty">Этот раздел появится в одном из следующих обновлений.</p>
          ) : (
            <p className="book-section-text">{sectionBody(section)}</p>
          )}
        </div>

        <div className="lab-footer">
          <button className="sheet-buy-btn" onClick={onOpenReplay}>
            Показать обучение генетике заново
          </button>
        </div>
      </div>
    </div>
  );
}
