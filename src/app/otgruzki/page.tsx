// TZ №15 Slice 1 — warehouse «Отгрузки»: open queue + archive + confirm.
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getCapabilities, currentActorId } from "@/lib/session";
import { formatTashkentDate, formatTashkentDateTime } from "@/lib/datetime";
import {
  listShipments,
  MAX_SHIPMENTS_PAGE,
  shipmentFiltersActive,
  shipmentFiltersFromSearchParams,
} from "@/lib/shipments";
import NoAccess from "@/components/NoAccess";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import Field, { inputClass } from "@/components/ui/Field";
import {
  confirmShipmentAction,
  toggleShipmentUrgentAction,
} from "./actions";

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
  });
  const filtersOn = shipmentFiltersActive(filters);

  const items = await listShipments(db, {
    canSeeAll,
    actorId,
    tab,
    take: MAX_SHIPMENTS_PAGE,
    filters,
  });

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

      {items.length === 0 ? (
        <Card>
          <p className="text-ink/60">
            {tab === "open"
              ? "Нет задач к отгрузке."
              : "Архив пуст (показаны последние " +
                MAX_SHIPMENTS_PAGE +
                ")."}
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((s) => (
            <li key={s.id}>
              <Card>
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
                    {s.isSample && s.returnDueDate && (
                      <p className="text-sm text-ink/80">
                        Вернуть до {formatTashkentDate(s.returnDueDate)}
                      </p>
                    )}
                    {/* ТЗ №15 §3.1 — что выдать: габарит в см. */}
                    {s.gabarit && (
                      <p className="tnum text-sm text-ink/80">{s.gabarit}</p>
                    )}
                    {s.locationSnapshot && (
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
                    {(s.qtyOrderedSlabs != null ||
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

                {tab === "open" &&
                  caps.canConfirmShipment &&
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
    </main>
  );
}
