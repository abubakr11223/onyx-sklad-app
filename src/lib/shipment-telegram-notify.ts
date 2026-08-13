// TZ №15 §8.2 — Telegram notify warehouse on a NEW shipment task.
//
// Self-contained module (o4). Does NOT edit shipments.ts / otgruzki.
//
// Reuses photo-request lessons (three production bugs):
//   • never silent: noWorkers + recipients returned to creator
//   • demo accounts excluded (partitionDispatchWorkers / isDemoWarehouseAccount)
//   • idempotent: MutationReceipt per (shipmentId, chatId) — SENT never re-sends
//
// PhotoDispatch is FK'd to PhotoRequest, so we cannot reuse that table without
// a fake PhotoRequest. Idempotency + attempt count live in MutationReceipt
// (same P2002 / resultJson pattern as intake-receipt / update_id receipt).
// Dispatch visibility also goes to AuditLog (action SHIPMENT_CONFIRM,
// payload.event = "telegram_task_dispatch") so История shows the attempt.
//
// ─── WIRING (exactly one call site for o1) ───────────────────────────────
// After create*Shipment commits (NOT inside the sale/sample TX — Telegram is
// external I/O), fire-and-observe:
//
//   import { notifyWarehouseOfShipment } from "@/lib/shipment-telegram-notify";
//   // …
//   const { shipmentId } = await createSaleShipment(tx, …); // existing
//   // AFTER the outer TX commits:
//   const notify = await notifyWarehouseOfShipment(shipmentId, { actorId: managerId });
//   // surface notify.noWorkers / notify.dispatchedTo to the manager UI
//
// Same one-liner after createSampleShipment / createShowroomShipment.

import type { Prisma } from "@prisma/client";
import type { SendMessageOptions, SendResult } from "@/lib/telegram";
import {
  MAX_DISPATCH_ATTEMPTS,
  isDemoWarehouseAccount,
  partitionDispatchWorkers,
  type DispatchRecipient,
  type PhotoRequestWorker,
} from "@/lib/photo-requests";

// ───────────────────────── Errors ─────────────────────────

export type ShipmentNotifyErrorCode = "NOT_FOUND" | "VALIDATION" | "CANCELLED";

export class ShipmentNotifyError extends Error {
  constructor(
    public readonly code: ShipmentNotifyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ShipmentNotifyError";
  }
}

// ───────────────────────── Constants ─────────────────────────

/** MutationReceipt.kind — permanent, low volume (one row per shipment×chat). */
export const SHIPMENT_NOTIFY_RECEIPT_KIND = "SHIPMENT_NOTIFY";

/** Build MutationReceipt.mutationId for one (shipment, chat) pair. */
export function shipmentNotifyReceiptId(
  shipmentId: string,
  chatId: string,
): string {
  return `SHIPMENT_NOTIFY:${shipmentId}:${chatId}`;
}

// Re-export so call sites / tests share one cap with photo-requests.
export { MAX_DISPATCH_ATTEMPTS, isDemoWarehouseAccount, partitionDispatchWorkers };

// ───────────────────────── Deps (injectable) ─────────────────────────

export interface ShipmentNotifyLine {
  targetType: string;
  locationSnapshot: string | null;
  qtyOrderedSlabs: number | null;
  qtyOrderedAreaM2: { toString(): string } | number | null;
  slab: {
    label: string | null;
    stoneType: { name: string } | null;
  } | null;
  piece: {
    kind: string | null;
    stoneType: { name: string } | null;
  } | null;
  batch: {
    stoneType: { name: string } | null;
  } | null;
}

export interface ShipmentNotifyRecord {
  id: string;
  kind: string;
  cancelledAt: Date | null;
  completedAt: Date | null;
  note: string | null;
  client: { name: string } | null;
  manager: { name: string | null } | null;
  lines: ShipmentNotifyLine[];
}

interface ReceiptResultJson {
  status: "SENT" | "FAILED";
  attempts: number;
  lastError: string | null;
  messageId: number | null;
  chatId: string;
  shipmentId: string;
}

