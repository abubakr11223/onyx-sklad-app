// Страница «Продажа и списание» (S2-B; TZ §5.4, §6.1 шаг 8, §6.2, §7.6).
// Server component: продаваемые цели + фильтруемая/пагинируемая история
// продаж (W8-B). Флоу продажи — в клиентском SaleForm.

import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import {
  EMPTY_AGGREGATE,
  freeRemainderFromAggregate,
  getBatchRemainders,
} from "@/lib/batch-remainders";
import {
  SALE_HISTORY_PAGE_SIZE,
  fetchSaleHistoryPage,
  filtersFromSearchParams,
  saleHistoryAccess,
} from "@/lib/sale-history";
import { getCapabilities, currentActorId } from "@/lib/session";
import { formatTashkentDate, formatTashkentDateTime } from "@/lib/datetime";
import NoAccess from "@/components/NoAccess";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";
import Button, { buttonClass } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";
import SaleForm, {
  type SaleFormInitialPick,
  type StoneTypeGroup,
} from "./SaleForm";
import { confirmReturnAction, returnSaleAction } from "./actions";
import {
  parseSalePreselectQuery,
  resolveSalePreselect,
  salePreselectAlert,
  type SalePreselectUnitRow,
} from "./sale-preselect";

export const metadata: Metadata = {
  title: "Продажа и списание — Onyx",
};

// Наличие должно быть актуальным на каждый запрос.
export const dynamic = "force-dynamic";

