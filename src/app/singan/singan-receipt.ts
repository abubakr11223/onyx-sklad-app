// W3-T2 — идемпотентность «боя по фото» (MutationReceipt).
//
// Проблема: двойное касание кнопки «Сохранить» (или авто-повтор запроса на
// слабой сети) записывало ДВА куска и списывало ДВЕ плиты из партии — остаток
// уезжал, а складчик этого не видел. Отключённой кнопки мало: она защищает
// только одну вкладку и только при живом JS.
//
// Паттерн — тот же MutationReceipt, что у приёмки (lib/intake-receipt.ts).
// Отличие: приёмка пишет квитанцию ВНУТРИ своей транзакции, а здесь доменная
// запись живёт в registerDirectPiece (своя транзакция в lib/breaking.ts,
// трогать её не в этой задаче). Поэтому схема «заявка → запись → отметка»:
//
//   1. claimSinganPiece  — INSERT квитанции с ПУСТЫМ entityId («в работе»).
//      Дубль наткнётся на первичный ключ (P2002) и НЕ пойдёт писать кусок.
//   2. registerDirectPiece — доменная запись.
//   3. completeSinganPiece — в квитанцию проставляется pieceId и данные для
//      экрана успеха (повтор ссылки покажет тот же результат, без второго куска).
//   4. releaseSinganPiece — если доменная запись НЕ удалась (нет свободных плит
//      и т. п.), заявка снимается: иначе исправленный повтор с тем же
//      mutationId навсегда считался бы дублем и кусок не записался бы никогда.
//
// Модуль ЧИСТЫЙ относительно БД: клиент передаётся аргументом (структурный тип),
// поэтому проверяется unit-тестами с поддельным клиентом, без Postgres.

import type { PrismaClient } from "@prisma/client";
import { isUniqueViolation } from "@/lib/intake-receipt";

export const SINGAN_MUTATION_KIND = "SINGAN_PIECE";
export const SINGAN_ENTITY_TYPE = "Piece";

/** entityId квитанции, пока кусок ещё не записан («заявка в работе»). */
export const SINGAN_PENDING_ENTITY_ID = "";

/** Что нужно экрану успеха при повторе — без повторного запроса в БД. */
export interface SinganReceiptResult {
  stoneTypeId: string;
  causeLabel: string;
  /** false → фото из Telegram не прикрепилось (честный photoWarn). */
  photoSaved: boolean;
}

interface ReceiptRow {
  entityId: string;
  resultJson: unknown;
}

/**
 * Только модель MutationReceipt (как IntakeReceiptTx в приёмке): в юнит-тестах
 * подставляется поддельный клиент через `as unknown as SinganReceiptClient`.
 */
export type SinganReceiptClient = Pick<PrismaClient, "mutationReceipt">;

export type SinganClaim =
  /** Заявка наша — можно писать кусок. */
  | { status: "fresh" }
  /** Кусок по этому mutationId уже записан — показываем тот же результат. */
  | { status: "done"; pieceId: string; result: SinganReceiptResult }
  /** Заявка занята, но результата ещё нет (параллельный дубль в полёте). */
  | { status: "in_flight" };

function resultFromJson(raw: unknown): SinganReceiptResult {
  const j = (raw ?? {}) as Partial<SinganReceiptResult>;
  return {
    stoneTypeId: typeof j.stoneTypeId === "string" ? j.stoneTypeId : "",
    causeLabel: typeof j.causeLabel === "string" ? j.causeLabel : "",
    // Отсутствует в квитанции → считаем, что фото НЕ подтверждено: зелёный
    // «фото сохранено» без доказательства — это ложь (правило round2).
    photoSaved: j.photoSaved === true,
  };
}

function claimFromRow(row: ReceiptRow): SinganClaim {
  if (row.entityId === SINGAN_PENDING_ENTITY_ID) return { status: "in_flight" };
  return {
    status: "done",
    pieceId: row.entityId,
    result: resultFromJson(row.resultJson),
  };
}

/**
 * Занимает mutationId под запись куска. Второй вызов с тем же id доменную
 * запись НЕ разрешает (done / in_flight).
 */
export async function claimSinganPiece(
  client: SinganReceiptClient,
  args: { mutationId: string; userId: string | null },
): Promise<SinganClaim> {
  const existing = await client.mutationReceipt.findUnique({
    where: { mutationId: args.mutationId },
    select: { entityId: true, resultJson: true },
  });
  if (existing) return claimFromRow(existing);

  try {
    await client.mutationReceipt.create({
      data: {
        mutationId: args.mutationId,
        kind: SINGAN_MUTATION_KIND,
        userId: args.userId,
        entityType: SINGAN_ENTITY_TYPE,
        entityId: SINGAN_PENDING_ENTITY_ID,
      },
    });
  } catch (e) {
    // Гонка: между findUnique и create успел вклиниться дубль.
    if (isUniqueViolation(e)) {
      const winner = await client.mutationReceipt.findUnique({
        where: { mutationId: args.mutationId },
        select: { entityId: true, resultJson: true },
      });
      return winner ? claimFromRow(winner) : { status: "in_flight" };
    }
    throw e;
  }
  return { status: "fresh" };
}

/** Кусок записан — фиксируем результат в квитанции (повтор покажет его же). */
export async function completeSinganPiece(
  client: SinganReceiptClient,
  args: {
    mutationId: string;
    pieceId: string;
    result: SinganReceiptResult;
  },
): Promise<void> {
  await client.mutationReceipt.update({
    where: { mutationId: args.mutationId },
    data: {
      entityId: args.pieceId,
      // Простой объект — Prisma.InputJsonValue.
      resultJson: {
        stoneTypeId: args.result.stoneTypeId,
        causeLabel: args.result.causeLabel,
        photoSaved: args.result.photoSaved,
      },
    },
  });
}

/**
 * Доменная запись не удалась — снимаем заявку, чтобы исправленный повтор с тем
 * же mutationId прошёл. Сбой удаления не должен маскировать исходную ошибку,
 * поэтому исключение только логируется.
 */
export async function releaseSinganPiece(
  client: SinganReceiptClient,
  mutationId: string,
): Promise<void> {
  try {
    await client.mutationReceipt.delete({ where: { mutationId } });
  } catch (err) {
    console.error("[singan] заявку не удалось снять:", err);
  }
}
