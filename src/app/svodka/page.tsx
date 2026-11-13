// TZ №10+11 §9 — сводка владельца: топ клиентов/объектов, B2B vs B2C, период.
// ТЗ №20 E — рейтинг клиентов (владелец — все, менеджер — свои) и «Продажи по
// менеджерам» (только владелец). UZS/USD никогда не смешиваются.

import { loadTopAiQueries, type TopAiQueryRow } from "@/lib/ai-search";
import { loadPartnerSummary, PARTNER_TYPE_RU, type PartnerSummaryRow } from "@/lib/partners";
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
  if (rows.length === 0) return <span className="text-ink-3">—</span>;
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

/** Итог-KPI: первая валюта 28px Medium, следующая — отдельной строкой 14px.
 *  Валюты не складываются. */
function KpiMoney({
  rows,
}: {
  rows: ReadonlyArray<{ currency: "UZS" | "USD"; amount: string; count: number }>;
}) {
  if (rows.length === 0) {
    return <p className="mt-1 text-[28px] font-medium leading-9 text-ink-3">—</p>;
  }
  return (
    <div className="mt-1">
      {rows.map((r, i) =>
        i === 0 ? (
          <p key={r.currency} className="tnum text-[28px] font-medium leading-9 text-ink">
            {formatDebtMoney(r.amount, r.currency)}
          </p>
        ) : (
          <p key={r.currency} className="tnum text-sm text-ink">
            {formatDebtMoney(r.amount, r.currency)}
          </p>
        ),
      )}
    </div>
  );
}

const RATING_PAGE = 50;