export interface ShipmentNotifyDeps {
  db: {
    shipment: {
      findUnique(args: {
        where: { id: string };
        select: {
          id: true;
          kind: true;
          cancelledAt: true;
          completedAt: true;
          note: true;
          client: { select: { name: true } };
          manager: { select: { name: true } };
          lines: {
            take: number;
            select: {
              targetType: true;
              locationSnapshot: true;
              qtyOrderedSlabs: true;
              qtyOrderedAreaM2: true;
              slab: {
                select: {
                  label: true;
                  stoneType: { select: { name: true } };
                };
              };
              piece: {
                select: {
                  kind: true;
                  stoneType: { select: { name: true } };
                };
              };
              batch: {
                select: { stoneType: { select: { name: true } } };
              };
            };
          };
        };
      }): Promise<ShipmentNotifyRecord | null>;
    };
    user: {
      findMany(args: {
        where: {
          role: { in: ("WAREHOUSE" | "WAREHOUSE_LEAD")[] };
          isActive: true;
          telegramId: { not: null };
        };
        select: {
          id: true;
          telegramId: true;
          name: true;
          phone: true;
        };
        take: number;
      }): Promise<PhotoRequestWorker[]>;
    };
    mutationReceipt: {
      findUnique(args: {
        where: { mutationId: string };
        select: {
          mutationId: true;
          resultJson: true;
        };
      }): Promise<{
        mutationId: string;
        resultJson: Prisma.JsonValue | null;
      } | null>;
      create(args: {
        data: {
          mutationId: string;
          kind: string;
          userId: string | null;
          entityType: string;
          entityId: string;
          resultJson: Prisma.InputJsonValue;
        };
      }): Promise<unknown>;
      update(args: {
        where: { mutationId: string };
        data: { resultJson: Prisma.InputJsonValue };
      }): Promise<unknown>;
    };
    auditLog: {
      create(args: {
        data: {
          userId: string | null;
          action: "SHIPMENT_CONFIRM";
          entityType: string;
          entityId: string;
          payload: Prisma.InputJsonValue;
        };
      }): Promise<unknown>;
    };
  };
  sendMessage(
    chatId: number | string,
    text: string,
    opts?: SendMessageOptions,
  ): Promise<SendResult>;
}

export interface NotifyWarehouseResult {
  shipmentId: string;
  /** True SENT deliveries this call (or previously recorded SENT counted as delivered). */
  dispatchedTo: number;
  /**
   * true = no eligible real WAREHOUSE with telegramId (demo-only does not count).
   * Creator MUST surface this — never silent (BUG-04 lesson).
   */
  noWorkers: boolean;
  skippedDemoCount: number;
  recipients: DispatchRecipient[];
  /** How many Telegram sendMessage calls were made this invocation (not skips). */
  attemptedSends: number;
}

// ───────────────────────── Pure helpers ─────────────────────────

function kindLabelRu(kind: string): string {
  switch (kind) {
    case "SAMPLE":
      return "ОБРАЗЕЦ";
    case "SHOWROOM":
      return "ШОУ-РУМ";
    case "SALE":
    default:
      return "Продажа";
  }
}

function stoneLabelFromLine(line: ShipmentNotifyLine): string {
  if (line.slab?.stoneType?.name) {
    const lab = line.slab.label?.trim();
    return lab
      ? `${line.slab.stoneType.name} · ${lab}`
      : line.slab.stoneType.name;
  }
  if (line.piece?.stoneType?.name) {
    const k = line.piece.kind?.trim();
    return k
      ? `${line.piece.stoneType.name} · ${k}`
      : line.piece.stoneType.name;
  }
  if (line.batch?.stoneType?.name) return line.batch.stoneType.name;
  return "камень";
}

function qtyLabelFromLine(line: ShipmentNotifyLine): string {
  if (line.targetType === "SLAB" || line.targetType === "PIECE") {
    return "1 ед.";
  }
  const slabs = line.qtyOrderedSlabs ?? 0;
  const areaRaw = line.qtyOrderedAreaM2;
  const area =
    areaRaw == null
      ? 0
      : typeof areaRaw === "number"
        ? areaRaw
        : Number(areaRaw.toString());
  const parts: string[] = [];
  if (slabs > 0) parts.push(`${slabs} пл.`);
  if (area > 0) parts.push(`${area} м²`);
  return parts.length > 0 ? parts.join(" / ") : "объём";
}

/**
 * Warehouse task text (ru). Pure — unit-tested.
 * Mirrors photo-request buildTaskText style: clear action + location + comment.
 */
