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
import { strOf } from "@/lib/form";

export async function submitSingan(formData: FormData): Promise<void> {
  // Draft'ni URL'ga qaytarish uchun oldindan o'qiymiz (xato banneri forma bilan
  // birga ko'rinsin). encodeURIComponent — d foydalanuvchi kirishi.
  const dRaw = String(formData.get("d") ?? "");
  const backBase = `/singan?d=${encodeURIComponent(dRaw)}`;
  // Funksiya-deklaratsiya + aniq `never` — TS control-flow narrowing uchun
  // (const-arrow bo'lsa TS chaqiruvdan keyingi kodni «unreachable» demaydi).
  function fail(msg: string): never {
    redirect(`${backBase}&err=${encodeURIComponent(msg)}`);
  }

  // R2 — DEFENSE-IN-DEPTH (birinchi operator): бой записывает только склад
  // (canManageWarehouse: OWNER/WAREHOUSE). Сайт открыт — прямой POST блокируется.
  if (!(await getCapabilities()).canManageWarehouse) {
    fail("Нет доступа: бой записывает склад");
  }

  // Draft — QATTIQ qayta-validatsiya (sahifadagi bilan bir xil kodek).
  const draft = decodeShapeDraft(dRaw);
  if (!draft) {
    redirect(`/singan?err=${encodeURIComponent("Ссылка повреждена — запросите новую в боте")}`);
  }

  const str = strOf(formData);

  // Tomonlar: chertyojdagi har tomon uchun bitta side_i (mm, musbat butun).
  const sides: number[] = [];
  for (let i = 1; i <= draft.vertices.length; i++) {
    const parsed = parsePositiveInt(str(`side_${i}`));
    if (parsed === null || parsed === undefined) {
      fail(`Сторона ${i}: укажите целое положительное число (см)`);
    }
    sides.push(parsed as number);
  }
  if (!validateSidesMm(sides)) {
    fail("Стороны — минимум 3 целых положительных числа (см)");
  }

  const boundingLengthMm = parsePositiveInt(str("boundingLengthMm"));
  if (boundingLengthMm === null || boundingLengthMm === undefined) {
    fail("Длина (габарит), см — целое положительное число");
  }
  const boundingWidthMm = parsePositiveInt(str("boundingWidthMm"));
  if (boundingWidthMm === null || boundingWidthMm === undefined) {
    fail("Ширина (габарит), см — целое положительное число");
  }
  const thicknessMm = parsePositiveInt(str("thicknessMm"));
  if (thicknessMm === undefined) {
    fail("Толщина, см — целое положительное число (или пусто)");
  }
  const areaM2 = parsePositiveDecimal(str("areaM2"));
  if (areaM2 === undefined) {
    fail("Площадь — положительное число, например 1,2 (или пусто)");
  }

  const kindRaw = str("kind");
  const kind: PieceKind = kindRaw === "OFFCUT" ? "OFFCUT" : "BROKEN";

  const batchId = str("batchId");
  if (!batchId) fail("Выберите партию");
  const block = str("block");
  if (!block) fail("Укажите блок (например «А»)");
  // ТЗ №18 §2 — ориентир необязателен (кусок числится за блоком целиком).
  const landmark = str("landmark");
  // TZ §5.6 — same cause taxonomy as /razbit (both paths must record it).
  const causeParsed = parseBreakCause(str("breakCause"), str("breakCauseNote"));
  if (!causeParsed.ok) fail(causeParsed.message);

  // Действующий пользователь — ДО транзакции (kamen/actions actorId uslubi).
  const byUserId = await currentActorId();
  if (!byUserId) {
    fail("Складчик не найден в системе — обратитесь к администратору");
  }

  // stoneTypeId — partiyadan (Photo yozuvi va yakuniy redirect uchun kerak).
  const batch = await db.batch.findUnique({
    where: { id: batchId },
    select: { stoneTypeId: true },
  });
  if (!batch) fail("Партия не найдена — обновите страницу");

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
      byUserId: byUserId as string,
      drawingUrl,
      cause: causeParsed.cause,
    });
    pieceId = result.pieceId;
  } catch (e) {
    if (e instanceof BreakError) fail(e.message);
    throw e; // redirect() ham shu yerdan o'tadi (NEXT_REDIRECT) — qayta otiladi.
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

  const params = new URLSearchParams({
    ok: "1",
    stone: batch.stoneTypeId,
    cause: causeParsed.cause.labelRu,
  });
  if (!photoSaved) params.set("photoWarn", "1");
  redirect(`/singan?${params.toString()}`);
}
