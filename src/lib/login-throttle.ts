// Аудит 2026-08-10 — троттлинг неудачных входов на /login.
//
// ПРОБЛЕМА. `loginWithPassword` не ограничивал число попыток. Хеширование само
// по себе стойкое (PBKDF2, 100k итераций, timing-safe), но:
//   • пароль можно было подбирать бесконечно — время только от стойкости хеша;
//   • КАЖДАЯ попытка стоила серверу 100k итераций, то есть перебор был заодно
//     и дешёвым способом сжечь CPU функции (DoS).
//
// РЕШЕНИЕ. Счётчик неудач в БД (`LoginAttempt`) по двум ключам:
//   • email — защита конкретного аккаунта от подбора;
//   • ip    — защита от распыления по многим аккаунтам с одного адреса.
// При превышении порога вход отклоняется ДО вызова PBKDF2 — это и есть защита
// от CPU-нагрузки, а не только от подбора.
//
// ОСОЗНАННЫЙ РАЗМЕН (блокировка по email = вектор DoS на сотрудника): порог
// щедрый (10), окно короткое (15 мин), успешный вход СРАЗУ снимает счётчик.
// Худший случай для жертвы — подождать до конца окна; для атакующего — 10
// попыток за 15 минут вместо неограниченных.
//
// Модуль ЧИСТЫЙ в части решения (`decideThrottle`) — тестируется без БД;
// работа с БД тонкая и никогда не бросает исключение наружу.

import type { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";

/** Скользящее окно, в котором копятся неудачи. */
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/** Порог по конкретному аккаунту (email). */
export const LOGIN_MAX_FAILURES_EMAIL = 10;

/**
 * Порог по адресу. Выше, чем у email: за одним NAT/Wi-Fi может сидеть весь
 * склад, и общий внешний IP не должен блокировать смену пользователей.
 */
export const LOGIN_MAX_FAILURES_IP = 30;

/** Как долго строка живёт после последней неудачи (ленивая очистка). */
export const LOGIN_ATTEMPT_TTL_MS = 24 * 60 * 60 * 1000;

export type LoginScope = "email" | "ip";

export interface AttemptRow {
  failures: number;
  firstAt: Date;
}

/**
 * Чистое решение: блокировать ли попытку.
 *
 * Окно СКОЛЬЗИТ по `firstAt`: если с первой неудачи прошло больше окна, счётчик
 * считается протухшим и попытка разрешается (вызывающий начнёт счёт заново).
 * Это намеренно, а не «бан до конца суток»: сотрудник, набравший пароль
 * неверно утром, не должен быть заблокирован вечером.
 */
export function decideThrottle(args: {
  row: AttemptRow | null;
  now: Date;
  limit: number;
  windowMs?: number;
}): { blocked: boolean; retryAfterMs: number } {
  const windowMs = args.windowMs ?? LOGIN_WINDOW_MS;
  const row = args.row;
  if (!row) return { blocked: false, retryAfterMs: 0 };

  const elapsed = args.now.getTime() - row.firstAt.getTime();
  // Окно истекло — прошлые неудачи больше не считаются.
  if (elapsed >= windowMs) return { blocked: false, retryAfterMs: 0 };
  if (row.failures < args.limit) return { blocked: false, retryAfterMs: 0 };

  return { blocked: true, retryAfterMs: windowMs - elapsed };
}

/**
 * Счётчик после неудачи. Если окно истекло — начинаем с 1, иначе +1.
 * Чистая функция: вызывающий (БД-слой) применяет результат.
 */
export function nextFailureState(args: {
  row: AttemptRow | null;
  now: Date;
  windowMs?: number;
}): { failures: number; firstAt: Date } {
  const windowMs = args.windowMs ?? LOGIN_WINDOW_MS;
  const row = args.row;
  if (!row) return { failures: 1, firstAt: args.now };

  const elapsed = args.now.getTime() - row.firstAt.getTime();
  if (elapsed >= windowMs) return { failures: 1, firstAt: args.now };
  return { failures: row.failures + 1, firstAt: row.firstAt };
}

/** Порог для области. */
export function limitFor(scope: LoginScope): number {
  return scope === "email" ? LOGIN_MAX_FAILURES_EMAIL : LOGIN_MAX_FAILURES_IP;
}

type Db = Pick<PrismaClient, "loginAttempt">;

/**
 * Заблокирован ли ключ прямо сейчас.
 *
 * ⚠️ FAIL-OPEN. Если БД недоступна, вход РАЗРЕШАЕТСЯ (дальше всё равно нужна
 * проверка пароля, которая без БД не пройдёт). Обратный выбор — fail-closed —
 * означал бы, что сбой этой вспомогательной таблицы запирает весь склад;
 * для склада это хуже, чем временно снятый троттлинг.
 */
export async function isLoginBlocked(
  scope: LoginScope,
  key: string,
  now: Date = new Date(),
  database: Db = db,
): Promise<{ blocked: boolean; retryAfterMs: number }> {
  if (!key) return { blocked: false, retryAfterMs: 0 };
  try {
    const row = await database.loginAttempt.findUnique({
      where: { scope_key: { scope, key } },
      select: { failures: true, firstAt: true },
    });
    return decideThrottle({ row, now, limit: limitFor(scope) });
  } catch (e) {
    console.warn("[login-throttle] проверка не удалась — пропускаем:", e);
    return { blocked: false, retryAfterMs: 0 };
  }
}

/** Записать неудачную попытку. Никогда не бросает — вход и так уже отклонён. */
export async function recordLoginFailure(
  scope: LoginScope,
  key: string,
  now: Date = new Date(),
  database: Db = db,
): Promise<void> {
  if (!key) return;
  try {
    const row = await database.loginAttempt.findUnique({
      where: { scope_key: { scope, key } },
      select: { failures: true, firstAt: true },
    });
    const next = nextFailureState({ row, now });
    await database.loginAttempt.upsert({
      where: { scope_key: { scope, key } },
      create: {
        scope,
        key,
        failures: next.failures,
        firstAt: next.firstAt,
        lastAt: now,
      },
      update: { failures: next.failures, firstAt: next.firstAt, lastAt: now },
    });
  } catch (e) {
    console.warn("[login-throttle] запись неудачи не удалась:", e);
  }
}

/** Успешный вход снимает счётчик — сотрудник не ждёт конца окна. */
export async function clearLoginFailures(
  scope: LoginScope,
  key: string,
  database: Db = db,
): Promise<void> {
  if (!key) return;
  try {
    await database.loginAttempt.deleteMany({ where: { scope, key } });
  } catch (e) {
    console.warn("[login-throttle] сброс счётчика не удался:", e);
  }
}

/**
 * Ленивая очистка (как TelegramWebhookReceipt): таблица не растёт вечно.
 * Вызывается «в фоне» из маршрута логина, ошибки проглатываются.
 */
export async function pruneOldLoginAttempts(
  now: Date = new Date(),
  database: Db = db,
): Promise<number> {
  try {
    const res = await database.loginAttempt.deleteMany({
      where: { lastAt: { lt: new Date(now.getTime() - LOGIN_ATTEMPT_TTL_MS) } },
    });
    return res.count;
  } catch (e) {
    console.warn("[login-throttle] очистка не удалась:", e);
    return 0;
  }
}

/** Человеческое «попробуйте через N минут» (минимум 1). */
export function retryAfterMinutes(retryAfterMs: number): number {
  return Math.max(1, Math.ceil(retryAfterMs / 60_000));
}