/** Одна валюта — одна ячейка; ноль показываем прочерком. */
function MoneyCell({ amount, currency }: { amount: string; currency: MoneyCurrency }) {
  const zero = Number(amount) === 0;
  return (
    <td className="tnum whitespace-nowrap py-2 pl-3 text-right">
      {zero ? <span className="text-ink-3">—</span> : formatDebtMoney(amount, currency)}
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
        <span className="text-ink-3">—</span>
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
        <span className="text-ink-3">—</span>
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

/** Переключатель периода/сортировки — дорожка stone-100, выбранный сегмент
 *  marble с рамкой line (ТЗ №20 §7.2), а не ряд чёрных кнопок. */
const SWITCH_TRACK = "flex w-fit max-w-full flex-wrap gap-1 rounded-field bg-stone-100 p-1";

type HrefWith = (over: Record<string, string | null>) => string;

function Chip({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={[
        "flex min-h-10 items-center rounded-[0.3125rem] border px-3 text-sm font-medium transition-colors duration-150 md:min-h-8",
        active
          ? "border-line bg-marble text-ink"
          : "border-transparent text-ink-2 hover:text-ink",
      ].join(" ")}
    >
      {children}
    </Link>
  );
}

function PeriodSwitch({ period, hrefWith }: { period: RatingPeriod; hrefWith: HrefWith }) {
  return (
    <div className={SWITCH_TRACK} role="group" aria-label="Период">
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
      <h2 className="mb-2 text-base font-semibold text-ink">
        Рейтинг клиентов{" "}
        <Link href="/klienty" className="text-sm font-normal text-gold-deep underline">
          справочник →
        </Link>
      </h2>
      <Card className="mb-3 flex flex-col gap-3">
        <PeriodSwitch period={period} hrefWith={hrefWith} />
        <div className={SWITCH_TRACK} role="group" aria-label="Сортировка">
          {(Object.keys(SORT_LABELS) as RatingSort[]).map((k) => (
            <Chip key={k} href={hrefWith({ sort: k === "amount" ? null : k })} active={sort === k}>
              {SORT_LABELS[k]}
            </Chip>
          ))}
        </div>
        {sort === "amount" && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-ink-2">Сортировать по сумме в:</span>
            <div className={SWITCH_TRACK} role="group" aria-label="Валюта">
            <Chip href={hrefWith({ cur: null })} active={currency === "UZS"}>
              сум
            </Chip>
            <Chip href={hrefWith({ cur: "USD" })} active={currency === "USD"}>
              $
            </Chip>
            </div>
          </div>
        )}
        <p className="text-xs text-ink-3">
          Период: {periodCaption(period)}.{scopeOwn ? " Только ваши клиенты." : ""} Возвраты
          не входят; сум и $ не складываются. Долг — текущий остаток.
        </p>
      </Card>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-2">Нет продаж клиентам за период.</p>
      ) : (
        <>
          <div className="onyx-table-wrap">
            <table className="onyx-table">
              <thead>
                <tr>
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
                  <tr key={r.clientId} className="align-top">
                    <td className="tnum py-2 pl-3 text-right text-ink-3">{r.place}</td>
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
          <p className="mt-2 text-sm text-ink-2">
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
      <h2 className="mb-1 text-base font-semibold text-ink">Продажи по менеджерам</h2>
      <p className="mb-2 text-xs text-ink-3">
        Период: {periodCaption(period)} (переключатель — в рейтинге выше). «Сумма» — продажи
        периода без возвратов; «Собрано» — платежи за период минус возвраты денег, по продажам
        менеджера; продажа в долг попадает в «собрано» по мере оплаты.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-2">Нет продаж и платежей за период.</p>
      ) : (
        <div className="onyx-table-wrap">
          <table className="onyx-table">
            <thead>
              <tr>
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
                <tr key={r.managerId} className="align-top">
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

/** ТЗ №20 K (§12.4) — что ищут через ИИ и чего нет на складе. */
function AiQueriesSection({
  data,
  period,
}: {
  data: { rows: TopAiQueryRow[]; photoCount: number; total: number };
  period: RatingPeriod;
}) {
  return (
    <section className="mb-6">
      <h2 className="mb-1 text-base font-semibold text-ink">ИИ-поиск: что ищут</h2>
      <p className="mb-2 text-xs text-ink-3">
        Период: {periodCaption(period)} (переключатель — в рейтинге выше). Запросов: {data.total}, из
        них по фото: {data.photoCount}. «Нет на складе» — в последний раз по запросу не нашлось
        камня в наличии.
      </p>
      {data.rows.length === 0 ? (
        <p className="text-sm text-ink-2">За период текстовых ИИ-запросов не было.</p>
      ) : (
        <div className="onyx-table-wrap">
          <table className="onyx-table">
            <thead>
              <tr>
                <th className="py-2 pl-3 font-medium">Запрос</th>
                <th className="py-2 pl-3 text-right font-medium">Раз</th>
                <th className="py-2 px-3 text-right font-medium">В наличии</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.query} className="align-top">
                  <td className="py-2 pl-3">
                    <Link
                      href={`/katalog?ai=${encodeURIComponent(r.query)}`}
                      className="text-ink hover:underline"
                    >
                      {r.query}
                    </Link>
                  </td>
                  <td className="tnum py-2 pl-3 text-right">{r.count}</td>
                  <td className="py-2 px-3 text-right">
                    {r.lastInStock > 0 ? (
                      <span className="tnum">{r.lastInStock}</span>
                    ) : (
                      <Badge variant="warning">нет на складе</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** ТЗ №20 L (§13.3) — «Партнёры»: заявки, интересы, продажи по заявкам. */
function PartnersSection({ rows, period }: { rows: PartnerSummaryRow[]; period: RatingPeriod }) {
  return (
    <section className="mb-6">
      <h2 className="mb-1 text-base font-semibold text-ink">Партнёры</h2>
      <p className="mb-2 text-xs text-ink-3">
        Период: {periodCaption(period)} (переключатель — в рейтинге выше). «Заявки» — заявки на
        объём; «Интересы» — просмотры карточек и скачанные текстуры; «Продажи» — оформленные из
        заявок партнёра (сумма без возвратов, сум и $ отдельно).
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-2">
          Партнёров пока нет —{" "}
          <Link href="/partnery" className="text-gold-deep underline">
            завести
          </Link>
          .
        </p>
      ) : (
        <div className="onyx-table-wrap">
          <table className="onyx-table">
            <thead>
              <tr>
                <th className="py-2 pl-3 font-medium">Партнёр</th>
                <th className="py-2 pl-3 text-right font-medium">Заявки</th>
                <th className="py-2 pl-3 text-right font-medium">Интересы</th>
                <th className="py-2 pl-3 text-right font-medium">Продажи</th>
                <th className="py-2 pl-3 text-right font-medium">Сумма, сум</th>
                <th className="py-2 px-3 text-right font-medium">Сумма, $</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.partnerId} className="align-top">
                  <td className="py-2 pl-3">
                    <Link
                      href={`/zayavki?partner=${encodeURIComponent(r.partnerId)}`}
                      className="font-semibold text-ink hover:underline"
                    >
                      {r.name}
                    </Link>
                    <span className="block text-xs text-ink-2">
                      {[r.type ? PARTNER_TYPE_RU[r.type] : null, r.managerName ? `менеджер: ${r.managerName}` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </td>
                  <td className="tnum py-2 pl-3 text-right">{r.requests}</td>
                  <td className="tnum py-2 pl-3 text-right">{r.interests}</td>
                  <td className="tnum py-2 pl-3 text-right">{r.sales}</td>
                  <MoneyCell amount={r.amountUzs.toFixed(2)} currency="UZS" />
                  <td className="tnum whitespace-nowrap py-2 px-3 text-right">
                    {r.amountUsd === 0 ? (
                      <span className="text-ink-3">—</span>
                    ) : (
                      formatDebtMoney(r.amountUsd.toFixed(2), "USD")
                    )}
                  </td>
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
      <h2 className="mb-1 text-base font-semibold text-ink">Чаще всего сканируют</h2>
      <p className="mb-2 text-xs text-ink-3">
        Период: {periodCaption(period)} (переключатель — в рейтинге выше). Открытия
        карточки по QR клиентами и партнёрами; сотрудники не считаются.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-2">За период карточки по QR не открывали.</p>
      ) : (
        <div className="onyx-table-wrap">
          <table className="onyx-table">
            <thead>
              <tr>
                <th className="py-2 pl-3 font-medium">#</th>
                <th className="py-2 pl-3 font-medium">Камень</th>
                <th className="py-2 pl-3 font-medium">Код</th>
                <th className="py-2 px-3 text-right font-medium">Открытий</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.code}>
                  <td className="tnum py-2 pl-3 text-ink-3">{i + 1}</td>
                  <td className="py-2 pl-3">
                    <Link
                      href={`/kamen/${r.stoneTypeId}`}
                      className="font-semibold text-gold-deep underline"
                    >
                      {r.stoneName}
                    </Link>
                    {r.kind && r.kind !== "STONE_TYPE" && (
                      <span className="ml-2 text-ink-2">{STONE_CODE_KIND_RU[r.kind]}</span>
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
      <main className="max-w-[1440px] p-4 pb-12 md:p-6 xl:p-8">
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

  const [rating, managerRows, topScans, partnerRows, aiQueries] = await Promise.all([
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
    // ТЗ №20 L (§13.3) — «Партнёры» — только владелец.
    isOwner
      ? loadPartnerSummary(db, { from: ratingPeriod.from, to: ratingPeriod.toExclusive })
      : Promise.resolve([] as PartnerSummaryRow[]),
    // ТЗ №20 K (§12.4, §15) — топ ИИ-запросов — только владелец.
    isOwner
      ? loadTopAiQueries(db, { from: ratingPeriod.from, to: ratingPeriod.toExclusive })
      : Promise.resolve({ rows: [] as TopAiQueryRow[], photoCount: 0, total: 0 }),
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
      <main className="max-w-[1440px] p-4 pb-12 md:p-6 xl:p-8">
        <header className="mb-4">
          <h1 className="text-display font-semibold text-ink">Сводка</h1>
          <p className="mt-1 text-sm text-ink-2">
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
    <main className="max-w-[1440px] p-4 pb-12 md:p-6 xl:p-8">
      <header className="mb-4">
        <h1 className="text-display font-semibold text-ink">Сводка владельца</h1>
        <p className="mt-1 text-sm text-ink-2">
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
        <p className="mt-2 text-xs text-ink-3">
          Период: {period.fromISO} — {period.toISO} (Asia/Tashkent). По
          умолчанию — текущий месяц.
        </p>
      </Card>

      {/* ТЗ №20 §7.5 / §8: ряд итоговых карточек — подпись 12px сверху,
          цифра 28px, вторая валюта отдельной строкой 14px. Только то, что
          система уже считает. */}
      <section className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card>
          <h2 className="text-xs font-medium text-ink-2">Выручка периода</h2>
          <KpiMoney rows={grandTotals} />
          <p className="mt-1 text-sm text-ink-2">Продаж (без возвратов): {saleCount}</p>
        </Card>
          <Card>
            <h3 className="text-xs font-medium text-ink-2">
              B2B{" "}
              <span className="font-normal">
                (компания или объект)
              </span>
            </h3>
            <KpiMoney rows={segments.b2b.totals} />
            <p className="mt-1 text-sm text-ink-2">
              {formatVolumeLine(segments.b2b.volume) ?? "объём: —"} ·{" "}
              {segments.b2b.volume.saleCount} продаж
            </p>
          </Card>
          <Card>
            <h3 className="text-xs font-medium text-ink-2">
              B2C{" "}
              <span className="font-normal">
                (частные без объекта)
              </span>
            </h3>
            <KpiMoney rows={segments.b2c.totals} />
            <p className="mt-1 text-sm text-ink-2">
              {formatVolumeLine(segments.b2c.volume) ?? "объём: —"} ·{" "}
              {segments.b2c.volume.saleCount} продаж
            </p>
          </Card>
        {segments.unlinked.volume.saleCount > 0 && (
          <p className="text-sm text-ink-2 sm:col-span-3">
            Без карточки клиента:{" "}
            <MoneyLines rows={segments.unlinked.totals} /> ·{" "}
            {segments.unlinked.volume.saleCount} продаж (не в B2B/B2C)
          </p>
        )}
      </section>

      <RatingSection {...ratingProps} />

      <ManagersSection rows={managerRows} period={ratingPeriod} />

      <TopScansSection rows={topScans} period={ratingPeriod} />

      <AiQueriesSection data={aiQueries} period={ratingPeriod} />

      <PartnersSection rows={partnerRows} period={ratingPeriod} />

      <section className="mb-6">
        <h2 className="mb-2 text-base font-semibold text-ink">
          Топ объектов{" "}
          <Link href="/obekty" className="text-sm font-normal text-gold-deep underline">
            все →
          </Link>
        </h2>
        {topSites.length === 0 ? (
          <p className="text-sm text-ink-2">
            Нет продаж с привязкой к объекту за период.
          </p>
        ) : (
          <div className="onyx-table-wrap">
            <table className="onyx-table">
              <thead>
                <tr>
                  <th className="py-2 pl-3 text-right">#</th>
                  <th className="py-2 pl-3">Объект</th>
                  <th className="hidden py-2 pl-3 sm:table-cell">Клиент</th>
                  <th className="py-2 pl-3 text-right">Сумма</th>
                  <th className="py-2 px-3 text-right">Продаж</th>
                </tr>
              </thead>
              <tbody>
                {topSites.map((s, i) => (
                  <tr key={s.siteId} className="align-top">
                    <td className="tnum py-2 pl-3 text-right text-ink-3">{i + 1}</td>
                    <td className="py-2 pl-3">
                      <Link
                        href={`/obekty/${s.siteId}`}
                        className="font-semibold text-gold-deep underline"
                      >
                        {s.name}
                      </Link>
                      {formatVolumeLine(s.volume) && (
                        <span className="tnum block text-ink-2">{formatVolumeLine(s.volume)}</span>
                      )}
                    </td>
                    <td className="hidden py-2 pl-3 text-ink-2 sm:table-cell">
                      {s.clientName ?? "—"}
                    </td>
                    <td className="py-2 pl-3 text-right">
                      <MoneyLines rows={s.totals} />
                    </td>
                    <td className="tnum py-2 px-3 text-right">{s.saleCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-center text-xs text-ink-3">
        {formatCurrencySummaryLine(grandTotals)
          ? "Суммы пересчитываются из продаж; возврат уменьшает итоги."
          : "Нет данных за выбранный период."}
      </p>
    </main>
  );
}
