// TZ №15 Slice 1 — warehouse «Отгрузки»: open queue + archive + confirm.
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getCapabilities, currentActorId } from "@/lib/session";
import { formatTashkentDate, formatTashkentDateTime } from "@/lib/datetime";
import {
  listShipmentsPage,
  SHIPMENTS_PAGE_SIZE,
  shipmentFiltersActive,
  shipmentFiltersFromSearchParams,
  formatShipmentPlan,
} from "@/lib/shipments";
import NoAccess from "@/components/NoAccess";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button, { buttonClass } from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import Field, { inputClass } from "@/components/ui/Field";
import {
  acceptSaleReturnAction,
  confirmShipmentAction,
  toggleShipmentUrgentAction,
  updateShipmentPlanAction,
} from "./actions";
import {
  formatReturnQty,
  listPendingSaleReturns,
  parseReturnParts,
} from "@/lib/sale-returns";
import { formatLocation } from "@/lib/locations";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Отгрузки — Onyx" };

type SP = Record<string, string | string[] | undefined>;
function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

export default async function OtgruzkiPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const caps = await getCapabilities();
  // Server-side gate (nav is cosmetic only).
  if (!caps.canSeeShipments) {
    return (
      <main className="mx-auto max-w-3xl p-4 pb-12 sm:p-8">
        <NoAccess />
      </main>
    );
  }

  const sp = await searchParams;
  const tab = first(sp.tab) === "archive" ? "archive" : "open";
  const ok = first(sp.ok);
  const err = first(sp.err);
  const actorId = await currentActorId();
  // OWNER + WAREHOUSE see all (canConfirmShipment); MANAGER own managerId only.
  // Do not use canSeeHistory alone — managers lack it, warehouse has confirm.
  const canSeeAll = caps.canConfirmShipment || caps.canSeeAllClients;

  // ТЗ №15 §3.2/§7.7 — поиск/фильтр по клиенту, типу, дате, менеджеру.
  const filters = shipmentFiltersFromSearchParams({
    client: first(sp.client),
    kind: first(sp.kind),
    from: first(sp.from),
    to: first(sp.to),
    manager: first(sp.manager),
    today: first(sp.today),
  });
  const filtersOn = shipmentFiltersActive(filters);
  // W3-T5 — keyset-курсор (isUrgent+createdAt+id). Раньше архив обрывался на
  // «последних 100» без всякой ссылки дальше.
  const after = first(sp.after) || null;

  const page = await listShipmentsPage(db, {
    canSeeAll,
    actorId,
    tab,
    filters,
    cursor: after,
    pageSize: SHIPMENTS_PAGE_SIZE,
  });
  const items = page.items;

  // Ссылка «Показать ещё» несёт вкладку и все фильтры: следующая страница —
  // продолжение ТОГО ЖЕ отфильтрованного списка.
  const buildHref = (over: { after?: string }) => {
    const p = new URLSearchParams();
    if (tab === "archive") p.set("tab", "archive");
    if (filters.client?.trim()) p.set("client", filters.client.trim());
    if (filters.kind) p.set("kind", filters.kind);
    if (first(sp.from)) p.set("from", first(sp.from));
    if (first(sp.to)) p.set("to", first(sp.to));
    if (canSeeAll && filters.managerId?.trim()) {
      p.set("manager", filters.managerId.trim());
    }
    if (over.after) p.set("after", over.after);
    const s = p.toString();
    return "/otgruzki" + (s ? `?${s}` : "");
  };

  // ТЗ №20 F — возвраты, ждущие приёма складом (отгруженный камень едет назад).
  const pendingReturns =
    tab === "open"
      ? await listPendingSaleReturns(db, { managerId: canSeeAll ? null : actorId })
      : { rows: [], locationIds: [] };
  const returnLocs = new Map(
    (pendingReturns.locationIds.length
      ? await db.batchLocation.findMany({
          where: { id: { in: pendingReturns.locationIds } },
          select: { id: true, block: true, landmark: true },
        })
      : []
    ).map((l) => [l.id, formatLocation(l.block, l.landmark)]),
  );

  // Список менеджеров для фильтра — только тем, кто видит все отгрузки.
  // Ограничен: сотрудников десятки, не тысячи.
  const managers = canSeeAll
    ? await db.user.findMany({
        where: { isActive: true, role: { in: ["MANAGER", "OWNER"] } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
        take: 100,
      })
    : [];

  return (
    <main className="mx-auto max-w-3xl p-4 pb-12 sm:p-8">
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-ink">Отгрузки</h1>
        <p className="mt-1 text-sm text-ink/60">
          Продажа уже списала камень. Здесь — факт выдачи со склада.
        </p>
      </header>

      {ok === "shipped" && (
        <Alert variant="success" title="Готово" className="mb-3">
          Отгрузка подтверждена. Статус единицы на складе не менялся (уже
          продана).
        </Alert>
      )}
      {ok === "return" && (
        <Alert variant="success" title="Готово" className="mb-3">
          Возврат принят — камень снова в наличии.
        </Alert>
      )}
      {ok === "plan" && (
        <Alert variant="success" title="Готово" className="mb-3">
          Дата отгрузки сохранена.
        </Alert>
      )}
      {/* Фото не обязано ронять отгрузку: камень уже выдан физически. Неудача
          с картинкой — предупреждение, а не ошибка (ТЗ №15 §3.3). */}
      {first(sp.warn) && (
        <Alert variant="warning" title="Обратите внимание" className="mb-3">
          {first(sp.warn)}
        </Alert>
      )}
      {err && (
        <Alert variant="danger" title="Не удалось" className="mb-3">
          {err}
        </Alert>
      )}

      <div className="mb-4 flex gap-2">
        <Link
          href="/otgruzki"
          className={
            "rounded-field px-3 py-2 text-sm font-semibold " +
            (tab === "open"
              ? "bg-gold/20 text-ink"
              : "bg-paper-2 text-ink/60")
          }
        >
          К отгрузке
        </Link>
        {/* ТЗ №20 B — задачи с плановой датой сегодня. */}
        <Link
          href="/otgruzki?today=1"
          className={
            "rounded-field px-3 py-2 text-sm font-semibold " +
            (tab === "open" && filters.today
              ? "bg-gold/20 text-ink"
              : "bg-paper-2 text-ink/60")
          }
        >
          На сегодня
        </Link>
        <Link
          href="/otgruzki?tab=archive"
          className={
            "rounded-field px-3 py-2 text-sm font-semibold " +
            (tab === "archive"
              ? "bg-gold/20 text-ink"
              : "bg-paper-2 text-ink/60")
          }
        >
          Архив
        </Link>
      </div>

      {/* ТЗ №15 §3.2/§7.7 — поиск/фильтр: клиент, тип, дата, менеджер.
          GET-форма: фильтр остаётся в ссылке — её можно сохранить и переслать. */}
      <form method="get" className="mb-4">
        <input type="hidden" name="tab" value={tab} />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            id="f-client"
            name="client"
            label="Клиент"
            placeholder="имя содержит…"
            defaultValue={filters.client ?? ""}
          />
          <div>
            <label htmlFor="f-kind" className="mb-1 block text-sm text-ink/70">
              Тип
            </label>
            <select
              id="f-kind"
              name="kind"
              defaultValue={filters.kind ?? ""}
              className={inputClass}
            >
              <option value="">Все</option>
              <option value="SALE">Продажа</option>
              <option value="SAMPLE">Образец</option>
              <option value="SHOWROOM">Шоу-рум</option>
            </select>
          </div>
          <Field
            id="f-from"
            name="from"
            type="date"
            label="С даты"
            defaultValue={first(sp.from)}
          />
          <Field
            id="f-to"
            name="to"
            type="date"
            label="По дату"
            defaultValue={first(sp.to)}
          />
          {managers.length > 0 && (
            <div>
              <label
                htmlFor="f-manager"
                className="mb-1 block text-sm text-ink/70"
              >
                Менеджер
              </label>
              <select
                id="f-manager"
                name="manager"
                defaultValue={filters.managerId ?? ""}
                className={inputClass}
              >
                <option value="">Все</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Button type="submit" variant="secondary" size="sm">
            Показать
          </Button>
          {filtersOn && (
            <Link
              href={tab === "archive" ? "/otgruzki?tab=archive" : "/otgruzki"}
              className="text-sm text-ink/60 underline"
            >
              Сбросить фильтр
            </Link>
          )}
        </div>
      </form>

      {pendingReturns.rows.length > 0 && (
        <section className="mb-4">
          <h2 className="mb-2 text-lg font-bold text-ink">Возвраты к приёму</h2>
          <ul className="flex flex-col gap-3">
            {pendingReturns.rows.map((r) => {
              const sale = r.saleRecord;
              const where = [
                ...new Set(
                  parseReturnParts(r.parts)
                    .filter((p) => p.shipped && p.batchLocationId)
                    .map((p) => returnLocs.get(p.batchLocationId!) ?? ""),
                ),
              ]
                .filter(Boolean)
                .join(", ");
              return (
                <li key={r.id}>
                  <Card className="border-gold/50">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-ink">
                          {sale.batch?.stoneType.name ?? "Камень"}
                          {sale.batchPattern ? ` · узор «${sale.batchPattern.description}»` : ""}
                        </p>
                        <p className="text-sm text-ink/70">
                          {sale.customerName}
                          {sale.site ? ` · ${sale.site.name}` : ""}
                        </p>
                        <p className="tnum text-sm text-ink">
                          Принять назад:{" "}
                          {formatReturnQty(r.pendingSlabs, Number(r.pendingAreaM2))}
                          {where ? ` · вернуть в ${where}` : ""}
                        </p>
                        <p className="text-sm text-ink/70">
                          {r.destination === "REMAINDER"
                            ? "Куда: в бой/остаток (куски, «проверить»)"
                            : "Куда: в тот же узор / то же место"}
                        </p>
                        {r.reason && (
                          <p className="text-sm text-ink/70">
                            <span className="text-ink/50">Причина:</span> {r.reason}
                          </p>
                        )}
                        <p className="mt-1 text-xs text-ink/55">
                          Возврат оформил {r.createdBy.name} ·{" "}
                          {formatTashkentDateTime(r.createdAt)}
                          {r.isFull ? " · полный возврат" : " · частичный возврат"}
                        </p>
                      </div>
                      <Badge variant="warning">Ждёт приёма</Badge>
                    </div>
                    {caps.canConfirmShipment && (
                      <form action={acceptSaleReturnAction} className="mt-3 border-t border-line pt-3">
                        <input type="hidden" name="saleReturnId" value={r.id} />
                        <Button type="submit" className="min-h-12 w-full sm:w-auto">
                          Принять возврат
                        </Button>
                      </form>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {items.length === 0 ? (
        <Card>
          <p className="text-ink/60">
            {tab === "open" ? "Нет задач к отгрузке." : "Архив пуст."}
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((s) => (
            <li key={s.id}>
              <Card className={s.planOverdue ? "border-danger/60 bg-danger/5" : undefined}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-ink">{s.stoneLabel}</p>
                      {s.isSample && (
                        <Badge variant="warning">ОБРАЗЕЦ</Badge>
                      )}
                      {s.isShowroom && (
                        <Badge variant="warning">ШОУ-РУМ</Badge>
                      )}
                      {/* ТЗ №15 §8.5 — клиент ждёт: задача идёт первой в очереди. */}
                      {s.isUrgent && <Badge variant="danger">СРОЧНО</Badge>}
                    </div>
                    <p className="text-sm text-ink/70">
                      {s.clientName ?? "—"}
                      {s.siteName ? ` · ${s.siteName}` : ""}
                    </p>
                    {/* ТЗ №20 B — «Заберут: 05.11, 10:00 · самовывоз»; в архиве
                        — план рядом с фактом выдачи (видно опоздания). */}
                    {formatShipmentPlan(s) && (
                      <p className={`text-sm ${s.planOverdue ? "font-semibold text-danger" : "text-ink/80"}`}>
                        {tab === "archive" ? "План" : "Заберут"}: {formatShipmentPlan(s)}
                        {s.planOverdue && " · просрочено"}
                        {tab === "archive" && s.completedAt && (
                          <> · выдано {formatTashkentDateTime(s.completedAt)}</>
                        )}
                      </p>
                    )}
                    {s.isSample && s.returnDueDate && (
                      <p className="text-sm text-ink/80">
                        Вернуть до {formatTashkentDate(s.returnDueDate)}
                      </p>
                    )}
                    {/* ТЗ №15 §3.1 — что выдать: габарит в см. */}
                    {s.gabarit && (
                      <p className="tnum text-sm text-ink/80">{s.gabarit}</p>
                    )}
                    {s.lines.length <= 1 && s.locationSnapshot && (
                      <p className="text-sm text-ink">{s.locationSnapshot}</p>
                    )}
                    {/* ТЗ №15 §3.1 — комментарий менеджера к задаче. */}
                    {s.note && (
                      <p className="mt-1 text-sm text-ink/70">
                        <span className="text-ink/50">Комментарий:</span>{" "}
                        {s.note}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-ink/55">
                      Менеджер {s.managerName}
                      {s.soldAt
                        ? ` · продажа ${formatTashkentDate(s.soldAt)}`
                        : s.isSample
                          ? " · образец"
                          : ""}
                      {" · "}
                      {formatTashkentDateTime(s.createdAt)}
                    </p>
                    {s.lines.length <= 1 &&
                      (s.qtyOrderedSlabs != null ||
                      s.qtyOrderedAreaM2 != null) && (
                      <p className="tnum text-sm text-ink/80">
                        Заказано:{" "}
                        {[
                          s.qtyOrderedSlabs != null &&
                            `${s.qtyOrderedSlabs} плит`,
                          s.qtyOrderedAreaM2 != null &&
                            `${s.qtyOrderedAreaM2} м²`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                        {(s.qtyShippedSlabs > 0 ||
                          s.qtyShippedAreaM2 > 0) && (
                          <>
                            {" "}
                            · отгружено:{" "}
                            {[
                              s.qtyShippedSlabs > 0 &&
                                `${s.qtyShippedSlabs} плит`,
                              s.qtyShippedAreaM2 > 0 &&
                                `${s.qtyShippedAreaM2} м²`,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </>
                        )}
                      </p>
                    )}
                  </div>
                  <Badge
                    variant={
                      s.status === "DONE"
                        ? "success"
                        : s.status === "PARTIAL"
                          ? "warning"
                          : s.status === "CANCELLED"
                            ? "neutral"
                            : "warning"
                    }
                  >
                    {s.statusLabel}
                  </Badge>
                </div>

                {/* ТЗ №15 §8.3 — накладная к товару: печатается со страницы. */}
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <Link
                    href={`/otgruzki/${s.id}`}
                    className="text-sm text-gold-deep underline"
                  >
                    Накладная →
                  </Link>
                  {/* ТЗ №20 B — менеджер может перенести дату отгрузки. */}
                  {caps.canSell && tab === "open" && s.kind === "SALE" && s.status !== "CANCELLED" && (
                    <details className="text-sm">
                      <summary className="cursor-pointer text-ink/60 underline">
                        {s.plannedAt ? "Изменить дату" : "Указать дату"}
                      </summary>
                      <form action={updateShipmentPlanAction} className="mt-2 flex flex-wrap items-end gap-2">
                        <input type="hidden" name="shipmentId" value={s.id} />
                        <input type="date" name="plannedDate" className={inputClass + " w-40"} />
                        <input type="time" name="plannedTime" className={inputClass + " w-28"} />
                        <select name="deliveryMode" className={inputClass + " w-44"} defaultValue={s.deliveryMode ?? ""}>
                          <option value="">не указано</option>
                          <option value="PICKUP">самовывоз</option>
                          <option value="DELIVERY">доставка на объект</option>
                        </select>
                        <Button type="submit" size="sm" variant="secondary">
                          Сохранить
                        </Button>
                      </form>
                    </details>
                  )}
                  {/* ТЗ №15 §8.5 — срочность ставит тот, кто говорит с клиентом. */}
                  {caps.canSell && tab === "open" && s.status !== "CANCELLED" && (
                    <form action={toggleShipmentUrgentAction}>
                      <input type="hidden" name="shipmentId" value={s.id} />
                      <input
                        type="hidden"
                        name="urgent"
                        value={s.isUrgent ? "0" : "1"}
                      />
                      <button
                        type="submit"
                        className="text-sm text-ink/60 underline"
                      >
                        {s.isUrgent ? "Снять «срочно»" : "Отметить срочной"}
                      </button>
                    </form>
                  )}
                </div>

                {/* ТЗ №19 C1 — продажа затронула два узора/места: строка на
                    каждое, складчик отмечает каждую отдельно. */}
                {s.lines.length > 1 && (
                  <ul className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
                    {s.lines.map((l) => (
                      <li
                        key={l.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-field border border-line p-2"
                      >
                        <div className="min-w-0 text-sm">
                          {l.patternLabel && (
                            <p className="font-medium text-ink">{l.patternLabel}</p>
                          )}
                          <p className="tnum text-ink/80">
                            {[
                              l.qtyOrderedSlabs != null && `${l.qtyOrderedSlabs} плит`,
                              l.qtyOrderedAreaM2 != null && `${l.qtyOrderedAreaM2} м²`,
                            ]
                              .filter(Boolean)
                              .join(" / ")}
                            {l.locationSnapshot ? ` · ${l.locationSnapshot}` : ""}
                          </p>
                        </div>
                        {l.fullyShipped ? (
                          <Badge variant="success">Отгружено</Badge>
                        ) : (
                          tab === "open" &&
                          caps.canConfirmShipment &&
                          s.status !== "CANCELLED" && (
                            <form action={confirmShipmentAction}>
                              <input type="hidden" name="shipmentId" value={s.id} />
                              <input type="hidden" name="lineId" value={l.id} />
                              <Button type="submit" size="sm">
                                Отгрузить строку
                              </Button>
                            </form>
                          )
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {tab === "open" &&
                  caps.canConfirmShipment &&
                  s.lines.length <= 1 &&
                  s.status !== "CANCELLED" && (
                    <form
                      action={confirmShipmentAction}
                      className="mt-3 border-t border-line pt-3"
                    >
                      <input type="hidden" name="shipmentId" value={s.id} />
                      {s.targetType === "BATCH_VOLUME" ? (
                        <div className="mb-2 grid grid-cols-2 gap-2">
                          <Field
                            id={`qs-${s.id}`}
                            name="qtySlabs"
                            inputMode="numeric"
                            label="Плит (пусто = весь остаток)"
                            placeholder={
                              s.qtyOrderedSlabs != null
                                ? String(
                                    Math.max(
                                      0,
                                      (s.qtyOrderedSlabs ?? 0) -
                                        s.qtyShippedSlabs,
                                    ),
                                  )
                                : ""
                            }
                            className={inputClass}
                          />
                          <Field
                            id={`qa-${s.id}`}
                            name="qtyAreaM2"
                            inputMode="decimal"
                            label="м² (пусто = весь остаток)"
                            className={inputClass}
                          />
                        </div>
                      ) : null}
                      {/* ТЗ №15 §3.3/§8.1 — фото факта отгрузки: «что именно
                          выдали» (сверка при спорах). Необязательное: без него
                          отгрузка записывается как обычно. */}
                      <label
                        htmlFor={`ph-${s.id}`}
                        className="mb-2 block text-sm text-ink/70"
                      >
                        Фото выдачи (необязательно)
                      </label>
                      <input
                        id={`ph-${s.id}`}
                        name="factPhoto"
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="mb-3 block w-full text-sm text-ink/70 file:mr-3 file:rounded-field file:border-0 file:bg-gold/15 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-gold-deep hover:file:bg-gold/25"
                      />
                      <Button type="submit" className="min-h-12 w-full sm:w-auto">
                        Отгрузить
                        {s.targetType === "BATCH_VOLUME"
                          ? " (полностью или частично)"
                          : ""}
                      </Button>
                    </form>
                  )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      {/* Инвариант /poisk: ссылка есть ровно тогда, когда есть следующая строка. */}
      {page.nextCursor && (
        <div className="mt-4">
          <Link
            href={buildHref({ after: page.nextCursor })}
            className={buttonClass("secondary", "sm")}
          >
            Показать ещё →
          </Link>
        </div>
      )}
    </main>
  );
}
