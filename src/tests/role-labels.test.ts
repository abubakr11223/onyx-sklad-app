// BUG-06 — Rol nomlari RU DISPLAY testlari (TZ §3 «Роли и права»).
// Tekshiradi: har enum a'zosi uchun RU yorliq bor; aynan mos matn qaytadi;
// yorliq HECH QACHON xom EN CODE'ga teng emas (display/code ajralishi haqiqiy).
import { describe, expect, it } from "vitest";
import { ROLE_LABELS, roleLabel } from "@/lib/role-labels";
import type { Role } from "@/lib/permissions";

const ROLES: Role[] = ["OWNER", "MANAGER", "WAREHOUSE", "PARTNER"];

const EXPECTED: Record<Role, string> = {
  OWNER: "Владелец",
  MANAGER: "Менеджер",
  WAREHOUSE: "Складчик",
  PARTNER: "Дизайнер-партнёр",
};

describe("role-labels (BUG-06)", () => {
  it("ROLE_LABELS har enum a'zosi uchun RU yorliqqa ega", () => {
    for (const r of ROLES) {
      expect(ROLE_LABELS[r]).toBe(EXPECTED[r]);
    }
  });

  it("roleLabel(r) har 4 rol uchun aynan RU yorliqni qaytaradi", () => {
    for (const r of ROLES) {
      expect(roleLabel(r)).toBe(EXPECTED[r]);
    }
  });

  it("qaytgan yorliq HECH QACHON xom EN CODE'ga teng emas", () => {
    for (const r of ROLES) {
      expect(roleLabel(r)).not.toBe(r);
    }
  });
});