export function buildShipmentTaskText(ship: ShipmentNotifyRecord): string {
  const line = ship.lines[0] ?? null;
  const stone = line ? stoneLabelFromLine(line) : "камень";
  const qty = line ? qtyLabelFromLine(line) : "—";
  const loc = line?.locationSnapshot?.trim() || "локация не указана";
  const client = ship.client?.name?.trim() || "—";
  const manager = ship.manager?.name?.trim() || "—";
  const lines = [
    `📦 Задача: отгрузка (${kindLabelRu(ship.kind)})`,
    `Что: ${stone} · ${qty}`,
    `Где: ${loc}`,
    `Кому: ${client}`,
    `Оформил: ${manager}`,
  ];
  const note = ship.note?.trim();
  if (note) lines.push(`Комментарий: ${note}`);
  lines.push("Откройте «Отгрузки» → «К отгрузке» и подтвердите выдачу.");
  return lines.join("\n");
}

function parseReceiptJson(
  raw: Prisma.JsonValue | null | undefined,
): ReceiptResultJson | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.status !== "SENT" && o.status !== "FAILED") return null;
  const attempts =
    typeof o.attempts === "number" && Number.isFinite(o.attempts)
      ? Math.floor(o.attempts)
      : 0;
  return {
    status: o.status,
    attempts,
    lastError: typeof o.lastError === "string" ? o.lastError : null,
    messageId:
      typeof o.messageId === "number" && Number.isFinite(o.messageId)
        ? o.messageId
        : null,
    chatId: typeof o.chatId === "string" ? o.chatId : "",
    shipmentId: typeof o.shipmentId === "string" ? o.shipmentId : "",
  };
}

// ───────────────────── Dispatch + record (one worker) ─────────────────────

/**
 * Send (or skip) one warehouse worker. Idempotent:
 *   • existing SENT receipt → no send, count as delivered
 *   • existing FAILED with attempts >= MAX → no send
 *   • else sendMessage, create/update MutationReceipt + AuditLog
 */
async function dispatchOneWorker(
  deps: ShipmentNotifyDeps,
  args: {
    shipmentId: string;
    actorId: string | null;
    chatId: string;
    text: string;
  },
): Promise<{ delivered: boolean; sentNow: boolean }> {
  const { db, sendMessage } = deps;
  const mutationId = shipmentNotifyReceiptId(args.shipmentId, args.chatId);

  const existing = await db.mutationReceipt.findUnique({
    where: { mutationId },
    select: { mutationId: true, resultJson: true },
  });
  const prev = parseReceiptJson(existing?.resultJson);

  // Already delivered — never re-send (update_id / PhotoDispatch SENT lesson).
  if (prev?.status === "SENT") {
    return { delivered: true, sentNow: false };
  }
  // Cap retries (photo-request MAX_DISPATCH_ATTEMPTS).
  if (prev && prev.attempts >= MAX_DISPATCH_ATTEMPTS) {
    return { delivered: false, sentNow: false };
  }

  const res = await sendMessage(args.chatId, args.text);
  const attempts = (prev?.attempts ?? 0) + 1;
  const nowPayload: ReceiptResultJson = {
    status: res.ok ? "SENT" : "FAILED",
    attempts,
    lastError: res.ok ? null : res.error,
    messageId: res.ok ? res.messageId : null,
    chatId: args.chatId,
    shipmentId: args.shipmentId,
  };

  if (existing) {
    await db.mutationReceipt.update({
      where: { mutationId },
      data: { resultJson: nowPayload as unknown as Prisma.InputJsonValue },
    });
  } else {
    await db.mutationReceipt.create({
      data: {
        mutationId,
        kind: SHIPMENT_NOTIFY_RECEIPT_KIND,
        userId: args.actorId,
        entityType: "Shipment",
        entityId: args.shipmentId,
        resultJson: nowPayload as unknown as Prisma.InputJsonValue,
      },
    });
  }

  // Non-fatal audit — never block remaining workers if log write fails.
  try {
    await db.auditLog.create({
      data: {
        userId: args.actorId,
        action: "SHIPMENT_CONFIRM",
        entityType: "Shipment",
        entityId: args.shipmentId,
        payload: {
          event: "telegram_task_dispatch",
          chatId: args.chatId,
          delivered: res.ok,
          error: res.ok ? null : res.error,
          attempts,
          messageId: res.ok ? res.messageId : null,
        },
      },
    });
  } catch {
    // swallow — delivery outcome already in MutationReceipt
  }

  return { delivered: res.ok, sentNow: true };
}

