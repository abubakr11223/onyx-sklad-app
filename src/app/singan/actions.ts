"use server";

// §5.5b — «Бой по фото»: server action saqlash. TZ §5.5: AI shaklni chizdi,
// skladchi /singan sahifasida har tomonning REAL o'lchamini kiritdi — endi
// Piece registerDirectPiece orqali yoziladi (batch lock + §3 guard + AuditLog
// bitta tranzaksiyada, breaking.ts). Chertyoj o'lchangan yozuvlar bilan QAYTA
// chiziladi va drawingUrl'ga o'zi-yetarli SVG data-URI sifatida saqlanadi.
//
// XAVFSIZLIK: `d` (draft) — foydalanuvchi nazoratidagi URL/forma ma'lumoti.
// Sahifada ham, bu yerda ham decodeShapeDraft QATTIQ validatsiyadan o'tkazadi —
// formaga ishonmaymiz (kamen/actions.ts guard-first uslubi).
//
// W3-T2 (4 ta nuqson yopildi):
//   (a) Толщина — ДРОБНАЯ (parseThicknessCm, /razbit bilan bir xil parser).
//   (b) Xatolik endi redirect ?err= EMAS: useActionState state qaytadi, forma
//       kiritilgan qiymatlarni SAQLAB qoladi (SaleForm/IntakeForm/BreakForm).
//   (c) Ikki marta bosish — bitta kusok: mutationId + MutationReceipt zayavka
//       (singan-receipt.ts) + pending-disabled tugma formada.
//   (d) Блок — faqat sklad kartasidan (findUnknownLocations), ориентир ТЗ18 §2
//       bo'yicha IXTIYORIY.

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCapabilities, currentActorId } from "@/lib/session";
import { decodeShapeDraft } from "@/lib/singan";
import { renderChertyoj } from "@/lib/chertyoj";
import {
  BreakError,
  parseBreakCause,
  registerDirectPiece,
  validateSidesMm,
} from "@/lib/breaking";
import type { PieceKind } from "@prisma/client";
import { parsePositiveDecimal, parsePositiveInt } from "@/lib/validators/intake";
import { parseThicknessCm } from "@/lib/dimensions";
import { normalizeBlockLetter } from "@/lib/block-letter";
import { strOf } from "@/lib/form";
import { ensureFormError } from "@/lib/form-errors";
import { findUnknownLocations } from "@/lib/warehouse-grid";
import { parseMutationId } from "@/lib/intake-receipt";
import {
  claimSinganPiece,
  completeSinganPiece,
  releaseSinganPiece,
} from "./singan-receipt";

/** Ключ — имя поля («side_1», «thicknessMm»…), значение — русское сообщение. */
export type SinganFormErrors = Record<string, string>;

/**
 * Сырые значения формы. Возвращаются обратно вместе с ошибками — так введённое
 * переживает неудачную отправку даже без JS (с JS поля контролируемые).
 */
export interface SinganValues {
  sides: string[];
  boundingLengthMm: string;
  boundingWidthMm: string;
  thicknessMm: string;
  areaM2: string;
  kind: string;
  batchId: string;
  block: string;
  landmark: string;
  breakCause: string;
  breakCauseNote: string;
}

export interface SinganFormState {
  errors: SinganFormErrors;
  /** Эхо отправленного — форма не должна терять замеры из-за одной опечатки. */
  values?: SinganValues;
}

/** Верхняя граница сторон при чтении формы (MAX_VERTICES кодека = 20). */
const MAX_SIDE_FIELDS = 20;

function readValues(formData: FormData): SinganValues {
  const str = strOf(formData);
  const sides: string[] = [];
  for (let i = 1; i <= MAX_SIDE_FIELDS; i++) {
    if (!formData.has(`side_${i}`)) break;
    sides.push(str(`side_${i}`));
  }
  return {
    sides,
    boundingLengthMm: str("boundingLengthMm"),
    boundingWidthMm: str("boundingWidthMm"),
    thicknessMm: str("thicknessMm"),
    areaM2: str("areaM2"),
    kind: str("kind"),
    batchId: str("batchId"),
    block: str("block"),
    landmark: str("landmark"),
    breakCause: str("breakCause"),
    breakCauseNote: str("breakCauseNote"),
  };
}

function successUrl(args: {
  stoneTypeId: string;
  causeLabel: string;
  photoSaved: boolean;
}): string {
  const params = new URLSearchParams({
    ok: "1",
    stone: args.stoneTypeId,
    cause: args.causeLabel,
  });
  // round2: никогда не «чистый ok», если фото не легло — иначе зелёный баннер
  // врёт про сохранённое фото.
  if (!args.photoSaved) params.set("photoWarn", "1");
  return `/singan?${params.toString()}`;
}

