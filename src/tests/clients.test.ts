// TZ №10+11 Этап 1–2 — Client/Site model contract + scope + currency + phone.
// No DB. Style: pure unit tests like reservations.test.ts scope block.

import { describe, expect, it } from "vitest";
import {
  CLIENT_TYPES,
  CLIENT_TYPE_LABELS,
  SITE_STATUSES,
  SITE_STATUS_LABELS,
  SITE_TYPES,
  SITE_TYPE_LABELS,
  clientListScope,
  findClientByNormalizedPhone,
  isClientType,
  isSiteStatus,
  isSiteType,
  moneyToCents,
  normalizeClientPhone,
  phonesMatch,
  siteListScope,
  sumMoneyByCurrency,
} from "@/lib/clients";
import { MAX_DECIMAL_14_2 } from "@/lib/decimal";

describe("Client/Site model contract (TZ №10+11 §3)", () => {
  it("ClientType enum members: B2C + B2B only", () => {
    expect([...CLIENT_TYPES]).toEqual(["B2C", "B2B"]);
    expect(isClientType("B2C")).toBe(true);
    expect(isClientType("B2B")).toBe(true);
    expect(isClientType("PRIVATE")).toBe(false);
    expect(isClientType("")).toBe(false);
  });

  it("SiteType enum members: RESIDENTIAL / COMMERCIAL / OTHER", () => {
    expect([...SITE_TYPES]).toEqual(["RESIDENTIAL", "COMMERCIAL", "OTHER"]);
    expect(isSiteType("RESIDENTIAL")).toBe(true);
    expect(isSiteType("WAREHOUSE")).toBe(false);
  });

  it("SiteStatus enum members: ACTIVE / COMPLETED (no OVERDUE-style third)", () => {
    expect([...SITE_STATUSES]).toEqual(["ACTIVE", "COMPLETED"]);
    expect(isSiteStatus("ACTIVE")).toBe(true);
    expect(isSiteStatus("COMPLETED")).toBe(true);
    expect(isSiteStatus("OVERDUE")).toBe(false);
  });

  it("every enum member has a RU label (этап 3 UI)", () => {
    for (const t of CLIENT_TYPES) {
      expect(CLIENT_TYPE_LABELS[t].length).toBeGreaterThan(0);
    }
    for (const t of SITE_TYPES) {
      expect(SITE_TYPE_LABELS[t].length).toBeGreaterThan(0);
    }
    for (const s of SITE_STATUSES) {
      expect(SITE_STATUS_LABELS[s].length).toBeGreaterThan(0);
    }
  });

  it("sale money ceiling is Decimal(14,2) — same as SaleRecord.price / Debt.amount", () => {
    expect(MAX_DECIMAL_14_2).toBe(999_999_999_999.99);
  });
});

describe("clientListScope / siteListScope — owner all, manager own", () => {
  it("canSeeAllClients → empty scope (no manager filter)", () => {
    expect(
      clientListScope({ canSeeAllClients: true, actorId: "mgr-1" }),
    ).toEqual({});
    expect(
      clientListScope({ canSeeAllClients: true, actorId: null }),
    ).toEqual({});
    expect(
      siteListScope({ canSeeAllClients: true, actorId: "mgr-1" }),
    ).toEqual({});
  });

  it("manager (canSeeAll=false) → only own managerId", () => {
    expect(
      clientListScope({ canSeeAllClients: false, actorId: "mgr-42" }),
    ).toEqual({ managerId: "mgr-42" });
    expect(
      siteListScope({ canSeeAllClients: false, actorId: "mgr-42" }),
    ).toEqual({ managerId: "mgr-42" });
  });

  it("canSeeAll=false and no actor → sentinel (never all rows)", () => {
    expect(
      clientListScope({ canSeeAllClients: false, actorId: null }),
    ).toEqual({ managerId: "__no_actor__" });
    expect(
      siteListScope({ canSeeAllClients: false, actorId: null }),
    ).toEqual({ managerId: "__no_actor__" });
  });
});

describe("normalizeClientPhone — digit-only for soft dedup", () => {
  it("strips spaces, plus, dashes", () => {
    expect(normalizeClientPhone("+998 90 123-45-67")).toBe("998901234567");
  });
  it("empty / non-digits → empty string", () => {
    expect(normalizeClientPhone("  ")).toBe("");
    expect(normalizeClientPhone("abc")).toBe("");
  });
  it("phonesMatch equates formatted variants", () => {
    expect(phonesMatch("+998901234567", "998 90 123 45 67")).toBe(true);
    expect(phonesMatch("111", "222")).toBe(false);
  });
  it("findClientByNormalizedPhone for create-path dedup", () => {
    const hit = findClientByNormalizedPhone(
      [{ id: "x", phone: "+998 (90) 000-11-22" }],
      "998900001122",
    );
    expect(hit?.id).toBe("x");
  });
});

describe("sumMoneyByCurrency — UZS and USD never mixed", () => {
  it("sums same currency via cents (no float drift)", () => {
    const rows = sumMoneyByCurrency([
      { amount: "100.10", currency: "UZS" },
      { amount: "200.20", currency: "UZS" },
    ]);
    expect(rows).toEqual([{ currency: "UZS", amount: "300.30", count: 2 }]);
  });

  it("keeps UZS and USD as separate lines — never one total", () => {
    const rows = sumMoneyByCurrency([
      { amount: "1000000", currency: "UZS" },
      { amount: "50.5", currency: "USD" },
      { amount: "500000", currency: "UZS" },
      { amount: "10", currency: "USD" },
    ]);
    expect(rows).toEqual([
      { currency: "UZS", amount: "1500000.00", count: 2 },
      { currency: "USD", amount: "60.50", count: 2 },
    ]);
    const totalField = (rows as Array<Record<string, unknown>>).find(
      (r) => "total" in r || "sum" in r,
    );
    expect(totalField).toBeUndefined();
  });

  it("empty input → empty (not zero of mixed currency)", () => {
    expect(sumMoneyByCurrency([])).toEqual([]);
  });

  it("moneyToCents rejects garbage as 0 (defensive)", () => {
    expect(moneyToCents("nope")).toBe(0n);
    expect(moneyToCents("12.345").toString()).toBe("1234");
  });
});
