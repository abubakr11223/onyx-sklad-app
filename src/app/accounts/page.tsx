// «Сотрудники» (OWN-03) — управление аккаунтами. ТОЛЬКО OWNER (canManageAccounts).
// Server component, force-dynamic. Ролевой гейт (defense-in-depth, как
// /karta-sklada / /istoriya): нет права → <NoAccess/>. Все мутации — server
// actions (accounts/actions.ts), которые ПОВТОРНО проверяют право на сервере.
//
// Список: имя, логин (email), роль (RU), статус. Действия: создать (MANAGER/
// WAREHOUSE), сменить роль (MANAGER↔WAREHOUSE), сбросить пароль, деактивировать
// (soft). OWNER — корневой аккаунт: его нельзя удалить/сменить роль; сам владелец
// может сменить СВОЙ пароль (после seed-дефолта).

import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getRealSessionUser } from "@/lib/session";
import { roleLabel } from "@/lib/role-labels";
import type { Role } from "@/lib/permissions";
import { CREATABLE_ROLES, MIN_PASSWORD_LENGTH } from "@/lib/accounts";
import {
  createAccount,
  deleteAccount,
  changeRole,
  resetPassword,
  changePhone,
  changeEmail,
  approveTelegramRequest,
  rejectTelegramRequest,
} from "./actions";
import NoAccess from "@/components/NoAccess";
import Card from "@/components/ui/Card";
import Field, { inputClass } from "@/components/ui/Field";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Сотрудники — Onyx",
};

// Коды ошибок/успеха из query (server actions редиректят сюда) → RU-баннер.
const ERROR_RU: Record<string, string> = {
  denied: "Недостаточно прав.",
  name: "Укажите имя сотрудника.",
  email: "Некорректный email (логин).",
  email_taken: "Такой логин уже занят.",
  password: `Пароль слишком короткий (минимум ${MIN_PASSWORD_LENGTH} символов).`,
  role: "Недопустимая роль.",
  phone: "Некорректный телефон (9–15 цифр).",
  phone_taken: "Этот телефон уже привязан к другому аккаунту.",
  notfound: "Аккаунт не найден.",
  owner_protected: "Этот аккаунт защищён (владелец).",
  self: "Нельзя деактивировать самого себя.",
  tg_taken: "Этот Telegram уже привязан к другому аккаунту.",
};

