// Страница приёмки партии (TZ §5.1, §6.3) — server component:
// загружает виды камня из каталога и показывает уведомление об успехе.
// ТЗ №14 §3: ниже формы — «Ранее принятые партии» (список + Редактировать).

import { db } from "@/lib/db";
import { getCapabilities } from "@/lib/session";
import { todayTashkentISO } from "@/lib/datetime";
import NoAccess from "@/components/NoAccess";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";
import IntakeForm from "./IntakeForm";
import BatchList, { type BatchListItem } from "./BatchList";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Приёмка партии — Onyx",
};

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function PriemkaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // R2 — rol gate: приёмку делает склад (canManageWarehouse: OWNER/WAREHOUSE).
  // TZ §3: MANAGER складом не управляет — теперь тоже видит <NoAccess/>.
  const caps = await getCapabilities();
  if (!caps.canManageWarehouse) {
    return (
      <main className="mx-auto max-w-xl p-4 pb-12">
        <NoAccess />
      </main>
    );
  }

  const sp = await searchParams;
  const q = (first(sp.q) ?? "").trim();

  const [stoneTypes, gridBlocks, batchRows] = await Promise.all([
    db.stoneType.findMany({
      where: { isArchived: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true, rockType: true },
    }),
    // ТЗ №6 §5.4 — единый справочник: блоки/ориентиры из сетки склада
    db.warehouseBlock.findMany({
      orderBy: { sortOrder: "asc" },
      select: { letter: true, landmarks: { select: { number: true } } },
    }),
    db.batch.findMany({
      orderBy: { arrivedAt: "desc" },
      take: 80,
      where: q
        ? {
            OR: [
              { stoneType: { name: { contains: q, mode: "insensitive" } } },
              { supplierNote: { contains: q, mode: "insensitive" } },
            ],
          }
        : undefined,
      select: {
        id: true,
        arrivedAt: true,
        supplierNote: true,
        slabsTotal: true,
        areaTotalM2: true,
        lengthMm: true,
        widthMm: true,
        thicknessMm: true,
        stoneType: { select: { name: true } },
        _count: { select: { patterns: true } },
      },
    }),
  ]);

  const blocks = gridBlocks.map((b) => ({
    letter: b.letter,
    landmarks: b.landmarks.map((l) => l.number),
  }));

  const ok = first(sp.ok) === "1";
  const edited = first(sp.edited) === "1";
  const stone = first(sp.stone);
  const slabs = first(sp.slabs);
  const area = first(sp.area);
  const qty = [slabs && `${slabs} плит`, area && `${area} м²`]
    .filter(Boolean)
    .join(" / ");
  const changeN = first(sp.n);

  const today = todayTashkentISO();

  const listItems: BatchListItem[] = batchRows.map((b) => ({
    id: b.id,
    stoneName: b.stoneType.name,
    arrivedAt: b.arrivedAt,
    slabsTotal: b.slabsTotal,
    areaTotalM2:
      b.areaTotalM2 === null ? null : Number(b.areaTotalM2),
    lengthMm: b.lengthMm,
    widthMm: b.widthMm,
    thicknessMm: b.thicknessMm,
    supplierNote: b.supplierNote,
    patternCount: b._count.patterns,
  }));

  return (
    <main className="mx-auto max-w-xl p-4 pb-12">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold-deep">
          Onyx · склад
        </p>
        <h1 className="mt-2 font-serif text-display font-bold tracking-tight text-ink">
          Приёмка партии
        </h1>
        <p className="mt-2 text-base text-ink/60">
          Партия целиком — без поимённого учёта плит.
        </p>
      </header>

      {ok && stone && (
        <Alert variant="success" title="Партия принята" className="mb-6">
          <span className="font-medium text-ink">{stone}</span>
          {qty && (
            <Badge variant="neutral" className="ml-2 align-middle">
              {qty}
            </Badge>
          )}
        </Alert>
      )}

      {edited && (
        <Alert variant="success" title="Партия обновлена" className="mb-6">
          Изменения сохранены
          {changeN ? ` (полей: ${changeN})` : ""}. Запись в журнале
          (корректировка).
        </Alert>
      )}

      <IntakeForm
        stoneTypes={stoneTypes}
        defaultDate={today}
        blocks={blocks}
        canSeePrices={caps.canSeePrices}
      />

      {/* ТЗ №14 §3: список в приёмке — здесь же «ошибка после приёмки» чинится. */}
      <BatchList batches={listItems} q={q} />
    </main>
  );
}
