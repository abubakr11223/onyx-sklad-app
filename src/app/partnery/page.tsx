// ТЗ №20 L (§13.1) — «Партнёры»: дизайнеры, прорабы, подрядчики. Заводит
// владелец или менеджер (самостоятельной регистрации нет — партнёр видит
// остатки). Тип нужен для отчётов и фильтра «Заявок», права у всех одинаковые.
// Закреплённый менеджер получает в Telegram заявки и интересы партнёра.
import type { Metadata } from "next";
import Link from "next/link";
import type { PartnerType } from "@prisma/client";
import { db } from "@/lib/db";
import { getCapabilities } from "@/lib/session";
import { MIN_PASSWORD_LENGTH } from "@/lib/accounts";
import { PARTNER_TYPES, PARTNER_TYPE_RU, isPartnerType } from "@/lib/partners";
import { createPartner, resetPartnerPassword, setPartnerActive, updatePartner } from "./actions";
import NoAccess from "@/components/NoAccess";
import Card from "@/components/ui/Card";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Партнёры — Onyx" };

const ERROR_RU: Record<string, string> = {
  denied: "Недостаточно прав.",
  name: "Укажите имя.",
  email: "Неверный логин (email).",
  password: `Пароль — не короче ${MIN_PASSWORD_LENGTH} символов.`,
  phone: "Неверный телефон.",
  type: "Выберите тип партнёра.",
  manager: "Менеджер не найден или отключён.",
  email_taken: "Этот логин уже занят.",
  phone_taken: "Этот телефон уже у другого аккаунта.",
  notfound: "Партнёр не найден.",
};
const OK_RU: Record<string, string> = {
  created: "Партнёр заведён. Передайте ему логин и пароль.",
  updated: "Сохранено.",
  activated: "Партнёр снова может входить.",
  deactivated: "Партнёр отключён — вход закрыт.",
  password: "Пароль изменён.",
};

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function PartnersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const caps = await getCapabilities();
  if (!caps.canManagePartners) {
    return (
      <main className="max-w-[1440px] p-4 pb-12 md:p-6 xl:p-8">
        <NoAccess />
      </main>
    );
  }
  const sp = await searchParams;
  const ok = first(sp.ok);
  const error = first(sp.error);
  const typeRaw = first(sp.type) ?? "";
  const typeFilter: PartnerType | undefined = isPartnerType(typeRaw) ? typeRaw : undefined;

  const [partners, managers, reqCounts] = await Promise.all([
    db.user.findMany({
      where: { role: "PARTNER", ...(typeFilter ? { partnerType: typeFilter } : {}) },
      orderBy: [{ isActive: "desc" }, { name: "asc" }, { id: "asc" }],
      take: 500,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        isActive: true,
        partnerType: true,
        partnerManagerId: true,
        telegramId: true,
      },
    }),
    db.user.findMany({
      where: { isActive: true, role: { in: ["OWNER", "MANAGER"] } },
      orderBy: [{ role: "asc" }, { name: "asc" }],
      select: { id: true, name: true, role: true, telegramId: true },
    }),
    db.lead.groupBy({
      by: ["createdById"],
      where: { kind: "REQUEST", createdBy: { role: "PARTNER" } },
      _count: { _all: true },
    }),
  ]);
  const requests = new Map(reqCounts.map((r) => [r.createdById, r._count._all]));
  const managerName = new Map(managers.map((m) => [m.id, m.name]));

  const managerOptions = (
    <>
      <option value="">Не закреплён — уведомлять всех менеджеров</option>
      {managers.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
          {m.role === "OWNER" ? " (владелец)" : ""}
          {m.telegramId ? "" : " — без Telegram"}
        </option>
      ))}
    </>
  );

  return (
    <main className="max-w-[1440px] p-4 pb-12 md:p-6 xl:p-8">
      <header className="mb-6">
        <h1 className="text-display font-semibold text-ink">Партнёры</h1>
        <p className="mt-1 text-sm text-ink-2">
          Дизайнеры, прорабы и подрядчики. Партнёр видит каталог с остатками (плиты и м²),
          скачивает текстуры для 3D и оставляет заявки на объём — они приходят закреплённому
          менеджеру. Цен, клиентов и складских разделов партнёр не видит.
        </p>
      </header>

      {ok && OK_RU[ok] && (
        <Alert variant="success" className="mb-4">
          {OK_RU[ok]}
        </Alert>
      )}
      {error && (
        <Alert variant="danger" className="mb-4">
          {ERROR_RU[error] ?? "Не удалось выполнить действие."}
        </Alert>
      )}

      <details className="mb-6 rounded-card border border-line bg-marble p-4" open={partners.length === 0}>
        <summary className="cursor-pointer font-semibold text-ink">+ Завести партнёра</summary>
        <form action={createPartner} className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
            Имя / компания
            <input name="name" required maxLength={120} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
            Тип
            <select name="partnerType" defaultValue="DESIGNER" className={inputClass}>
              {PARTNER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PARTNER_TYPE_RU[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
            Логин (email)
            <input name="email" type="email" required autoComplete="off" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
            Пароль (не короче {MIN_PASSWORD_LENGTH})
            <input
              name="password"
              type="text"
              required
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
            Телефон (необязательно)
            <input name="phone" inputMode="tel" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
            Закреплённый менеджер
            <select name="managerId" defaultValue="" className={inputClass}>
              {managerOptions}
            </select>
          </label>
          <div className="sm:col-span-2">
            <Button type="submit">Завести партнёра</Button>
          </div>
        </form>
      </details>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm text-ink-2">
          Тип
          <select name="type" defaultValue={typeFilter ?? ""} className={inputClass}>
            <option value="">Все</option>
            {PARTNER_TYPES.map((t) => (
              <option key={t} value={t}>
                {PARTNER_TYPE_RU[t]}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="secondary" size="sm">
          Показать
        </Button>
      </form>

      {partners.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-2">Партнёров пока нет.</p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {partners.map((p) => (
            <li key={p.id} id={`p-${p.id}`}>
              <Card className={p.isActive ? "" : "opacity-70"}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">{p.name}</p>
                    <p className="text-sm text-ink-2">
                      {[p.email, p.phone].filter(Boolean).join(" · ")}
                    </p>
                    <p className="mt-1 text-xs text-ink-2">
                      Заявок: <span className="tnum">{requests.get(p.id) ?? 0}</span>
                      {" · "}
                      менеджер:{" "}
                      {p.partnerManagerId ? (managerName.get(p.partnerManagerId) ?? "отключён") : "все"}
                      {" · "}
                      <Link
                        href={`/zayavki?partner=${encodeURIComponent(p.id)}`}
                        className="text-gold-deep underline"
                      >
                        заявки
                      </Link>
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {p.partnerType && <Badge variant="neutral">{PARTNER_TYPE_RU[p.partnerType]}</Badge>}
                    {!p.isActive && <Badge variant="warning">отключён</Badge>}
                  </div>
                </div>

                <form action={updatePartner} className="mt-3 grid gap-2 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
                  <input type="hidden" name="id" value={p.id} />
                  <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
                    Тип
                    <select name="partnerType" defaultValue={p.partnerType ?? "DESIGNER"} className={inputClass}>
                      {PARTNER_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {PARTNER_TYPE_RU[t]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
                    Закреплённый менеджер
                    <select
                      name="managerId"
                      defaultValue={p.partnerManagerId && managerName.has(p.partnerManagerId) ? p.partnerManagerId : ""}
                      className={inputClass}
                    >
                      {managerOptions}
                    </select>
                  </label>
                  <Button type="submit" variant="secondary" size="sm">
                    Сохранить
                  </Button>
                </form>

                <div className="mt-3 flex flex-wrap items-start gap-2">
                  <form action={setPartnerActive}>
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="active" value={p.isActive ? "0" : "1"} />
                    <Button type="submit" variant={p.isActive ? "ghost" : "secondary"} size="sm">
                      {p.isActive ? "Отключить вход" : "Включить вход"}
                    </Button>
                  </form>
                  <details>
                    <summary className="cursor-pointer py-1.5 text-sm font-semibold text-gold-deep">
                      Новый пароль
                    </summary>
                    <form action={resetPartnerPassword} className="mt-2 flex flex-wrap gap-2">
                      <input type="hidden" name="id" value={p.id} />
                      <input
                        name="password"
                        type="text"
                        required
                        minLength={MIN_PASSWORD_LENGTH}
                        autoComplete="new-password"
                        placeholder={`Не короче ${MIN_PASSWORD_LENGTH}`}
                        className={inputClass}
                      />
                      <Button type="submit" size="sm">
                        Сменить
                      </Button>
                    </form>
                  </details>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
