// ТЗ №15 §8.2 — «Уведомление складчику в Telegram о новой задаче на отгрузку».
//
// ПОЧЕМУ ЭТОТ ФАЙЛ СУЩЕСТВУЕТ. `shipment-telegram-notify.ts` был написан
// целиком, с тестами — и не вызывался НИОТКУДА. Тесты зелёные, сборка зелёная,
// складчик о задачах не узнаёт. Здесь — единственная точка подключения:
// тонкая обёртка, которая подставляет реальные зависимости (БД + Telegram)
// и никогда не бросает наружу.
//
// ДВА ПРАВИЛА, КОТОРЫЕ ЛЕГКО НАРУШИТЬ:
//
//  1. Звать только ПОСЛЕ коммита транзакции. Отправка в Telegram — внешний
//     I/O: внутри $transaction она держит соединение открытым на время
//     сетевого запроса, а при откате транзакции сообщение уже улетело
//     («задача есть в чате, но её нет в базе»).
//
//  2. Не превращать сбой уведомления в сбой продажи. Камень уже продан,
//     запись создана, задача в очереди складчика видна на сайте. Если
//     Telegram недоступен — это повод залогировать, а не откатывать сделку
//     и показывать менеджеру ошибку. Очередь `/otgruzki` остаётся источником
//     правды; уведомление — ускоритель.

import { db } from "@/lib/db";
import { sendMessage } from "@/lib/telegram";
import {
  notifyWarehouseOfShipment,
  type NotifyWarehouseResult,
} from "@/lib/shipment-telegram-notify";

/**
 * Уведомить складчиков о новой задаче. Fire-and-forget: результат возвращается
 * для логов/UI, но ошибки уже проглочены.
 *
 * Идемпотентно на уровне модуля-адресата: повторный вызов не шлёт второе
 * сообщение тем, кому уже доставлено (MutationReceipt).
 */
export async function notifyWarehouseSafe(
  shipmentId: string,
  actorId: string | null,
): Promise<NotifyWarehouseResult | null> {
  const id = shipmentId?.trim();
  if (!id) return null;
  try {
    return await notifyWarehouseOfShipment(
      id,
      { actorId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deps описаны структурно; PrismaClient шире контракта
      { db: db as any, sendMessage },
    );
  } catch (e) {
    console.warn(
      "[shipment-notify] не удалось уведомить склад (задача в /otgruzki остаётся):",
      e,
    );
    return null;
  }
}
