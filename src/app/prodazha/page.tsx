// Страница «Продажа и списание» (S2-B; TZ §5.4, §6.1 шаг 8, §6.2, §7.6).
// Server component: собирает продаваемые цели (плиты AVAILABLE/RESERVED,
// куски AVAILABLE, объём партий со свободным остатком по ADR-005) и
// последние 20 продаж. Флоу продажи — в клиентском SaleForm.

import type { Metadata } from "next";
import { db } from "@/lib/db";
import {
  EMPTY_AGGREGATE,
  freeRemainderFromAggregate,
  getBatchRemainders,
} from "@/lib/batch-remainders";
import { getCapabilities } from "@/lib/session";
import NoAccess from "@/components/NoAccess";
import SaleForm, { type StoneTypeGroup } from "./SaleForm";

export const metadata: Metadata = {
  title: "Продажа и списание — Onyx",
};

// Наличие должно быть актуальным на каждый запрос.
export const dynamic = "force-dynamic";

const m2Fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const dateFmt = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short" });
const dateTimeFmt = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "short",
  timeStyle: "short",
});

const PIECE_KIND_RU: Record<string, string> = {
  BROKEN: "бой",
  OFFCUT: "остаток",
};

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Prisma Decimal | null → number | null. */
function toNum(d: { toString(): string } | null): number | null {
  return d === null ? null : Number(d.toString());
}

