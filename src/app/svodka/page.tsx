// TZ №10+11 §9 — сводка владельца: топ клиентов/объектов, B2B vs B2C, период.
// ТЗ №20 E — рейтинг клиентов (владелец — все, менеджер — свои) и «Продажи по
// менеджерам» (только владелец). UZS/USD никогда не смешиваются.

import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { getCapabilities, currentActorId } from "@/lib/session";
import { loadOwnerSummary } from "@/lib/owner-summary";
import { formatCurrencySummaryLine, formatDebtMoney } from "@/lib/debts-ui";
import { formatVolumeLine } from "@/lib/clients-directory";
import { CLIENT_TYPE_LABELS } from "@/lib/clients";
import { db } from "@/lib/db";
import { loadTopScans, type TopScanRow } from "@/lib/stone-scans";
import { STONE_CODE_KIND_RU } from "@/lib/stone-code";
import NoAccess from "@/components/NoAccess";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Field, { inputClass } from "@/components/ui/Field";
import { buttonClass } from "@/components/ui/Button";
import {
  RATING_PERIODS,
  loadClientRating,
  loadManagerSales,
  parseRatingCurrency,
  parseRatingPeriodKey,
  parseRatingSort,
  resolveRatingPeriod,
  type ClientRatingRow,
  type ManagerSalesRow,
  type PerCurrency,
  type RatingPeriod,
  type RatingSort,
} from "@/lib/svodka-ratings";
import type { MoneyCurrency } from "@/lib/clients";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Сводка — Onyx",
};

type SP = Record<string, string | string[] | undefined>;
function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

function MoneyLines({
  rows,
}: {
  rows: ReadonlyArray<{ currency: "UZS" | "USD"; amount: string; count: number }>;
}) {
  if (rows.length === 0) return <span className="text-ink/50">—</span>;
  return (
    <span className="tnum font-semibold text-ink">
      {rows.map((r, i) => (
        <span key={r.currency}>
          {i > 0 && " · "}
          {formatDebtMoney(r.amount, r.currency)}
        </span>
      ))}
    </span>
  );
}

const RATING_PAGE = 50;

/** Одна валюта — одна ячейка; ноль показываем прочерком. */
function MoneyCell({ amount, currency }: { amount: string; currency: MoneyCurrency }) {
  const zero = Number(amount) === 0;
  return (
    <td className="tnum whitespace-nowrap py-2 pl-3 text-right">
      {zero ? <span className="text-ink/35">—</span> : formatDebtMoney(amount, currency)}
    </td>
  );
}

function AreaCell({ areaM2 }: { areaM2: string }) {
  const n = Number(areaM2);
  return (
    <td className="tnum whitespace-nowrap py-2 pl-3 text-right">
      {n > 0 ? (
        n.toFixed(3).replace(/\.?0+$/, "").replace(".", ",")
      ) : (
        <span className="text-ink/35">—</span>
      )}
    </td>
  );
}

/** Долг — текущий, по валютам раздельно (строка на валюту). */
function DebtCell({ debt }: { debt: PerCurrency }) {
  const parts = (["UZS", "USD"] as const).filter((c) => Number(debt[c]) > 0);
  return (
    <td className="tnum whitespace-nowrap py-2 pl-3 text-right">
      {parts.length === 0 ? (
        <span className="text-ink/35">—</span>
      ) : (
        parts.map((c) => (
          <span key={c} className="block font-semibold text-danger">
            {formatDebtMoney(debt[c], c)}
          </span>
        ))
      )}
    </td>
  );
}

function periodCaption(p: RatingPeriod): string {
  if (!p.fromISO || !p.toISO) return "за всё время";
  return `${p.fromISO} — ${p.toISO} (Asia/Tashkent)`;
}

type HrefWith = (over: Record<string, string | null>) => string;

function Chip({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={buttonClass(active ? "primary" : "secondary", "sm")}
    >
      {children}
    </Link>
  );
}

