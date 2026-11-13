// ТЗ №20 I (§10.2) — «Похожие камни» на карточке /k/<код>.
//
// До 6 похожих камней В НАЛИЧИИ: та же порода и цвет → та же порода → тот же
// цвет (после K — признаки ИИ, см. similarTier в catalog.ts). Особенно важно
// для кода проданного/разбитого камня (§8.2): карточка «Нет в наличии» ведёт
// дальше. Поля — по роли (buildCatalogItem): клиенту без цифр, партнёру —
// свободно плит и м², сотруднику — ещё пометка «скрыт из каталога».
// Клиенту и партнёру — только виды, видимые в публичном каталоге.
//
// Сбой расчёта не роняет карточку: блок просто не рисуется.

import { db } from "@/lib/db";
import { loadSimilarStones, type CatalogItem } from "@/lib/catalog";
import type { CardViewer } from "@/lib/public-card";
import { publicDict, type PublicLocale } from "@/lib/public-i18n";
import StoneTile from "@/components/public/StoneTile";

export default async function SimilarStones({
  stoneTypeId,
  viewer,
  locale,
}: {
  stoneTypeId: string;
  viewer: CardViewer;
  locale: PublicLocale;
}) {
  let items: CatalogItem[] = [];
  try {
    items = await loadSimilarStones(db, stoneTypeId, { viewer });
  } catch (err) {
    console.error("[k] similar stones:", err);
    return null;
  }
  if (items.length === 0) return null;
  const t = publicDict(locale);
  return (
    <section className="mt-6" aria-labelledby="similar-title">
      <h2 id="similar-title" className="text-xl font-semibold text-ink">
        {t.similarTitle}
      </h2>
      <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map((item) => (
          <li key={item.code}>
            <StoneTile item={item} t={t} compact />
          </li>
        ))}
      </ul>
    </section>
  );
}
