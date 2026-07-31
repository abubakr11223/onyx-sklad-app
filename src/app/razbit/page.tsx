// «Разбить камень» (TZ §5.6, §6.4) — server component: загружает плиты
// (AVAILABLE/RESERVED — переходы 3 и 6, data-model.md §2) и партии для
// прямого боя, показывает уведомление о результате.

import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getCapabilities } from "@/lib/session";
import { formatTashkentDate } from "@/lib/datetime";
import NoAccess from "@/components/NoAccess";
import Alert from "@/components/ui/Alert";
import BreakForm, { type BatchOption, type SlabOption } from "./BreakForm";

export const metadata: Metadata = {
  title: "Разбить камень — Onyx",
};

// Списки плит/партий должны отражать текущее состояние БД.
export const dynamic = "force-dynamic";

const m2Fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const OK_TEXT: Record<string, string> = {
  break: "Плита переведена в бой / остаток",
  split: "Распил записан: плита разделена на части",
  direct: "Бой записан в партию",
};

export default async function RazbitPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // R2 — rol gate: разбить/бой делает склад (canManageWarehouse: OWNER/WAREHOUSE).
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

  const [slabRows, batchRows, gridBlocks] = await Promise.all([
    db.slab.findMany({
      where: { status: { in: ["AVAILABLE", "RESERVED"] } },
      orderBy: [{ stoneType: { name: "asc" } }, { label: "asc" }],
      select: {
        id: true,
        label: true,
        status: true,
        block: true,
        landmark: true,
        stoneType: { select: { name: true } },
      },
    }),
    db.batch.findMany({
      orderBy: [{ stoneType: { name: "asc" } }, { arrivedAt: "desc" }],
      select: {
        id: true,
        arrivedAt: true,
        slabsTotal: true,
        areaTotalM2: true,
        stoneType: { select: { name: true } },
      },
    }),
    // ТЗ №7 §2 (BUG-01) — подсказка буквы блока из сетки склада (datalist),
    // как в приёмке. Нормализация всё равно на записи — подсказка лишь удобство.
    db.warehouseBlock.findMany({
      orderBy: { sortOrder: "asc" },
      select: { letter: true, landmarks: { select: { number: true } } },
    }),
  ]);

  const blocks = gridBlocks.map((b) => ({
    letter: b.letter,
    landmarks: b.landmarks.map((l) => l.number),
  }));

  const slabs: SlabOption[] = slabRows.map((s) => ({
    id: s.id,
    label: s.label,
    stoneName: s.stoneType.name,
    reserved: s.status === "RESERVED",
    block: s.block,
    landmark: s.landmark,
  }));

  const batches: BatchOption[] = batchRows.map((b) => ({
    id: b.id,
    stoneName: b.stoneType.name,
    arrived: formatTashkentDate(b.arrivedAt),
    qty: [
      b.slabsTotal !== null && `${b.slabsTotal} плит`,
      b.areaTotalM2 !== null && `${m2Fmt.format(Number(b.areaTotalM2))} м²`,
    ]
      .filter(Boolean)
      .join(" / "),
  }));

  const ok = first(sp.ok) === "1";
  const okText = OK_TEXT[first(sp.action) ?? ""];
  const pieceCount = first(sp.pieces);
  const label = first(sp.label);
  const causeLabel = first(sp.cause);
  const reserveCancelled = first(sp.reserveCancelled) === "1";

  return (
    <main className="mx-auto max-w-xl p-4 pb-12">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold-deep">
          Onyx · склад
        </p>
        <h1 className="mt-2 font-serif text-display font-bold tracking-tight text-ink">
          Разбить камень
        </h1>
        <p className="mt-2 text-base text-ink/60">
          Бой или распил: система всегда отражает реальное состояние склада.
        </p>
      </header>

      {ok && okText && (
        <Alert variant="success" title={okText} className="mb-6">
          <p>
            {label && `${label} — `}
            {pieceCount && `кусков: ${pieceCount}`}
          </p>
          {causeLabel && (
            <p className="mt-1 text-sm text-ink/70">
              Причина: <span className="font-medium text-ink">{causeLabel}</span>
            </p>
          )}
          {reserveCancelled && (
            <p className="mt-1 font-medium text-warning">
              Бронь на плиту снята — менеджер увидит в журнале.
            </p>
          )}
        </Alert>
      )}

      <BreakForm slabs={slabs} batches={batches} blocks={blocks} />
    </main>
  );
}
