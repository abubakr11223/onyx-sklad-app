// Аудит ТЗ №7 #10 — single-use для magic-link'ов. Хранилище — ConsumedMagicLinkToken
// (Postgres, UNIQUE @id по jti). Внешний KV не нужен: create → атомарный «взял
// slot», P2002 у второго попытки = replay → deny. Записи короткоживущие
// (expiresAt = сам exp токена, 2 мин) и лениво чистятся pruneExpiredMagicJti.

import { Prisma } from "@prisma/client";
import { db } from "./db";

export type ConsumeResult = "consumed" | "already_used" | "error";

/**
 * Помечает jti как истраченный. Возвращает:
 *  • "consumed"     — эта попытка первая, вход можно разрешать;
 *  • "already_used" — jti уже в таблице (replay в пределах 2-min окна) → deny;
 *  • "error"        — БД недоступна / неизвестная Prisma-ошибка → deny (fail-closed).
 *
 * НЕ throw'ает — вызывающий (login/tg route) уже в try/catch и работает через
 * failRedirect; типизированный результат делает поток очевидным.
 */
export async function consumeMagicLinkJti(
  jti: string,
  userId: string,
  expiresAt: Date,
): Promise<ConsumeResult> {
  try {
    await db.consumedMagicLinkToken.create({
      data: { jti, userId, expiresAt },
    });
    return "consumed";
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return "already_used";
    }
    console.error("[magic-link-store] consumeMagicLinkJti xatosi:", e);
    return "error";
  }
}

/**
 * Отдельная процедура очистки: удаляет ТОЛЬКО просроченные записи (expiresAt < now).
 * Дёргается лениво из login/tg маршрута — на очень редком трафике login'а это
 * дешевле любого cron'а; при появлении cron'а модуль подключается там же.
 * Возвращает число удалённых строк. Не throw'ает — только логирует ошибку.
 */
export async function pruneExpiredMagicJti(now: Date = new Date()): Promise<number> {
  try {
    const res = await db.consumedMagicLinkToken.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    return res.count;
  } catch (e) {
    console.error("[magic-link-store] pruneExpiredMagicJti xatosi:", e);
    return 0;
  }
}
