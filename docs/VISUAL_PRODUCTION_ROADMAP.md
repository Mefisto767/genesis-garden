# Genesis Garden — Visual Production Roadmap

Статус Genetics Gate 1: готов к owner review (`d59177a`).  
Следующая цель: production-real визуальный vertical slice, а не новая механика
и не коллекция концепт-картинок.

## Этапы

| Gate | Результат | Что доказывает | Механики |
|---|---|---|---|
| V0 | Visual Bible + Asset Contract | единый масштаб и pipeline | не меняются |
| V1 | foundation greybox в билде | камера, сетка, грядки, responsive | не меняются |
| V2 | стартовый сад art pass | узнаваемый внешний мир | не меняются |
| V3 | 2-species layered kit | генетика видна в растениях | не меняются |
| V4 | garden HUD/detail UI | рост, ready и ресурсы понятны | не меняются |
| V5 | Laboratory L1 | эмоциональный центр работает | не меняются |
| V6 | polish + user test | новичок понимает цикл | только UX-fixes |
| Gate 2 | решение о контенте/онлайне | продукт можно расширять | отдельный lock |

## Первый рабочий пакет V1

1. Логический viewport 960×540 и целочисленное pixel scaling.
2. Plot footprint 48→64 px.
3. Pitch центров 72/80→96 px, проверка коллизий и дорожек.
4. Selected/hover/tap state грядки.
5. Удаление постоянных таймеров со всех грядок.
6. Contextual timer из существующего `GameStore`.
7. Shape-based ready marker.
8. Агрегат готовности в HUD.
9. Typed V1 asset metadata и validator.
10. Текущие ассеты остаются явно маркированными placeholders.

### Текущий прогресс V1

Первый implementation pass завершил пункты 2–8: новая сетка 64/96,
контекстный таймер, shape-based ready marker и агрегат `Готово: N` в Overhaul
HUD. Координаты focused E2E синхронизированы. Пункты 1, 9 и production asset
replacement остаются следующей работой; V1 ещё не объявлен принятым без
визуального screenshot-review реального canvas.

V1 не меняет рост, экономику, RNG, генетику, save schema, количество грядок
или feature flags.

## Первый art proof после V1

Генерируется только один согласованный набор:

- plot base 64×64;
- Солнечник mature 64×96: line + color masks;
- neutral unrevealed plant 64×96;
- laboratory exterior в target scale;
- player scale token;
- маленький фрагмент terrain/path.

Он вставляется в реальный билд и показывается в двух кадрах: desktop 960×540
logical frame и mobile 360×800 CSS viewport. Отдельный красивый PNG без
реального canvas больше не является основанием для решения.

## Definition of done

- шесть грядок различимы на 50% масштаба;
- на каждой не больше одного растения;
- точный таймер доступен hover/tap/selection;
- ready понятен без чтения и без зависимости только от цвета;
- гибрид скрыт до Reveal и становится уникальным после него;
- лаборатория открывается отдельной сценой;
- точки доступны мышью, клавиатурой и touch;
- 360×800 не имеет horizontal overflow;
- Classic/Legacy isolation сохранена;
- Genetics Gate 1 тесты зелёные;
- новые visual-state tests и focused Playwright проходят.

## Намеренно позже

- финальный арт всех 48×48 тайлов;
- все восемь видов;
- 18 дополнительных грядок;
- сезоны, полный NPC/animal set, production weather/day-night;
- social estate и чужие сады;
- новые механики Gate 2.

Сначала доказывается один настоящий экран и одна генетическая особь. Затем
система масштабируется без повторной перерисовки всего продукта.