// ───────────────────────── Main entry ─────────────────────────

/**
 * Load shipment by id and notify every eligible linked WAREHOUSE worker.
 * Safe to call on retry: SENT chats are not messaged again.
 */
export async function notifyWarehouseOfShipment(
  shipmentId: string,
  opts: { actorId?: string | null } = {},
  deps: ShipmentNotifyDeps,
): Promise<NotifyWarehouseResult> {
  const id = shipmentId?.trim();
  if (!id) {
    throw new ShipmentNotifyError("VALIDATION", "Не указана отгрузка");
  }

  const { db } = deps;
  const actorId = opts.actorId?.trim() || null;

  // Bound: one shipment, ≤20 lines (shipments are 1-line today; take protects).
  const ship = await db.shipment.findUnique({
    where: { id },
    select: {
      id: true,
      kind: true,
      cancelledAt: true,
      completedAt: true,
      note: true,
      client: { select: { name: true } },
      manager: { select: { name: true } },
      lines: {
        take: 20,
        select: {
          targetType: true,
          locationSnapshot: true,
          qtyOrderedSlabs: true,
          qtyOrderedAreaM2: true,
          slab: {
            select: {
              label: true,
              stoneType: { select: { name: true } },
            },
          },
          piece: {
            select: {
              kind: true,
              stoneType: { select: { name: true } },
            },
          },
          batch: {
            select: { stoneType: { select: { name: true } } },
          },
        },
      },
    },
  });

  if (!ship) {
    throw new ShipmentNotifyError("NOT_FOUND", "Отгрузка не найдена");
  }
  if (ship.cancelledAt) {
    throw new ShipmentNotifyError(
      "CANCELLED",
      "Отгрузка отменена — уведомление не отправляется",
    );
  }

  // Bound worker query (WAREHOUSE staff is small; hard cap avoids runaway).
  const workers = await db.user.findMany({
    // Зав. складом — тоже склад: задачи на отгрузку приходят и ему (2026-08-12).
    where: {
      role: { in: ["WAREHOUSE", "WAREHOUSE_LEAD"] },
      isActive: true,
      telegramId: { not: null },
    },
    select: { id: true, telegramId: true, name: true, phone: true },
    take: 50,
  });
  const { eligible, skippedDemo } = partitionDispatchWorkers(workers);

  const recipients: DispatchRecipient[] = [];
  for (const w of skippedDemo) {
    recipients.push({
      userId: w.id,
      name: w.name?.trim() || "складчик",
      telegramId: w.telegramId as string,
      delivered: false,
      isDemoAccount: true,
      skipped: true,
    });
  }

  if (eligible.length === 0) {
    // NEVER silent — audit + noWorkers for the creator UI.
    await db.auditLog.create({
      data: {
        userId: actorId,
        action: "SHIPMENT_CONFIRM",
        entityType: "Shipment",
        entityId: ship.id,
        payload: {
          event: "telegram_task_dispatch",
          noWorkers: true,
          delivered: 0,
          skippedDemoCount: skippedDemo.length,
          note:
            skippedDemo.length > 0
              ? "Только демо-складчик с Telegram — рассылка пропущена (W11-A); привяжите реального складчика"
              : "Нет складчиков с привязанным Telegram — задача отгрузки не доставлена",
        },
      },
    });
    return {
      shipmentId: ship.id,
      dispatchedTo: 0,
      noWorkers: true,
      skippedDemoCount: skippedDemo.length,
      recipients,
      attemptedSends: 0,
    };
  }

  const text = buildShipmentTaskText(ship);
  let dispatchedTo = 0;
  let attemptedSends = 0;

  // Sequential — same as photo-requests (ordered DB writes, few workers).
  for (const w of eligible) {
    const chatId = w.telegramId as string;
    const { delivered, sentNow } = await dispatchOneWorker(deps, {
      shipmentId: ship.id,
      actorId,
      chatId,
      text,
    });
    if (sentNow) attemptedSends += 1;
    if (delivered) dispatchedTo += 1;
    recipients.push({
      userId: w.id,
      name: w.name?.trim() || "складчик",
      telegramId: chatId,
      delivered,
      isDemoAccount: false,
      skipped: false,
    });
  }

  return {
    shipmentId: ship.id,
    dispatchedTo,
    noWorkers: false,
    skippedDemoCount: skippedDemo.length,
    recipients,
    attemptedSends,
  };
}
