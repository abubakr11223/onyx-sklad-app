// A1 (TZ §6.8) — чистые хелперы лидов (DB YO'Q). Живой DB-тест createLead/
// updateLeadStatus — отдельно (scratchpad, см. отчёт): здесь только статусный
// поток и валидация, изолированно от Prisma.
import { describe, expect, it } from "vitest";
import {
  LEAD_STATUSES,
  LEAD_STATUS_FLOW,
  LEAD_STATUS_RU,
  canTransitionLead,
  isLeadStatus,
  type LeadStatus,
} from "@/lib/leads";

describe("isLeadStatus — строка это валидный статус лида?", () => {
  it("NEW/CONTACTED/CLOSED → true", () => {
    expect(isLeadStatus("NEW")).toBe(true);
    expect(isLeadStatus("CONTACTED")).toBe(true);
    expect(isLeadStatus("CLOSED")).toBe(true);
  });
  it("noma'lum/bo'sh/regist → false", () => {
    expect(isLeadStatus("")).toBe(false);
    expect(isLeadStatus("DONE")).toBe(false);
    expect(isLeadStatus("new")).toBe(false); // katta-kichik farqi
  });
});

describe("LEAD_STATUS_RU — har status uchun RU yorliq bor", () => {
  it("barcha statuslar qamrab olingan", () => {
    for (const s of LEAD_STATUSES) {
      expect(typeof LEAD_STATUS_RU[s]).toBe("string");
      expect(LEAD_STATUS_RU[s].length).toBeGreaterThan(0);
    }
  });
});

describe("canTransitionLead — только вперёд NEW → CONTACTED → CLOSED", () => {
  it("NEW → CONTACTED / CLOSED разрешено", () => {
    expect(canTransitionLead("NEW", "CONTACTED")).toBe(true);
    expect(canTransitionLead("NEW", "CLOSED")).toBe(true);
  });
  it("CONTACTED → CLOSED разрешено; CONTACTED → NEW нет", () => {
    expect(canTransitionLead("CONTACTED", "CLOSED")).toBe(true);
    expect(canTransitionLead("CONTACTED", "NEW")).toBe(false);
  });
  it("CLOSED — терминальный (никуда)", () => {
    for (const to of LEAD_STATUSES) {
      expect(canTransitionLead("CLOSED", to)).toBe(false);
    }
  });
  it("переход в тот же статус запрещён (NEW→NEW)", () => {
    for (const s of LEAD_STATUSES) {
      expect(canTransitionLead(s, s)).toBe(false);
    }
  });
  it("поток совпадает с картой LEAD_STATUS_FLOW", () => {
    // Каждый разрешённый переход по canTransitionLead есть в карте, и наоборот.
    for (const from of LEAD_STATUSES) {
      for (const to of LEAD_STATUSES) {
        const inMap = (LEAD_STATUS_FLOW[from] as readonly LeadStatus[]).includes(to);
        expect(canTransitionLead(from, to)).toBe(inMap);
      }
    }
  });
});