const m2Fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

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
  const retOk = first(sp.retOk);
  const retErr = first(sp.retErr);

  // W7-B / §6.1 шаг 8: ?slab= | ?piece= deep-link. Query ishonchsiz — DB + canSell.
  const preQ = parseSalePreselectQuery({
    slab: sp.slab,
    piece: sp.piece,
  });
  // Ikkala berilsa slab ustun (kamen «Купить» faqat slab yuboradi).
  const preKind = preQ.slabId ? ("SLAB" as const) : preQ.pieceId ? ("PIECE" as const) : null;
  const preId = preQ.slabId ?? preQ.pieceId;

  const [stoneTypesRaw, actorId, preUnit] = await Promise.all([
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
            // ТЗ №3 — узоры партии (для продажи из узора).
            patterns: {
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                description: true,
                slabsCount: true,
                slabsSold: true,
                areaM2: true,
                areaSoldM2: true,
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
    currentActorId(),
    preKind === "SLAB" && preId
      ? db.slab.findUnique({
          where: { id: preId },
          select: {
            id: true,
            status: true,
            needsCheck: true,
            label: true,
            stoneTypeId: true,
            stoneType: { select: { name: true } },
            reservations: {
              where: { status: "ACTIVE" },
              select: { managerId: true },
              take: 1,
            },
          },
        })
      : preKind === "PIECE" && preId
        ? db.piece.findUnique({
            where: { id: preId },
            select: {
              id: true,
              status: true,
              needsCheck: true,
              kind: true,
              stoneTypeId: true,
              stoneType: { select: { name: true } },
              reservations: {
                where: { status: "ACTIVE" },
                select: { managerId: true },
                take: 1,
              },
            },
          })
        : Promise.resolve(null),
  ]);

  // W8-B — sotuv tarixi: keyset + filtr (SQL where). Rol: OWNER hammasi,
  // MANAGER faqat o'ziniki (saleHistoryAccess).
  const histAccess = saleHistoryAccess({
    canSell: caps.canSell,
    canSeeHistory: caps.canSeeHistory,
    actorId,
  });
  const histFilters = histAccess.allowed
    ? filtersFromSearchParams(sp, histAccess.managerId)
    : null;
  const histAfter = first(sp.after) ?? null;
  const salesPage =
    histFilters !== null
      ? await fetchSaleHistoryPage(db, {
          filters: histFilters,
          after: histAfter,
          pageSize: SALE_HISTORY_PAGE_SIZE,
        })
      : { rows: [], hasMore: false, nextCursor: null as string | null };
  const recentSales = salesPage.rows;
  const canSeeSalePrice = caps.canSeePrices;

  // Deep-link preselect (sof resolve). Parametr yo'q → form oddiy ochiladi.
  let initialPick: SaleFormInitialPick | null = null;
  let preselectBanner: {
    variant: "danger" | "info";
    title: string;
    body: string;
  } | null = null;

  if (preKind && preId) {
    const row: SalePreselectUnitRow | null = preUnit
      ? {
          id: preUnit.id,
          status: preUnit.status,
          needsCheck: preUnit.needsCheck,
          stoneTypeId: preUnit.stoneTypeId,
          stoneName: preUnit.stoneType.name,
          unitLabel:
            "label" in preUnit
              ? preUnit.label
              : PIECE_KIND_RU[(preUnit as { kind: string }).kind] ??
                (preUnit as { kind: string }).kind,
          activeReservationManagerId:
            preUnit.reservations[0]?.managerId ?? null,
        }
      : null;
    const resolved = resolveSalePreselect({
      canSell: caps.canSell,
      actorId,
      kind: preKind,
      requestedId: preId,
      unit: row,
    });
    preselectBanner = salePreselectAlert(resolved);
    if (resolved.ok) {
      initialPick = {
        stoneTypeId: resolved.stoneTypeId,
        mode: resolved.kind,
        unitId: resolved.unitId,
        title: resolved.title,
        subtitle: resolved.subtitle,
      };
    }
  }

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
        // ТЗ №3 — узоры партии с остатком (count − sold).
        const patterns = b.patterns.map((pat) => {
          const remSlabs = pat.slabsCount - pat.slabsSold;
          const remArea = Number(pat.areaM2) - Number(pat.areaSoldM2);
          return {
            id: pat.id,
            description: pat.description,
            remainText: `осталось: ${remSlabs} плит · ${m2Fmt.format(remArea)} м²`,
            hasFree: remSlabs > 0 || remArea > 0.0005,
          };
        });
        return {
          id: b.id,
          title: `Партия от ${formatTashkentDate(b.arrivedAt)}`,
          freeText: `свободно: ${freeParts || "нет данных"}`,
          needsCheck: b.needsCheck,
          hasFree,
          patterns,
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
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold-deep">
          Onyx · продажа
        </p>
        <h1 className="mt-2 font-serif text-display font-bold tracking-tight text-ink">
          Продажа и списание
        </h1>
        <p className="mt-2 text-base text-ink/60">
          Камень списывается из наличия в момент продажи — не «потом отмечу».
        </p>
      </header>

      {ok && what && (
        <Alert variant="success" title="Продажа оформлена" className="mb-6">
          {what}
          {customer && <> → {customer}</>}
        </Alert>
      )}

      {retOk && (
        <Alert variant="success" title="Возврат" className="mb-6">
          {retOk}
        </Alert>
      )}
      {retErr && (
        <Alert variant="danger" title="Возврат не прошёл" className="mb-6">
          {retErr}
        </Alert>
      )}

      {preselectBanner && (
        <Alert
          variant={preselectBanner.variant}
          title={preselectBanner.title}
          className="mb-6"
        >
          {preselectBanner.body}
        </Alert>
      )}

      <SaleForm stoneTypes={stoneTypes} initialPick={initialPick} />

      {/* W8-B — архив продаж: фильтр + keyset (TZ §5.4 «история: что, когда, кому»). */}
      <section id="sales" className="mt-8 scroll-mt-4">
        <h2 className="text-lg font-bold text-ink">История продаж</h2>
        <p className="mt-1 text-sm text-ink/60">
          {caps.canSeeHistory
            ? "Все продажи склада (вы — владелец)."
            : "Только ваши продажи."}{" "}
          Фильтр по дате и клиенту; страницы без пропусков (keyset).
        </p>

        <form
          method="get"
          action="/prodazha"
          className="mt-3 space-y-3 rounded-card border border-line bg-paper-2/40 p-3"
        >
          {/* Deep-link preselect saqlanmasin — filtr yangilansa toza tarix. */}
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm text-ink/70">
              С даты
              <input
                type="date"
                name="from"
                defaultValue={first(sp.from) ?? ""}
                className={inputClass + " mt-1"}
              />
            </label>
            <label className="block text-sm text-ink/70">
              По дату
              <input
                type="date"
                name="to"
                defaultValue={first(sp.to) ?? ""}
                className={inputClass + " mt-1"}
              />
            </label>
          </div>
          <label className="block text-sm text-ink/70">
            Клиент
            <input
              type="search"
              name="q"
              defaultValue={first(sp.q) ?? ""}
              placeholder="имя содержит…"
              autoComplete="off"
              className={inputClass + " mt-1"}
            />
          </label>
          <label className="block text-sm text-ink/70">
            Возврат
            <select
              name="returned"
              defaultValue={first(sp.returned) ?? ""}
              className={inputClass + " mt-1"}
            >
              <option value="">Все</option>
              <option value="no">Без возврата</option>
              <option value="yes">Только возвраты</option>
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="secondary" size="sm">
              Показать
            </Button>
            <Link href="/prodazha#sales" className={buttonClass("ghost", "sm")}>
              Сбросить
            </Link>
          </div>
        </form>

        {recentSales.length === 0 ? (
          <p className="mt-3 text-ink/60">
            По этим фильтрам продаж нет.
          </p>
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
                    s.qtyAreaM2 !== null &&
                      `${m2Fmt.format(Number(s.qtyAreaM2))} м²`,
                  ]
                    .filter(Boolean)
                    .join(" / ") || null;
              }
              const returned = s.returnedAt !== null;
              const unitStatus = s.slab?.status ?? s.piece?.status ?? null;
              const awaitingCheck = returned && unitStatus === "RETURNED";
              const confirmTarget = s.slab
                ? { type: "SLAB" as const, id: s.slab.id }
                : s.piece
                  ? { type: "PIECE" as const, id: s.piece.id }
                  : null;
              const returnable =
                !returned &&
                ((!s.slab && !s.piece) || unitStatus === "SOLD");
              const priceStr =
                canSeeSalePrice && s.price != null
                  ? m2Fmt.format(Number(s.price.toString()))
                  : null;
              return (
                <li
                  key={s.id}
                  className={`rounded-card border p-3 text-sm ${
                    returned
                      ? "border-danger/30 bg-danger/5"
                      : "border-ink/10 bg-paper-2/60"
                  }`}
                >
                  <div className="font-semibold text-ink">
                    {title}
                    {qty && (
                      <span className="font-normal text-ink/70"> · {qty}</span>
                    )}
                    {returned && (
                      <Badge variant="danger" className="ml-2 align-middle">
                        возврат
                      </Badge>
                    )}
                  </div>
                  <div className="text-ink/70">
                    Клиент: {s.customerName}
                    {s.customerContact && <> ({s.customerContact})</>}
                  </div>
                  <div className="text-ink/60">
                    {s.manager.name} · {formatTashkentDateTime(s.soldAt)}
                    {priceStr !== null && (
                      <> · {priceStr} сум</>
                    )}
                  </div>
                  {returned && s.returnedAt && (
                    <div className="mt-1 text-danger/80">
                      Возврат оформлен:{" "}
                      {formatTashkentDateTime(s.returnedAt)}
                    </div>
                  )}

                  {returnable && (
                    <form action={returnSaleAction} className="mt-2">
                      <input type="hidden" name="saleRecordId" value={s.id} />
                      <Button type="submit" variant="ghost" size="sm">
                        Оформить возврат
                      </Button>
                    </form>
                  )}

                  {awaitingCheck && confirmTarget && (
                    <form action={confirmReturnAction} className="mt-2">
                      <input
                        type="hidden"
                        name="targetType"
                        value={confirmTarget.type}
                      />
                      <input
                        type="hidden"
                        name="unitId"
                        value={confirmTarget.id}
                      />
                      <Button type="submit" variant="secondary" size="sm">
                        Проверено — вернуть в наличие
                      </Button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {salesPage.nextCursor && (
          <div className="mt-4">
            <Link
              href={(() => {
                const p = new URLSearchParams();
                const from = first(sp.from);
                const to = first(sp.to);
                const q = first(sp.q);
                const returned = first(sp.returned);
                if (from) p.set("from", from);
                if (to) p.set("to", to);
                if (q) p.set("q", q);
                if (returned) p.set("returned", returned);
                p.set("after", salesPage.nextCursor!);
                return `/prodazha?${p.toString()}#sales`;
              })()}
              className={buttonClass("secondary", "sm")}
            >
              Показать ещё →
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