export default async function ProdazhaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // R2 — rol gate: продажа доступна OWNER/MANAGER (canSell). Складчик — <NoAccess/>.
  // Nav layout'da qoladi; sahifa mazmuni bloklanadi (kosmetik emas — server-side).
  const caps = await getCapabilities();
  if (!caps.canSell) {
    return (
      <main className="mx-auto max-w-xl p-4 pb-12">
        <NoAccess />
      </main>
    );
  }

  const sp = await searchParams;
  const ok = first(sp.ok) === "1";
  const what = first(sp.what);
  const customer = first(sp.customer);

  const [stoneTypesRaw, recentSales] = await Promise.all([
    // BATCH-B (perf): весь склад больше не тянется. Для формулы §3 берём только
    // счётчики партий + агрегаты (getBatchRemainders ниже); для пикера — только
    // продаваемые плиты (AVAILABLE/RESERVED) и куски (AVAILABLE). SOLD/история
    // не грузятся.
    db.stoneType.findMany({
      where: { isArchived: false },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        rockType: true,
        batches: {
          orderBy: { arrivedAt: "asc" },
          select: {
            id: true,
            arrivedAt: true,
            needsCheck: true,
            slabsTotal: true,
            areaTotalM2: true,
            slabsAdjusted: true,
            areaAdjustedM2: true,
            slabsSoldDirect: true,
            areaSoldDirectM2: true,
            // Пикер: только продаваемые плиты (не весь исторический хвост).
            slabs: {
              where: { status: { in: ["AVAILABLE", "RESERVED"] } },
              select: {
                id: true,
                label: true,
                status: true,
                needsCheck: true,
                lengthMm: true,
                widthMm: true,
                areaM2: true,
                isAreaEstimated: true,
                block: true,
                landmark: true,
                reservations: {
                  where: { status: "ACTIVE" },
                  select: { manager: { select: { name: true } } },
                },
              },
            },
          },
        },
        pieces: {
          where: { status: "AVAILABLE" },
          select: {
            id: true,
            kind: true,
            needsCheck: true,
            boundingLengthMm: true,
            boundingWidthMm: true,
            areaM2: true,
            block: true,
            landmark: true,
          },
        },
      },
    }),
    db.saleRecord.findMany({
      orderBy: { soldAt: "desc" },
      take: 20,
      include: {
        manager: { select: { name: true } },
        slab: { select: { label: true, stoneType: { select: { name: true } } } },
        piece: { select: { kind: true, stoneType: { select: { name: true } } } },
        batch: { select: { stoneType: { select: { name: true } } } },
      },
    }),
  ]);

  // §3 формула: свободный остаток партий по SQL-агрегатам (весь склад не тянем).
  const remainders = await getBatchRemainders(
    db,
    stoneTypesRaw.flatMap((st) => st.batches.map((b) => b.id)),
  );

  const stoneTypes: StoneTypeGroup[] = stoneTypesRaw
    .map((st) => {
      const slabs = st.batches
        .flatMap((b) => b.slabs)
        .filter((s) => s.status === "AVAILABLE" || s.status === "RESERVED")
        .map((s) => ({
          id: s.id,
          label: s.label,
          status: s.status as "AVAILABLE" | "RESERVED",
          needsCheck: s.needsCheck,
          detail: [
            s.lengthMm !== null && s.widthMm !== null && `${s.lengthMm}×${s.widthMm} мм`,
            s.areaM2 !== null &&
              `${s.isAreaEstimated ? "≈" : ""}${m2Fmt.format(Number(s.areaM2))} м²`,
          ]
            .filter(Boolean)
            .join(" · ") || "размеры не указаны",
          place: `Блок ${s.block}, ориентир ${s.landmark}`,
          reservedBy: s.reservations[0]?.manager.name ?? null,
        }));

      const pieces = st.pieces.map((p) => ({
          id: p.id,
          kindRu: PIECE_KIND_RU[p.kind] ?? p.kind,
          needsCheck: p.needsCheck,
          detail: [
            `габарит ${p.boundingLengthMm}×${p.boundingWidthMm} мм`,
            p.areaM2 !== null && `≈${m2Fmt.format(Number(p.areaM2))} м²`,
          ]
            .filter(Boolean)
            .join(" · "),
          place: `Блок ${p.block}, ориентир ${p.landmark}`,
        }));

      const batches = st.batches.map((b) => {
        // §3: те же числа, что и раньше, но через SQL-агрегат (плиты любого статуса
        // + куски напрямую из партии originSlabId IS NULL) — без row-fetch.
        const free = freeRemainderFromAggregate(
          {
            slabsTotal: b.slabsTotal,
            areaTotalM2: toNum(b.areaTotalM2),
            slabsAdjusted: b.slabsAdjusted,
            areaAdjustedM2: Number(b.areaAdjustedM2),
            slabsSoldDirect: b.slabsSoldDirect,
            areaSoldDirectM2: Number(b.areaSoldDirectM2),
          },
          remainders.get(b.id) ?? EMPTY_AGGREGATE,
        );
        const freeParts = [
          free.slabsFree !== null && `~${free.slabsFree} плит`,
          free.areaFreeM2 !== null && `≈${m2Fmt.format(free.areaFreeM2)} м²`,
        ]
          .filter(Boolean)
          .join(" · ");
        const hasFree =
          (free.slabsFree !== null && free.slabsFree > 0) ||
          (free.areaFreeM2 !== null && free.areaFreeM2 > 0);
        return {
          id: b.id,
          title: `Партия от ${dateFmt.format(b.arrivedAt)}`,
          freeText: `свободно: ${freeParts || "нет данных"}`,
          needsCheck: b.needsCheck,
          hasFree,
        };
      });

      return { id: st.id, name: st.name, rockType: st.rockType, slabs, pieces, batches };
    })
    .filter(
      (st) =>
        st.slabs.length > 0 || st.pieces.length > 0 || st.batches.some((b) => b.hasFree),
    )
    .map((st) => ({ ...st, batches: st.batches.filter((b) => b.hasFree || b.needsCheck) }));

  return (
    <main className="mx-auto max-w-xl p-4 pb-12">
      <h1 className="mb-1 text-3xl font-bold tracking-tight">Продажа и списание</h1>
      <p className="mb-5 text-base text-gray-500">
        Камень списывается из наличия в момент продажи — не «потом отмечу».
      </p>

      {ok && what && (
        <div
          role="status"
          className="mb-5 rounded-2xl border border-green-300 bg-green-50 p-4 text-base text-green-900"
        >
          <p className="font-semibold">Продажа оформлена ✓</p>
          <p>
            {what}
            {customer && <> → {customer}</>}
          </p>
        </div>
      )}

      <SaleForm stoneTypes={stoneTypes} />

      <section className="mt-8">
        <h2 className="text-lg font-bold">Последние продажи</h2>
        {recentSales.length === 0 ? (
          <p className="mt-2 text-gray-500">Продаж пока не было.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {recentSales.map((s) => {
              let title = "Продажа";
              let qty: string | null = null;
              if (s.slab) title = `${s.slab.stoneType.name} — ${s.slab.label}`;
              else if (s.piece)
                title = `${s.piece.stoneType.name} — ${PIECE_KIND_RU[s.piece.kind] ?? s.piece.kind}`;
              else if (s.batch) {
                title = `${s.batch.stoneType.name} — объём из партии`;
                qty =
                  [
                    s.qtySlabs !== null && `${s.qtySlabs} плит`,
                    s.qtyAreaM2 !== null && `${m2Fmt.format(Number(s.qtyAreaM2))} м²`,
                  ]
                    .filter(Boolean)
                    .join(" / ") || null;
              }
              return (
                <li key={s.id} className="rounded-xl border border-gray-200 p-3 text-sm">
                  <div className="font-semibold">
                    {title}
                    {qty && <span className="font-normal"> · {qty}</span>}
                  </div>
                  <div className="text-gray-600">
                    Клиент: {s.customerName}
                    {s.customerContact && <> ({s.customerContact})</>}
                  </div>
                  <div className="text-gray-500">
                    {s.manager.name} · {dateTimeFmt.format(s.soldAt)}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
