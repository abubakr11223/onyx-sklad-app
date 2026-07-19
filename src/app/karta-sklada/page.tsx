// «Карта склада» (TZ §4.5) — где какой камень физически лежит.
// Server component. Склад делится на БЛОКИ (А, Б, В…), в каждом блоке —
// ОРИЕНТИРЫ (пронумерованные флажки: 1, 2, 3…). Локация камня — «Блок А,
// ориентир 2». Эта страница группирует все локации партий: блок → ориентир →
// камни, которые там лежат (с количеством: ~плиты / ≈м²).
//
// Данные — модель BatchLocation (block/landmark/slabsHere/areaHereM2 + партия →
// вид камня). Запрос лёгкий: одна findMany с плоской проекцией, без row-heavy
// связей. Ссылка на камень — /kamen/[stoneTypeId] (как в /poisk).
//
// Ролевой гейт (defense-in-depth, как /priemka): точные локации видят
// OWNER/MANAGER/WAREHOUSE (canSeeExactRemainder). PARTNER → <NoAccess/>
// (TZ §3: партнёр не видит точные остатки/локации).

import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getCapabilities } from "@/lib/session";
import NoAccess from "@/components/NoAccess";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Карта склада — Onyx",
};

// Тот же формат м², что в /poisk и /kamen (одна цифра после запятой).
const m2Fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

// Естественная (natural) сортировка для кириллических блоков и номеров
// ориентиров: «Б» < «В», «2» < «10» (а не лексически «10» < «2»).
const collator = new Intl.Collator("ru-RU", { numeric: true, sensitivity: "base" });

/** Камень на конкретном ориентире + сколько его там (может быть null). */
type StoneHere = {
  stoneTypeId: string;
  name: string;
  slabsHere: number | null;
  areaHereM2: number | null;
};

export default async function KartaSkladaPage() {
  // Ролевой гейт (defense-in-depth) — ПЕРВЫМ делом, как на /priemka.
  const caps = await getCapabilities();
  if (!caps.canSeeExactRemainder) {
    return (
      <main className="mx-auto max-w-3xl p-4 pb-12 sm:p-8">
        <NoAccess />
      </main>
    );
  }

  // Лёгкий запрос: плоская проекция локаций + вид камня партии. Без плит/боя/фото.
  const locations = await db.batchLocation.findMany({
    select: {
      block: true,
      landmark: true,
      slabsHere: true,
      areaHereM2: true,
      batch: {
        select: {
          stoneTypeId: true,
          stoneType: { select: { name: true } },
        },
      },
    },
    orderBy: [{ block: "asc" }, { landmark: "asc" }],
  });

  // Группировка в JS: блок → ориентир → камни. Map сохраняет порядок вставки,
  // но окончательный порядок задаём естественной сортировкой ниже (DB orderBy
  // по строке лексический — «10» шёл бы раньше «2»).
  const byBlock = new Map<string, Map<string, StoneHere[]>>();
  for (const loc of locations) {
    let byLandmark = byBlock.get(loc.block);
    if (!byLandmark) {
      byLandmark = new Map<string, StoneHere[]>();
      byBlock.set(loc.block, byLandmark);
    }
    const stones = byLandmark.get(loc.landmark) ?? [];
    stones.push({
      stoneTypeId: loc.batch.stoneTypeId,
      name: loc.batch.stoneType.name,
      slabsHere: loc.slabsHere,
      areaHereM2: loc.areaHereM2 === null ? null : Number(loc.areaHereM2),
    });
    byLandmark.set(loc.landmark, stones);
  }

  // В отсортированные массивы: блоки (А,Б,В…), внутри — ориентиры (1,2,10…).
  const blocks = [...byBlock.entries()]
    .sort((a, b) => collator.compare(a[0], b[0]))
    .map(([block, byLandmark]) => ({
      block,
      landmarks: [...byLandmark.entries()]
        .sort((a, b) => collator.compare(a[0], b[0]))
        .map(([landmark, stones]) => ({ landmark, stones })),
    }));

  return (
    <main className="mx-auto max-w-3xl p-4 pb-12 sm:p-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold-deep">
          Onyx · склад
        </p>
        <h1 className="mt-2 font-serif text-display font-bold tracking-tight text-ink">
          Карта склада
        </h1>
        <p className="mt-1 text-sm text-ink/60">
          Где какой камень лежит — по блокам и ориентирам.
        </p>
      </header>

      {blocks.length === 0 ? (
        <Card>
          <p className="text-sm text-ink/70">
            Локации ещё не заведены. Заводите склад блок за блоком (приёмка).
          </p>
        </Card>
      ) : (
        <div className="space-y-8">
          {blocks.map(({ block, landmarks }) => (
            <section key={block}>
              <h2 className="mb-3 text-lg font-bold text-ink">Блок {block}</h2>
              <div className="space-y-3">
                {landmarks.map(({ landmark, stones }) => (
                  <Card key={landmark}>
                    <h3 className="text-base font-semibold text-ink">
                      Ориентир {landmark}
                    </h3>
                    <ul className="mt-2 space-y-0.5">
                      {stones.map((s, i) => {
                        const qty: string[] = [];
                        if (s.slabsHere !== null) qty.push(`~${s.slabsHere} плит`);
                        if (s.areaHereM2 !== null)
                          qty.push(`≈${m2Fmt.format(s.areaHereM2)} м²`);
                        return (
                          <li key={s.stoneTypeId + "|" + i}>
                            <Link
                              href={"/kamen/" + s.stoneTypeId}
                              className="flex min-h-11 flex-wrap items-center gap-x-2 text-ink hover:text-gold-deep hover:underline"
                            >
                              <span className="font-medium">{s.name}</span>
                              {qty.length > 0 && (
                                <Badge variant="neutral">{qty.join(" · ")}</Badge>
                              )}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