const OK_RU: Record<string, string> = {
  created: "Аккаунт создан.",
  deleted: "Аккаунт деактивирован.",
  role: "Роль обновлена.",
  password: "Пароль сброшен.",
  phone: "Телефон обновлён.",
  email: "Логин (email) обновлён.",
  tg_approved: "Заявка одобрена — доступ открыт, пользователю отправлено уведомление.",
  tg_rejected: "Заявка отклонена.",
};

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  // ⚠️ XAVFSIZLIK GATE'i — ПЕРВЫМ делом. ТОЛЬКО реальная сессия (getRealSessionUser),
  // а НЕ demo-shim. Демо-роль `onyx_demo_role=OWNER` больше НЕ открывает эту страницу.
  const me = await getRealSessionUser();
  if (!me || me.role !== "OWNER") {
    return (
      <main className="mx-auto max-w-3xl p-4 pb-12 sm:p-8">
        <NoAccess />
      </main>
    );
  }

  const sp = await searchParams;
  const okMsg = sp.ok ? OK_RU[sp.ok] : undefined;
  const errMsg = sp.error ? (ERROR_RU[sp.error] ?? "Не удалось выполнить действие.") : undefined;

  const users = await db.user.findMany({
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      phone: true,
    },
  });
  // Владелец сам есть в списке — его логин нужен для префилла блока «Мой аккаунт».
  const meRow = users.find((u) => u.id === me.id);

  // Onboarding — заявки на доступ через Telegram (PENDING): человек нажал /start
  // и поделился контактом, но телефон не привязан ни к одному аккаунту.
  const tgRequests = await db.telegramAccessRequest.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      username: true,
      phone: true,
      telegramId: true,
    },
  });

  return (
    <main className="mx-auto max-w-3xl p-4 pb-12 sm:p-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold-deep">
          Onyx · доступ
        </p>
        <h1 className="mt-2 font-serif text-display font-bold tracking-tight text-ink">
          Сотрудники
        </h1>
        <p className="mt-1 text-sm text-ink/60">
          Аккаунты для входа по логину: менеджеры и складчики. Владелец —
          корневой аккаунт.
        </p>
      </header>

      {/* ── Короткая инструкция для владельца (передача проекта) ── */}
      <details className="mb-6 rounded-card border border-line bg-paper-2 p-4">
        <summary className="cursor-pointer font-semibold text-ink">
          Как это работает — коротко
        </summary>
        <div className="mt-3 flex flex-col gap-3 text-sm text-ink/70">
          <p>
            Здесь вы заводите аккаунты для входа. Каждый сотрудник входит по
            своему <b>логину (email)</b> и <b>паролю</b>, которые задаёте вы.
          </p>
          <div>
            <p className="mb-1 font-medium text-ink">Роли:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <b>Менеджер</b> — продажи и поиск: видит камень, цены, брони,
                продаёт.
              </li>
              <li>
                <b>Складчик</b> — приёмка и разбивка на складе. Получает
                фотозапросы в <b>Telegram</b> — поэтому укажите ему{" "}
                <b>телефон</b> (по нему привязывается бот через /start).
              </li>
              <li>
                <b>Партнёр</b> — дизайнер/B2B: только заявки, без цен и склада.
              </li>
            </ul>
          </div>
          <div>
            <p className="mb-1 font-medium text-ink">Что можно делать:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <b>Добавить сотрудника</b> — блок «Новый аккаунт»: имя, логин,
                пароль (≥{MIN_PASSWORD_LENGTH} символов), роль, телефон.
              </li>
              <li>
                <b>Забыл пароль</b> — «Сбросить пароль» в его карточке. Поменять
                логин — «Сохранить логин».
              </li>
              <li>
                <b>Уволился</b> — «Деактивировать»: вход закрыт, история цела.
              </li>
              <li>
                <b>Свой логин и пароль</b> — блок «Мой аккаунт» вверху.
              </li>
            </ul>
          </div>
          <p className="text-ink/50">
            Эту страницу видит только владелец. Сотрудники сюда не заходят.
          </p>
        </div>
      </details>

      {okMsg && (
        <Alert variant="success" className="mb-4">
          {okMsg}
        </Alert>
      )}
      {errMsg && (
        <Alert variant="danger" className="mb-4">
          {errMsg}
        </Alert>
      )}

      {/* ── Мой аккаунт: владелец сам меняет свой логин и пароль (без разработчика) ── */}
      <Card className="mb-6">
        <h2 className="mb-1 font-serif text-xl font-bold text-ink">
          Мой аккаунт
        </h2>
        <p className="mb-4 text-sm text-ink/60">
          Ваш логин и пароль для входа. Меняйте прямо здесь — терминал и
          разработчик не нужны.
        </p>
        <div className="flex flex-col gap-3">
          <form action={changeEmail} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="userId" value={me.id} />
            <input
              type="email"
              name="email"
              defaultValue={meRow?.email ?? ""}
              placeholder="my@example.com"
              autoComplete="off"
              aria-label="Мой логин (email)"
              className={`${inputClass} sm:max-w-xs`}
              required
            />
            <Button type="submit" variant="secondary" size="sm">
              Сохранить логин
            </Button>
          </form>
          <form action={resetPassword} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="userId" value={me.id} />
            <input
              type="password"
              name="password"
              placeholder={`новый пароль (≥${MIN_PASSWORD_LENGTH})`}
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
              aria-label="Мой новый пароль"
              className={`${inputClass} sm:max-w-xs`}
            />
            <Button type="submit" variant="secondary" size="sm">
              Сменить пароль
            </Button>
          </form>
        </div>
      </Card>

      {/* ── Создать аккаунт ── */}
      <Card className="mb-6">
        <h2 className="mb-4 font-serif text-xl font-bold text-ink">
          Новый аккаунт
        </h2>
        <form action={createAccount} className="flex flex-col gap-4">
          <Field id="name" name="name" label="Имя" placeholder="Дилшод" required />
          <Field
            id="new-email"
            name="email"
            type="email"
            label="Логин (email)"
            placeholder="dilshod@example.com"
            autoComplete="off"
            required
          />
          <Field
            id="new-password"
            name="password"
            type="password"
            label="Пароль"
            placeholder={`минимум ${MIN_PASSWORD_LENGTH} символов`}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
          <Field id="new-role" name="role" label="Роль">
            <select
              id="new-role"
              name="role"
              defaultValue="MANAGER"
              className={inputClass}
            >
              {CREATABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r as Role)}
                </option>
              ))}
            </select>
          </Field>
          <Field
            id="new-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            label="Телефон"
            placeholder="+998 90 123 45 67"
            hint="Для складчика — по нему привязывается Telegram (/start). Необязательно."
            autoComplete="off"
          />
          <Button type="submit" className="w-full sm:w-auto">
            Создать аккаунт
          </Button>
        </form>
      </Card>

      {/* ── Заявки на доступ через Telegram (onboarding) ── */}
      {tgRequests.length > 0 && (
        <Card className="mb-6 border-gold/40">
          <h2 className="mb-1 font-serif text-xl font-bold text-ink">
            Заявки на доступ (Telegram)
          </h2>
          <p className="mb-4 text-sm text-ink/60">
            Человек нажал /start в боте и ждёт доступа. Выберите роль и одобрите —
            аккаунт создастся, а ему придёт уведомление в Telegram.
          </p>
          <ul className="space-y-3">
            {tgRequests.map((r) => (
              <li
                key={r.id}
                className="rounded-card border border-line bg-paper-2 p-3"
              >
                <p className="font-semibold text-ink">
                  {r.name ?? "без имени"}
                  {r.username && (
                    <span className="ml-2 text-sm font-normal text-ink/50">
                      @{r.username}
                    </span>
                  )}
                </p>
                <p className="tnum text-sm text-ink/60">
                  {r.phone ? <>📞 {r.phone}</> : "телефон не передан"}
                </p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
                  <form
                    action={approveTelegramRequest}
                    className="flex flex-wrap items-end gap-2"
                  >
                    <input type="hidden" name="requestId" value={r.id} />
                    <input
                      name="name"
                      defaultValue={r.name ?? ""}
                      placeholder="Имя"
                      required
                      aria-label="Имя сотрудника"
                      className={`${inputClass} sm:max-w-[10rem]`}
                    />
                    <select
                      name="role"
                      defaultValue="WAREHOUSE"
                      aria-label="Роль"
                      className={inputClass}
                    >
                      {CREATABLE_ROLES.map((rr) => (
                        <option key={rr} value={rr}>
                          {roleLabel(rr as Role)}
                        </option>
                      ))}
                    </select>
                    <Button type="submit" size="sm">
                      Одобрить
                    </Button>
                  </form>
                  <form action={rejectTelegramRequest}>
                    <input type="hidden" name="requestId" value={r.id} />
                    <Button type="submit" variant="danger" size="sm">
                      Отклонить
                    </Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ── Список аккаунтов ── */}
      <ul className="space-y-3">
        {users.map((u) => {
          const isOwner = u.role === "OWNER";
          const isSelf = u.id === me?.id;
          // Смена роли — только бинарный тумблер MANAGER↔WAREHOUSE (PARTNER в него
          // не входит: у него отдельный флоу заявок, а не складско-менеджерский).
          const isRoleToggleable =
            u.role === "MANAGER" || u.role === "WAREHOUSE";
          // Деактивация / сброс пароля — для любого НЕ-владельца (вкл. PARTNER,
          // A1): владелец должен уметь управлять созданными им партнёр-аккаунтами.
          const isManageable = !isOwner;
          const otherRole = u.role === "MANAGER" ? "WAREHOUSE" : "MANAGER";

          return (
            <li key={u.id}>
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">
                      {u.name}
                      {isSelf && (
                        <span className="ml-2 text-xs font-normal text-ink/50">
                          (это вы)
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-ink/60">
                      {u.email ?? "— нет логина —"}
                    </p>
                    <p className="text-sm">
                      {u.phone ? (
                        <span className="tnum text-ink/60">📞 {u.phone}</span>
                      ) : u.role === "WAREHOUSE" ? (
                        <span className="text-warning">
                          телефон не задан — Telegram не привяжется
                        </span>
                      ) : (
                        <span className="text-ink/40">телефон не задан</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="neutral">{roleLabel(u.role as Role)}</Badge>
                    {u.isActive ? (
                      <Badge variant="success">активен</Badge>
                    ) : (
                      <Badge variant="warning">деактивирован</Badge>
                    )}
                  </div>
                </div>

                {/* Действия — только для активных не-владельцев. Свой аккаунт
                    (владелец) управляется в блоке «Мой аккаунт» вверху. */}
                {u.isActive && isManageable && (
                  <div className="mt-4 flex flex-col gap-3 border-t border-ink/10 pt-4">
                    {/* Смена роли — только MANAGER↔WAREHOUSE. */}
                    {isRoleToggleable && (
                      <form
                        action={changeRole}
                        className="flex flex-wrap items-end gap-2"
                      >
                        <input type="hidden" name="userId" value={u.id} />
                        <input type="hidden" name="role" value={otherRole} />
                        <Button type="submit" variant="secondary" size="sm">
                          Сделать: {roleLabel(otherRole as Role)}
                        </Button>
                      </form>
                    )}

                    {/* Логин (email) — владелец правит любой не-владельческий. */}
                    <form
                      action={changeEmail}
                      className="flex flex-wrap items-end gap-2"
                    >
                      <input type="hidden" name="userId" value={u.id} />
                      <input
                        type="email"
                        name="email"
                        defaultValue={u.email ?? ""}
                        placeholder="dilshod@example.com"
                        autoComplete="off"
                        required
                        aria-label={`Логин (email) для ${u.name}`}
                        className={`${inputClass} sm:max-w-xs`}
                      />
                      <Button type="submit" variant="secondary" size="sm">
                        Сохранить логин
                      </Button>
                    </form>

                    {/* Сброс пароля сотрудника (если забыл). */}
                    <form
                      action={resetPassword}
                      className="flex flex-wrap items-end gap-2"
                    >
                      <input type="hidden" name="userId" value={u.id} />
                      <input
                        type="password"
                        name="password"
                        placeholder={`новый пароль (≥${MIN_PASSWORD_LENGTH})`}
                        autoComplete="new-password"
                        minLength={MIN_PASSWORD_LENGTH}
                        required
                        aria-label={`Новый пароль для ${u.name}`}
                        className={`${inputClass} sm:max-w-xs`}
                      />
                      <Button type="submit" variant="secondary" size="sm">
                        Сбросить пароль
                      </Button>
                    </form>

                    {/* Телефон — по нему складчик привязывает Telegram (/start).
                        Пусто + сохранить → телефон очищается. */}
                    {isManageable && (
                      <form
                        action={changePhone}
                        className="flex flex-wrap items-end gap-2"
                      >
                        <input type="hidden" name="userId" value={u.id} />
                        <input
                          type="tel"
                          name="phone"
                          inputMode="tel"
                          defaultValue={u.phone ?? ""}
                          placeholder="+998 90 123 45 67"
                          autoComplete="off"
                          aria-label={`Телефон для ${u.name}`}
                          className={`${inputClass} sm:max-w-xs`}
                        />
                        <Button type="submit" variant="secondary" size="sm">
                          Сохранить телефон
                        </Button>
                      </form>
                    )}

                    {/* Деактивация — только для не-владельцев и не себя. */}
                    {isManageable && !isSelf && (
                      <form action={deleteAccount}>
                        <input type="hidden" name="userId" value={u.id} />
                        <Button type="submit" variant="danger" size="sm">
                          Деактивировать
                        </Button>
                      </form>
                    )}
                  </div>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