export async function submitSingan(
  _prev: SinganFormState,
  formData: FormData,
): Promise<SinganFormState> {
  const values = readValues(formData);
  const fail = (errors: SinganFormErrors): SinganFormState => ({
    errors: ensureFormError(errors),
    values,
  });

  // R2 — DEFENSE-IN-DEPTH (birinchi operator): бой записывает только склад
  // (canManageWarehouse: OWNER/WAREHOUSE). Сайт открыт — прямой POST блокируется.
  if (!(await getCapabilities()).canManageWarehouse) {
    return fail({ form: "Нет доступа: бой записывает склад" });
  }

  // Draft — QATTIQ qayta-validatsiya (sahifadagi bilan bir xil kodek).
  const draft = decodeShapeDraft(String(formData.get("d") ?? ""));
  if (!draft) {
    return fail({ form: "Ссылка повреждена — запросите новую в боте" });
  }

  const str = strOf(formData);
  const errors: SinganFormErrors = {};

  // Tomonlar: chertyojdagi har tomon uchun bitta side_i (см, musbat butun).
  // Длина/ширина/стороны — целые (как в /razbit); дробная только толщина.
  const sides: number[] = [];
  for (let i = 1; i <= draft.vertices.length; i++) {
    const parsed = parsePositiveInt(str(`side_${i}`));
    if (parsed === null || parsed === undefined) {
      errors[`side_${i}`] = "Целое положительное число (см)";
    } else {
      sides.push(parsed);
    }
  }
  if (sides.length === draft.vertices.length && !validateSidesMm(sides)) {
    errors.sides = "Стороны — минимум 3 целых положительных числа (см)";
  }

  const boundingLengthMm = parsePositiveInt(str("boundingLengthMm"));
  if (boundingLengthMm === null || boundingLengthMm === undefined) {
    errors.boundingLengthMm = "Длина, см — целое положительное число";
  }
  const boundingWidthMm = parsePositiveInt(str("boundingWidthMm"));
  if (boundingWidthMm === null || boundingWidthMm === undefined) {
    errors.boundingWidthMm = "Ширина, см — целое положительное число";
  }
  // ТЗ №12 + решение владельца 2026-08-10 — толщина ДРОБНАЯ (18 мм = 1,8 см).
  // Тот же parseThicknessCm, что в /razbit (parsePieceRow) и приёмке.
  const thicknessMm = parseThicknessCm(str("thicknessMm"));
  if (thicknessMm === undefined) {
    errors.thicknessMm = "Толщина, см — положительное число, например 2 или 1,8";
  }
  const areaM2 = parsePositiveDecimal(str("areaM2"));
  if (areaM2 === undefined) {
    errors.areaM2 = "Площадь — положительное число, например 1,2 (или пусто)";
  }

  const kindRaw = str("kind");
  const kind: PieceKind = kindRaw === "OFFCUT" ? "OFFCUT" : "BROKEN";

  const batchId = str("batchId");
  if (!batchId) errors.batchId = "Выберите партию";

  // ТЗ №7 §2 (BUG-01) — единый алфавит/регистр кода блока (кир/лат дубли).
  const block = normalizeBlockLetter(str("block"));
  if (!block) errors.block = "Выберите блок из карты склада";
  // ТЗ №18 §2 — ориентир необязателен (кусок числится за блоком целиком).
  const landmark = str("landmark");

  // TZ §5.6 — same cause taxonomy as /razbit (both paths must record it).
  const causeParsed = parseBreakCause(str("breakCause"), str("breakCauseNote"));
  const cause = causeParsed.ok ? causeParsed.cause : null;
  if (!causeParsed.ok) errors.breakCause = causeParsed.message;

  // W3-T2 — тот же логический бой обязан нести тот же mutationId (клиентский
  // UUID). Пусто/мусор → отказ: молча выдать серверный id значит потерять всю
  // защиту от дубля при повторе.
  const mutationId = parseMutationId(formData.get("mutationId"));
  if (!mutationId) {
    errors.form = "Сессия формы устарела — обновите страницу и повторите";
  }

  // ТЗ №17 §6 — локация только из карты склада: свободный ввод плодил блоки-
  // опечатки, и кусок «терялся» между «Б2» и «B2». Селект в форме — половина
  // дела, прямой POST его обходит.
  if (block) {
    const unknown = await findUnknownLocations([{ block, landmark }]);
    for (const u of unknown) {
      errors[u.reason === "block" ? "block" : "landmark"] =
        u.reason === "block"
          ? `Блока «${u.block}» нет в карте склада. Выберите из списка.`
          : `В блоке «${u.block}» нет ориентира «${u.landmark}». Выберите из списка.`;
    }
  }

  if (Object.keys(errors).length > 0 || !cause || !mutationId) {
    return fail(errors);
  }

  // Действующий пользователь — ДО транзакции (kamen/actions actorId uslubi).
  const byUserId = await currentActorId();
  if (!byUserId) {
    return fail({
      form: "Складчик не найден в системе — обратитесь к администратору",
    });
  }

  // stoneTypeId — partiyadan (Photo yozuvi va yakuniy redirect uchun kerak).
  const batch = await db.batch.findUnique({
    where: { id: batchId },
    select: { stoneTypeId: true },
  });
  if (!batch) return fail({ batchId: "Партия не найдена — обновите страницу" });

  // ── Идемпотентность: двойное касание не должно списать две плиты ──
  const claim = await claimSinganPiece(db, { mutationId, userId: byUserId });
  if (claim.status === "done") {
    // Повтор того же боя — кусок уже записан, второй раз не пишем.
    redirect(
      successUrl({
        stoneTypeId: claim.result.stoneTypeId || batch.stoneTypeId,
        causeLabel: claim.result.causeLabel || cause.labelRu,
        photoSaved: claim.result.photoSaved,
      }),
    );
  }
  if (claim.status === "in_flight") {
    return fail({
      form: "Этот кусок уже записывается — подождите и обновите страницу",
    });
  }

  // Yakuniy chertyoj: validatsiyadan o'tgan polygon + O'LCHANGAN yozuvlar
  // (renderChertyoj yozuvlarni escapeXml qiladi — stored-XSS yopiq). SVG
  // o'zi-yetarli data-URI bo'lib Piece.drawingUrl'ga kiradi.
  const svg = renderChertyoj(draft.vertices, {
    sideLabels: sides.map((s) => String(s)),
  });
  const drawingUrl =
    "data:image/svg+xml;base64," + Buffer.from(svg, "utf8").toString("base64");

  let pieceId: string;
  try {
    // §3 / fixes0809: always −1 free slab; area resolved in registerDirectPiece.
    const result = await registerDirectPiece({
      kind,
      sidesMm: sides,
      boundingLengthMm: boundingLengthMm as number,
      boundingWidthMm: boundingWidthMm as number,
      thicknessMm: thicknessMm ?? null,
      areaM2: areaM2 ?? null,
      block,
      landmark,
      batchId,
      byUserId,
      drawingUrl,
      cause,
    });
    pieceId = result.pieceId;
  } catch (e) {
    // Заявку снимаем — иначе исправленный повтор с тем же mutationId навсегда
    // считался бы дублем и кусок не записался бы никогда.
    await releaseSinganPiece(db, mutationId);
    if (e instanceof BreakError) return fail({ form: e.message });
    throw e;
  }

  // Asl Telegram rasmi — Photo yozuvi (storageKey = file_id, PIECE turi),
  // shunda kartochkada foto proksi orqali ko'rinadi. ALOHIDA try/catch:
  // metadata yiqilsa ham Piece tranzaksiyasi ortga QAYTMAYDI — piece qoldi.
  // round2: hech qachon sof ok=1 — photo muvaffaqiyatsiz bo'lsa photoWarn=1
  // (yashil «foto saqlandi» yolg'oni yo'q).
  let photoSaved = true;
  try {
    await db.photo.create({
      data: {
        storageKey: draft.fileId,
        kind: "PIECE",
        takenAt: new Date(),
        takenById: byUserId,
        stoneTypeId: batch.stoneTypeId,
        pieceId,
      },
    });
  } catch (err) {
    photoSaved = false;
    console.error("[singan] Photo yozuvi yaratilmadi (piece saqlangan):", err);
  }

  // Квитанция закрывается ПОСЛЕ доменной записи: повтор ссылки покажет тот же
  // результат, а не запишет второй кусок. Сбой отметки не откатывает кусок —
  // он уже в остатке (журналируем).
  try {
    await completeSinganPiece(db, {
      mutationId,
      pieceId,
      result: {
        stoneTypeId: batch.stoneTypeId,
        causeLabel: cause.labelRu,
        photoSaved,
      },
    });
  } catch (err) {
    console.error("[singan] квитанцию не удалось закрыть (кусок записан):", err);
  }

  redirect(
    successUrl({
      stoneTypeId: batch.stoneTypeId,
      causeLabel: cause.labelRu,
      photoSaved,
    }),
  );
}
