// W7-B — /prodazha deep-link preselect (TZ §6.1 шаг 8).
// SOF: query string ishonchsiz — DB holati + canSell shu yerda tekshiriladi.
// Sotuv tranzaksiyasi (src/lib/sales.ts) O'ZGARMAGAN; faqat forma boshlang'ich holati.

export type SalePreselectKind = "SLAB" | "PIECE";

/** Query: `?slab=<id>` yoki `?piece=<id>` (ikkisi birga — slab ustun). */
export type SalePreselectQuery = {
  slabId: string | null;
  pieceId: string | null;
};

export type SalePreselectUnitRow = {
  id: string;
  status: string;
  needsCheck: boolean;
  stoneTypeId: string;
  stoneName: string;
  /** Plita yorlig'i yoki boy turi (UI title). */
  unitLabel: string;
  /** Faol bron menejeri; yo'q bo'lsa null. */
  activeReservationManagerId: string | null;
};

export type SalePreselectOk = {
  ok: true;
  kind: SalePreselectKind;
  unitId: string;
  stoneTypeId: string;
  /** SaleForm Target.title */
  title: string;
  /** SaleForm Target.subtitle (qisqa) */
  subtitle: string;
};

export type SalePreselectFailReason =
  | "none" // parametr yo'q — oddiy ochilish
  | "forbidden" // canSell=false
  | "not_found"
  | "sold"
  | "reserved_other"
  | "needs_check"
  | "unavailable"; // BROKEN_OFFCUT / RETURNED / boshqa

export type SalePreselectResult =
  | SalePreselectOk
  | { ok: false; reason: SalePreselectFailReason; message: string | null };

/** Query'dan id lar (trim, bo'sh → null). */
export function parseSalePreselectQuery(sp: {
  slab?: string | string[] | undefined;
  piece?: string | string[] | undefined;
}): SalePreselectQuery {
  const one = (v: string | string[] | undefined): string | null => {
    const s = (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
    return s.length > 0 ? s : null;
  };
  return { slabId: one(sp.slab), pieceId: one(sp.piece) };
}

/**
 * Server-side preselect qarori. unit=null → topilmadi (yoki so'rov yuborilmagan).
 * actorId — joriy foydalanuvchi (bron egasi tekshiruvi).
 */
export function resolveSalePreselect(args: {
  canSell: boolean;
  actorId: string | null;
  kind: SalePreselectKind;
  requestedId: string;
  unit: SalePreselectUnitRow | null;
}): SalePreselectResult {
  if (!args.canSell) {
    return {
      ok: false,
      reason: "forbidden",
      message: "Нет доступа: продажа доступна менеджеру или владельцу",
    };
  }

  const unit = args.unit;
  if (!unit || unit.id !== args.requestedId) {
    return {
      ok: false,
      reason: "not_found",
      message:
        args.kind === "SLAB"
          ? "Плита не найдена — ссылка устарела или неверна."
          : "Кусок не найден — ссылка устарела или неверна.",
    };
  }

  if (unit.needsCheck) {
    return {
      ok: false,
      reason: "needs_check",
      message:
        "Этот камень помечен «требует проверки» — сначала снимите пометку на складе, затем продавайте.",
    };
  }

  if (unit.status === "SOLD") {
    return {
      ok: false,
      reason: "sold",
      message:
        args.kind === "SLAB"
          ? "Эта плита уже продана — выбрать другую."
          : "Этот кусок уже продан — выбрать другой.",
    };
  }

  if (unit.status === "RESERVED") {
    const holder = unit.activeReservationManagerId;
    // Faol bron boshqa menejerda — deep-link bilan «o'g'irlash» yo'q.
    if (holder && args.actorId && holder !== args.actorId) {
      return {
        ok: false,
        reason: "reserved_other",
        message:
          "Плита в брони другого менеджера — снять бронь может только он или владелец.",
      };
    }
    if (holder && !args.actorId) {
      return {
        ok: false,
        reason: "reserved_other",
        message: "Плита в брони — войдите как менеджер, оформивший бронь.",
      };
    }
    // O'z bronim yoki RESERVED lekin hold yo'q (edge) — ruxsat.
  } else if (unit.status !== "AVAILABLE") {
    return {
      ok: false,
      reason: "unavailable",
      message:
        unit.status === "BROKEN_OFFCUT"
          ? "Плита уже переведена в бой/остаток — продажа целиком недоступна."
          : unit.status === "RETURNED"
            ? "Камень в статусе «возврат» — сначала проверка, затем продажа."
            : "Камень недоступен для продажи (статус: " + unit.status + ").",
    };
  }

  const kindRu = args.kind === "SLAB" ? "плита" : "кусок";
  return {
    ok: true,
    kind: args.kind,
    unitId: unit.id,
    stoneTypeId: unit.stoneTypeId,
    title: `${unit.stoneName} — ${unit.unitLabel}`,
    subtitle: `Выбрано из карточки камня (${kindRu})`,
  };
}

/** Foydalanuvchiga ko'rsatiladigan xabar (null = ogohlantirish yo'q). */
export function salePreselectAlert(
  result: SalePreselectResult,
): { variant: "danger" | "info"; title: string; body: string } | null {
  if (result.ok) return null;
  if (result.reason === "none") return null;
  if (result.reason === "forbidden") {
    // Sahifa NoAccess ko'rsatadi — alohida banner kerak emas.
    return null;
  }
  return {
    variant: "danger",
    title: "Не удалось открыть выбран",
    body: result.message ?? "Ссылка на продажу недействительна.",
  };
}