function PeriodSwitch({ period, hrefWith }: { period: RatingPeriod; hrefWith: HrefWith }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Период">
      {RATING_PERIODS.map((p) => (
        <Chip
          key={p.key}
          href={hrefWith({ p: p.key === "month" ? null : p.key, all: null })}
          active={period.key === p.key}
        >
          {p.label}
        </Chip>
      ))}
    </div>
  );
}

const SORT_LABELS: Record<RatingSort, string> = {
  amount: "По сумме",
  area: "По м²",
  count: "По числу продаж",
};

function RatingSection({
  rows,
  period,
  sort,
  currency,
  showAll,
  scopeOwn,
  hrefWith,
}: {
  rows: ClientRatingRow[];
  period: RatingPeriod;
  sort: RatingSort;
  currency: MoneyCurrency;
  showAll: boolean;
  scopeOwn: boolean;
  hrefWith: HrefWith;
}) {
  const visible = showAll ? rows : rows.slice(0, RATING_PAGE);
  return (
    <section id="reyting" className="mb-6 scroll-mt-4">
      <h2 className="mb-2 text-lg font-semibold text-ink">
        Рейтинг клиентов{" "}
        <Link href="/klienty" className="text-sm font-normal text-gold-deep underline">
          справочник →
        </Link>
      </h2>
      <Card className="mb-3 flex flex-col gap-3">
        <PeriodSwitch period={period} hrefWith={hrefWith} />
        <div className="flex flex-wrap gap-2" role="group" aria-label="Сортировка">
          {(Object.keys(SORT_LABELS) as RatingSort[]).map((k) => (
            <Chip key={k} href={hrefWith({ sort: k === "amount" ? null : k })} active={sort === k}>
              {SORT_LABELS[k]}
            </Chip>
          ))}
        </div>
        {sort === "amount" && (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Валюта">
            <span className="text-sm text-ink/60">Сортировать по сумме в:</span>
            <Chip href={hrefWith({ cur: null })} active={currency === "UZS"}>
              сум
            </Chip>
            <Chip href={hrefWith({ cur: "USD" })} active={currency === "USD"}>
              $
            </Chip>
          </div>
        )}
        <p className="text-xs text-ink/50">
          Период: {periodCaption(period)}.{scopeOwn ? " Только ваши клиенты." : ""} Возвраты
          не входят; сум и $ не складываются. Долг — текущий остаток.
        </p>
      </Card>
      {rows.length === 0 ? (
        <p className="text-sm text-ink/55">Нет продаж клиентам за период.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-card border border-line bg-paper">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink/60">
                  <th className="py-2 pl-3 text-right font-medium">#</th>
                  <th className="py-2 pl-3 font-medium">Клиент</th>
                  <th className="py-2 pl-3 font-medium">Тип</th>
                  <th className="py-2 pl-3 text-right font-medium">Сумма, сум</th>
                  <th className="py-2 pl-3 text-right font-medium">Сумма, $</th>
                  <th className="py-2 pl-3 text-right font-medium">м²</th>
                  <th className="py-2 pl-3 text-right font-medium">Продаж</th>
                  <th className="py-2 px-3 text-right font-medium">Долг</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.clientId} className="border-b border-line/60 align-top last:border-b-0">
                    <td className="tnum py-2 pl-3 text-right text-ink/45">{r.place}</td>
                    <td className="py-2 pl-3">
                      <Link
                        href={`/klienty/${r.clientId}`}
                        className="font-semibold text-gold-deep underline"
                      >
                        {r.name}
                      </Link>
                    </td>
                    <td className="py-2 pl-3">
                      {r.type ? (
                        <Badge variant="neutral">{CLIENT_TYPE_LABELS[r.type]}</Badge>
                      ) : (
                        "—"
                      )}
                    </td>
                    <MoneyCell amount={r.sold.UZS} currency="UZS" />
                    <MoneyCell amount={r.sold.USD} currency="USD" />
                    <AreaCell areaM2={r.areaM2} />
                    <td className="tnum py-2 pl-3 text-right">{r.saleCount}</td>
                    <DebtCell debt={r.debt} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-sm text-ink/55">
            Клиентов: {rows.length}
            {!showAll && rows.length > RATING_PAGE && (
              <>
                {" · "}
                <Link href={hrefWith({ all: "1" })} className="text-gold-deep underline">
                  показать всех
                </Link>
              </>
            )}
          </p>
        </>
      )}
    </section>
  );
}

