// TZ №10+11 §7 — раздел «Клиенты». Список + фильтры.
// Access: canSeeClients; data scope: canSeeAllClients / manager own.

import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getCapabilities, currentActorId } from "@/lib/session";
import {
  CLIENT_TYPE_LABELS,
  type ClientType,
} from "@/lib/clients";
import {
  CLIENTS_DIRECTORY_PAGE_SIZE,
  listClientsDirectoryPage,
} from "@/lib/clients-directory";
import { formatCurrencySummaryLine } from "@/lib/debts-ui";
import NoAccess from "@/components/NoAccess";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button, { buttonClass } from "@/components/ui/Button";
import Field, { inputClass } from "@/components/ui/Field";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Клиенты — Onyx",
};

type SP = Record<string, string | string[] | undefined>;
function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

export default async function KlientyPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const caps = await getCapabilities();
  if (!caps.canSeeClients) {
    return (
      <main className="mx-auto max-w-3xl p-4 pb-12 sm:p-8">
        <NoAccess />
      </main>
    );
  }

  const sp = await searchParams;
  const q = first(sp.q);
  const typeRaw = first(sp.type);
  const type =
    typeRaw === "B2C" || typeRaw === "B2B" ? (typeRaw as ClientType) : "";
  const managerId = first(sp.managerId);
  // W3-T5 — keyset-курсор страницы (name+id). Фильтры едут в ссылке вместе с ним.
  const after = first(sp.after) || null;
  const actorId = await currentActorId();

  const [page, managers] = await Promise.all([
    listClientsDirectoryPage(db, {
      q,
      type,
      managerId: caps.canSeeAllClients ? managerId : undefined,
      canSeeAllClients: caps.canSeeAllClients,
      actorId,
      cursor: after,
      pageSize: CLIENTS_DIRECTORY_PAGE_SIZE,
    }),
    caps.canSeeAllClients
      ? db.user.findMany({
          where: {
            isActive: true,
            role: { in: ["OWNER", "MANAGER"] },
          },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);

  const clients = page.items;

  // Ссылка «Показать ещё» несёт текущие фильтры: страница 2 обязана быть
  // страницей 2 ТОГО ЖЕ списка, а не всего справочника.
  const buildHref = (over: { after?: string }) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (type) p.set("type", type);
    if (caps.canSeeAllClients && managerId) p.set("managerId", managerId);
    if (over.after) p.set("after", over.after);
    const s = p.toString();
    return "/klienty" + (s ? `?${s}` : "");
  };

  return (
    <main className="mx-auto max-w-3xl p-4 pb-12 sm:p-8">
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-ink">Клиенты</h1>
        <p className="mt-1 text-sm text-ink/60">
          Справочник: продажи, долги, объекты. Суммы — по валютам отдельно.
        </p>
      </header>

      <Card className="mb-4">
        <form className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <Field id="q" label="Поиск" className="sm:min-w-[12rem] sm:flex-1">
            <input
              id="q"
              name="q"
              defaultValue={q}
              placeholder="Имя или телефон"
              className={inputClass}
            />
          </Field>
          <Field id="type" label="Тип">
            <select
              id="type"
              name="type"
              defaultValue={type}
              className={inputClass}
            >
              <option value="">Все</option>
              <option value="B2C">{CLIENT_TYPE_LABELS.B2C}</option>
              <option value="B2B">{CLIENT_TYPE_LABELS.B2B}</option>
            </select>
          </Field>
          {caps.canSeeAllClients && (
            <Field id="managerId" label="Менеджер">
              <select
                id="managerId"
                name="managerId"
                defaultValue={managerId}
                className={inputClass}
              >
                <option value="">Все</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Button type="submit" className="sm:mb-0.5">
            Найти
          </Button>
        </form>
      </Card>

      {clients.length === 0 ? (
        <AlertEmpty />
      ) : (
        <ul className="flex flex-col gap-2">
          {clients.map((c) => {
            const money = formatCurrencySummaryLine(c.purchaseTotals);
            const debt = formatCurrencySummaryLine(c.activeDebtTotals);
            return (
              <li key={c.id}>
                <Link
                  href={`/klienty/${c.id}`}
                  className="block rounded-card border border-line bg-paper p-3 shadow-card transition hover:border-gold"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <span className="font-semibold text-ink">{c.name}</span>
                      <Badge variant="neutral" className="ml-2 align-middle">
                        {CLIENT_TYPE_LABELS[c.type]}
                      </Badge>
                    </div>
                    <span className="text-sm text-ink/60">{c.phone}</span>
                  </div>
                  <p className="mt-1 text-sm text-ink/70">
                    Продаж: {c.saleCount}
                    {money && (
                      <>
                        {" · "}
                        <span className="tnum font-semibold text-ink">{money}</span>
                      </>
                    )}
                    {c.hasActiveDebt && (
                      <Badge variant="warning" className="ml-2 align-middle">
                        долг{debt ? `: ${debt}` : ""}
                      </Badge>
                    )}
                  </p>
                  {caps.canSeeAllClients && (
                    <p className="mt-0.5 text-xs text-ink/45">
                      Менеджер: {c.managerName}
                    </p>
                  )}
                </Link>
              </li>
            );
          })}
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

      <p className="mt-6 text-center text-sm">
        <Link href="/obekty" className={buttonClass("secondary", "sm")}>
          Перейти к объектам →
        </Link>
      </p>
    </main>
  );
}

function AlertEmpty() {
  return (
    <Card>
      <p className="text-sm text-ink/65">
        Клиентов не найдено. Они появятся при продаже (поиск или «+ Новый
        клиент»).
      </p>
    </Card>
  );
}