function ManagersSection({ rows, period }: { rows: ManagerSalesRow[]; period: RatingPeriod }) {
  return (
    <section className="mb-6">
      <h2 className="mb-1 text-lg font-semibold text-ink">Продажи по менеджерам</h2>
      <p className="mb-2 text-xs text-ink/50">
        Период: {periodCaption(period)} (переключатель — в рейтинге выше). «Сумма» — продажи
        периода без возвратов; «Собрано» — платежи за период минус возвраты денег, по продажам
        менеджера; продажа в долг попадает в «собрано» по мере оплаты.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-ink/55">Нет продаж и платежей за период.</p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-line bg-paper">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink/60">
                <th className="py-2 pl-3 font-medium">Менеджер</th>
                <th className="py-2 pl-3 text-right font-medium">Продаж</th>
                <th className="py-2 pl-3 text-right font-medium">Сумма, сум</th>
                <th className="py-2 pl-3 text-right font-medium">Сумма, $</th>
                <th className="py-2 pl-3 text-right font-medium">Собрано, сум</th>
                <th className="py-2 pl-3 text-right font-medium">Собрано, $</th>
                <th className="py-2 pl-3 text-right font-medium">м²</th>
                <th className="py-2 px-3 text-right font-medium">Долг клиентов</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.managerId} className="border-b border-line/60 align-top last:border-b-0">
                  <td className="py-2 pl-3 font-semibold text-ink">
                    {r.name}
                    {!r.isActive && (
                      <Badge variant="neutral" className="ml-2">
                        неактивен
                      </Badge>
                    )}
                  </td>
                  <td className="tnum py-2 pl-3 text-right">{r.saleCount}</td>
                  <MoneyCell amount={r.sold.UZS} currency="UZS" />
                  <MoneyCell amount={r.sold.USD} currency="USD" />
                  <MoneyCell amount={r.collected.UZS} currency="UZS" />
                  <MoneyCell amount={r.collected.USD} currency="USD" />
                  <AreaCell areaM2={r.areaM2} />
                  <DebtCell debt={r.debt} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** ТЗ №20 H (§9.3) — «Чаще всего сканируют»: топ-10 кодов за период. */
function TopScansSection({ rows, period }: { rows: TopScanRow[]; period: RatingPeriod }) {
  return (
    <section className="mb-6">
      <h2 className="mb-1 text-lg font-semibold text-ink">Чаще всего сканируют</h2>
      <p className="mb-2 text-xs text-ink/50">
        Период: {periodCaption(period)} (переключатель — в рейтинге выше). Открытия
        карточки по QR клиентами и партнёрами; сотрудники не считаются.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-ink/55">За период карточки по QR не открывали.</p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-line bg-paper">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink/60">
                <th className="py-2 pl-3 font-medium">#</th>
                <th className="py-2 pl-3 font-medium">Камень</th>
                <th className="py-2 pl-3 font-medium">Код</th>
                <th className="py-2 px-3 text-right font-medium">Открытий</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.code} className="border-b border-line/60 last:border-b-0">
                  <td className="tnum py-2 pl-3 text-ink/45">{i + 1}</td>
                  <td className="py-2 pl-3">
                    <Link
                      href={`/kamen/${r.stoneTypeId}`}
                      className="font-semibold text-gold-deep underline"
                    >
                      {r.stoneName}
                    </Link>
                    {r.kind && r.kind !== "STONE_TYPE" && (
                      <span className="ml-2 text-ink/55">{STONE_CODE_KIND_RU[r.kind]}</span>
                    )}
                  </td>
                  <td className="tnum py-2 pl-3">
                    <Link href={`/k/${r.code}`} className="text-gold-deep underline">
                      {r.code}
                    </Link>
                  </td>
                  <td className="tnum py-2 px-3 text-right font-semibold">{r.scans}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default async function SvodkaPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const caps = await getCapabilities();
  // ТЗ №20 §15: рейтинг клиентов — владелец (все) и менеджер (свои клиенты);
  // всё остальное в «Сводке» (выручка, B2B/B2C, объекты, продажи по
  // менеджерам) — только владелец (canSeeHistory).
  if (!caps.canSeeClients) {
    return (
      <main className="mx-auto max-w-3xl p-4 pb-12 sm:p-8">
        <NoAccess />
      </main>
    );
  }
  const isOwner = caps.canSeeHistory;

  const sp = await searchParams;
  const fromQ = first(sp.from);
  const toQ = first(sp.to);

  // ТЗ №20 E — общий переключатель периода для рейтинга и блока менеджеров.
  const ratingPeriod = resolveRatingPeriod(parseRatingPeriodKey(first(sp.p)));
  const sort = parseRatingSort(first(sp.sort));
  const currency = parseRatingCurrency(first(sp.cur));
  const showAll = first(sp.all) === "1";
  const actorId = await currentActorId();

  const [rating, managerRows, topScans] = await Promise.all([
    loadClientRating(db, {
      period: ratingPeriod,
      sort,
      currency,
      canSeeAllClients: caps.canSeeAllClients,
      actorId,
    }),
    isOwner
      ? loadManagerSales(db, { period: ratingPeriod })
      : Promise.resolve([] as ManagerSalesRow[]),
    // ТЗ №20 §15 — топ сканирований видит только владелец.
    isOwner ? loadTopScans(db, ratingPeriod) : Promise.resolve([] as TopScanRow[]),
  ]);

  // Ссылки переключателей сохраняют все прочие параметры страницы.
  const hrefWith = (over: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const base: Record<string, string> = {
      from: fromQ,
      to: toQ,
      p: ratingPeriod.key === "month" ? "" : ratingPeriod.key,
      sort: sort === "amount" ? "" : sort,
      cur: currency === "UZS" ? "" : currency,
      all: showAll ? "1" : "",
    };
    for (const [k, v] of Object.entries({ ...base, ...over })) {
      if (v) q.set(k, v);
    }
    const s = q.toString();
    return `/svodka${s ? `?${s}` : ""}#reyting`;
  };

  const ratingProps = {
    rows: rating,
    period: ratingPeriod,
    sort,
    currency,
    showAll,
    scopeOwn: !caps.canSeeAllClients,
    hrefWith,
  };

  if (!isOwner) {
    return (
      <main className="mx-auto max-w-3xl p-4 pb-12 sm:p-8">
        <header className="mb-4">
          <h1 className="text-2xl font-bold text-ink">Сводка</h1>
          <p className="mt-1 text-sm text-ink/60">
            Рейтинг ваших клиентов. Возвраты не входят. UZS и USD — отдельно.
          </p>
        </header>
        <RatingSection {...ratingProps} />
      </main>
    );
  }

  const summary = await loadOwnerSummary(db, {
    fromISO: fromQ,
    toISO: toQ,
  });
  const { period, topSites, segments, grandTotals, saleCount } = summary;

  return (
    <main className="mx-auto max-w-3xl p-4 pb-12 sm:p-8">
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-ink">Сводка владельца</h1>
        <p className="mt-1 text-sm text-ink/60">
          Топы и B2B/B2C за период. Возвраты не входят. UZS и USD — отдельно.
        </p>
      </header>

      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3">
          <Field id="from" label="С">
            <input
              type="date"
              id="from"
              name="from"
              defaultValue={period.fromISO}
              className={inputClass}
            />
          </Field>
          <Field id="to" label="По">
            <input
              type="date"
              id="to"
              name="to"
              defaultValue={period.toISO}
              className={inputClass}
            />
          </Field>
          {/* Переключатели рейтинга не теряются при смене дат. */}
          {ratingPeriod.key !== "month" && (
            <input type="hidden" name="p" value={ratingPeriod.key} />
          )}
          {sort !== "amount" && <input type="hidden" name="sort" value={sort} />}
          {currency !== "UZS" && <input type="hidden" name="cur" value={currency} />}
          <Button type="submit">Показать</Button>
        </form>
        <p className="mt-2 text-xs text-ink/50">
          Период: {period.fromISO} — {period.toISO} (Asia/Tashkent). По
          умолчанию — текущий месяц.
        </p>
      </Card>

      <Card className="mb-4">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-[0.06em] text-gold-deep">
          Выручка периода
        </h2>
        <p className="text-lg">
          <MoneyLines rows={grandTotals} />
        </p>
        <p className="mt-1 text-sm text-ink/60">Продаж (без возвратов): {saleCount}</p>
      </Card>

      <section className="mb-6">
        <h2 className="mb-2 text-lg font-semibold text-ink">B2B vs B2C</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Card>
            <h3 className="font-semibold text-ink">
              B2B{" "}
              <span className="text-sm font-normal text-ink/55">
                (компания или объект)
              </span>
            </h3>
            <p className="mt-1">
              <MoneyLines rows={segments.b2b.totals} />
            </p>
            <p className="mt-1 text-sm text-ink/65">
              {formatVolumeLine(segments.b2b.volume) ?? "объём: —"} ·{" "}
              {segments.b2b.volume.saleCount} продаж
            </p>
          </Card>
          <Card>
            <h3 className="font-semibold text-ink">
              B2C{" "}
              <span className="text-sm font-normal text-ink/55">
                (частные без объекта)
              </span>
            </h3>
            <p className="mt-1">
              <MoneyLines rows={segments.b2c.totals} />
            </p>
            <p className="mt-1 text-sm text-ink/65">
              {formatVolumeLine(segments.b2c.volume) ?? "объём: —"} ·{" "}
              {segments.b2c.volume.saleCount} продаж
            </p>
          </Card>
        </div>
        {segments.unlinked.volume.saleCount > 0 && (
          <p className="mt-2 text-sm text-ink/55">
            Без карточки клиента:{" "}
            <MoneyLines rows={segments.unlinked.totals} /> ·{" "}
            {segments.unlinked.volume.saleCount} продаж (не в B2B/B2C)
          </p>
        )}
      </section>

      <RatingSection {...ratingProps} />

      <ManagersSection rows={managerRows} period={ratingPeriod} />

      <TopScansSection rows={topScans} period={ratingPeriod} />

      <section className="mb-6">
        <h2 className="mb-2 text-lg font-semibold text-ink">
          Топ объектов{" "}
          <Link href="/obekty" className="text-sm font-normal text-gold-deep underline">
            все →
          </Link>
        </h2>
        {topSites.length === 0 ? (
          <p className="text-sm text-ink/55">
            Нет продаж с привязкой к объекту за период.
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {topSites.map((s, i) => (
              <li
                key={s.siteId}
                className="rounded-card border border-line bg-paper p-3 text-sm"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span>
                    <span className="text-ink/45">{i + 1}. </span>
                    <Link
                      href={`/obekty/${s.siteId}`}
                      className="font-semibold text-gold-deep underline"
                    >
                      {s.name}
                    </Link>
                    {s.clientName && (
                      <span className="ml-2 text-ink/55">{s.clientName}</span>
                    )}
                  </span>
                  <MoneyLines rows={s.totals} />
                </div>
                <p className="mt-1 text-ink/55">
                  {s.saleCount} продаж
                  {formatVolumeLine(s.volume)
                    ? ` · ${formatVolumeLine(s.volume)}`
                    : ""}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <p className="text-center text-xs text-ink/45">
        {formatCurrencySummaryLine(grandTotals)
          ? "Суммы пересчитываются из продаж; возврат уменьшает итоги."
          : "Нет данных за выбранный период."}
      </p>
    </main>
  );
}
