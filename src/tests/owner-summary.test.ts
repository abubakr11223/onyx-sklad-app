// TZ №10+11 Этап 5 — owner summary pure tests (no DB).
import { describe, expect, it } from "vitest";
import {
  b2bVsB2cSplit,
  buildClientRanks,
  buildSiteRanks,
  computeOwnerSummary,
  defaultMonthPeriod,
  periodFromSearchParams,
  rankByRevenue,
  salesInPeriod,
  type OwnerSummarySale,
} from "@/lib/owner-summary";

function sale(
  over: Partial<OwnerSummarySale> & {
    id: string;
    soldAt: Date;
  },
): OwnerSummarySale {
  return {
    id: over.id,
    soldAt: over.soldAt,
    returnedAt: over.returnedAt ?? null,
    price: over.price ?? "100",
    currency: over.currency ?? "UZS",
    qtySlabs: over.qtySlabs ?? 1,
    qtyAreaM2: over.qtyAreaM2 ?? null,
    clientId: over.clientId !== undefined ? over.clientId : "c1",
    siteId: over.siteId !== undefined ? over.siteId : null,
    clientType: over.clientType !== undefined ? over.clientType : "B2C",
    clientName: over.clientName ?? "Клиент",
    siteName: over.siteName ?? null,
  };
}

const AUG = {
  from: new Date("2026-08-01T00:00:00.000+05:00"),
  to: new Date("2026-08-31T23:59:59.999+05:00"),
  fromISO: "2026-08-01",
  toISO: "2026-08-31",
};

describe("period helpers", () => {
  it("defaultMonthPeriod is current Tashkent month", () => {
    const p = defaultMonthPeriod(new Date("2026-08-15T12:00:00.000Z"));
    expect(p.fromISO).toBe("2026-08-01");
    expect(p.toISO).toBe("2026-08-31");
  });

  it("periodFromSearchParams accepts valid range", () => {
    const p = periodFromSearchParams("2026-07-01", "2026-07-15");
    expect(p.fromISO).toBe("2026-07-01");
    expect(p.toISO).toBe("2026-07-15");
  });
});

describe("salesInPeriod + return excludes revenue", () => {
  it("returned sale is out of tops and grand totals", () => {
    const sales = [
      sale({
        id: "1",
        soldAt: new Date("2026-08-10T10:00:00.000Z"),
        price: "1000",
        currency: "UZS",
        clientId: "c1",
        clientName: "Али",
      }),
      sale({
        id: "2",
        soldAt: new Date("2026-08-11T10:00:00.000Z"),
        price: "500",
        currency: "UZS",
        clientId: "c1",
        clientName: "Али",
        returnedAt: new Date("2026-08-12T10:00:00.000Z"),
      }),
    ];
    const before = computeOwnerSummary(
      sales.map((s) => ({ ...s, returnedAt: null })),
      AUG,
    );
    const after = computeOwnerSummary(sales, AUG);
    // Return of 500 UZS reduces client total 1500 → 1000
    expect(before.grandTotals).toEqual([
      { currency: "UZS", amount: "1500.00", count: 2 },
    ]);
    expect(after.grandTotals).toEqual([
      { currency: "UZS", amount: "1000.00", count: 1 },
    ]);
    expect(after.topClients[0].totals[0].amount).toBe("1000.00");
    expect(Number(after.grandTotals[0].amount)).toBeLessThan(
      Number(before.grandTotals[0].amount),
    );
  });

  it("out-of-period sales ignored", () => {
    const sales = [
      sale({
        id: "1",
        soldAt: new Date("2026-07-01T10:00:00.000Z"),
        price: "999",
      }),
    ];
    expect(salesInPeriod(sales, AUG)).toHaveLength(0);
    expect(computeOwnerSummary(sales, AUG).saleCount).toBe(0);
  });
});

describe("top clients / sites", () => {
  it("ranks clients by UZS then USD (never mixed)", () => {
    const sales = [
      sale({
        id: "1",
        soldAt: new Date("2026-08-05T00:00:00.000Z"),
        clientId: "a",
        clientName: "А",
        price: "100",
        currency: "UZS",
      }),
      sale({
        id: "2",
        soldAt: new Date("2026-08-06T00:00:00.000Z"),
        clientId: "b",
        clientName: "Б",
        price: "50",
        currency: "USD",
      }),
      sale({
        id: "3",
        soldAt: new Date("2026-08-07T00:00:00.000Z"),
        clientId: "b",
        clientName: "Б",
        price: "200",
        currency: "UZS",
      }),
    ];
    const ranks = rankByRevenue(buildClientRanks(salesInPeriod(sales, AUG)));
    expect(ranks[0].clientId).toBe("b"); // 200 UZS
    expect(ranks[0].totals.find((t) => t.currency === "UZS")?.amount).toBe(
      "200.00",
    );
    expect(ranks[0].totals.find((t) => t.currency === "USD")?.amount).toBe(
      "50.00",
    );
    // No single combined field
    expect(
      (ranks[0].totals as Array<Record<string, unknown>>).some(
        (r) => "totalAll" in r,
      ),
    ).toBe(false);
  });

  it("top sites only include sales with siteId", () => {
    const sales = [
      sale({
        id: "1",
        soldAt: new Date("2026-08-05T00:00:00.000Z"),
        siteId: "s1",
        siteName: "ЖК Ривьера",
        price: "5000",
        currency: "UZS",
        clientType: "B2B",
      }),
      sale({
        id: "2",
        soldAt: new Date("2026-08-06T00:00:00.000Z"),
        siteId: null,
        price: "9000",
        currency: "UZS",
        clientType: "B2C",
      }),
    ];
    const sites = buildSiteRanks(salesInPeriod(sales, AUG));
    expect(sites).toHaveLength(1);
    expect(sites[0].name).toBe("ЖК Ривьера");
    expect(sites[0].totals[0].amount).toBe("5000.00");
  });

  it("unlinked legacy sales get own bucket, not attributed", () => {
    const sales = [
      sale({
        id: "1",
        soldAt: new Date("2026-08-05T00:00:00.000Z"),
        clientId: null,
        clientName: "Текст",
        clientType: null,
        price: "77",
        currency: "USD",
      }),
    ];
    const ranks = buildClientRanks(salesInPeriod(sales, AUG));
    expect(ranks).toHaveLength(1);
    expect(ranks[0].unlinked).toBe(true);
    expect(ranks[0].name).toMatch(/карточки/i);
  });
});

describe("B2B vs B2C", () => {
  it("site or B2B client → B2B; private B2C → B2C; null client → unlinked", () => {
    const sales = [
      sale({
        id: "1",
        soldAt: new Date("2026-08-05T00:00:00.000Z"),
        clientId: "c1",
        clientType: "B2B",
        siteId: null,
        price: "100",
        currency: "UZS",
        qtySlabs: 2,
      }),
      sale({
        id: "2",
        soldAt: new Date("2026-08-06T00:00:00.000Z"),
        clientId: "c2",
        clientType: "B2C",
        siteId: "s1",
        siteName: "Дом",
        price: "50",
        currency: "USD",
        qtySlabs: 1,
      }),
      sale({
        id: "3",
        soldAt: new Date("2026-08-07T00:00:00.000Z"),
        clientId: "c3",
        clientType: "B2C",
        siteId: null,
        price: "30",
        currency: "UZS",
        qtySlabs: 1,
      }),
      sale({
        id: "4",
        soldAt: new Date("2026-08-08T00:00:00.000Z"),
        clientId: null,
        clientType: null,
        price: "10",
        currency: "UZS",
      }),
    ];
    const seg = b2bVsB2cSplit(salesInPeriod(sales, AUG));
    // B2B: id1 (B2B) + id2 (has site)
    expect(seg.b2b.volume.saleCount).toBe(2);
    expect(seg.b2b.totals.find((t) => t.currency === "UZS")?.amount).toBe(
      "100.00",
    );
    expect(seg.b2b.totals.find((t) => t.currency === "USD")?.amount).toBe(
      "50.00",
    );
    // B2C: only id3
    expect(seg.b2c.volume.saleCount).toBe(1);
    expect(seg.b2c.totals[0]).toEqual({
      currency: "UZS",
      amount: "30.00",
      count: 1,
    });
    // unlinked id4
    expect(seg.unlinked.volume.saleCount).toBe(1);
  });
});

describe("computeOwnerSummary integration", () => {
  it("full snapshot", () => {
    const sales = [
      sale({
        id: "1",
        soldAt: new Date("2026-08-10T00:00:00.000Z"),
        clientId: "c1",
        clientName: "Строй",
        clientType: "B2B",
        siteId: "s1",
        siteName: "ЖК",
        price: "1000000",
        currency: "UZS",
        qtySlabs: 10,
      }),
      sale({
        id: "2",
        soldAt: new Date("2026-08-11T00:00:00.000Z"),
        clientId: "c2",
        clientName: "Иван",
        clientType: "B2C",
        price: "200",
        currency: "USD",
        qtySlabs: 1,
      }),
    ];
    const s = computeOwnerSummary(sales, AUG, 5);
    expect(s.topSites[0].name).toBe("ЖК");
    expect(s.topClients[0].name).toBe("Строй");
    expect(s.segments.b2b.volume.qtySlabs).toBe(10);
    expect(s.segments.b2c.volume.qtySlabs).toBe(1);
    expect(s.saleCount).toBe(2);
  });
});


describe("no silent truncation — totals match full enumeration", () => {
  it("5500 sales (above old take:5000) → grand total = exact sum", () => {
    // Old loadOwnerSummary used take:5000 and silently dropped the rest.
    // computeOwnerSummary + full list must never drop rows.
    const n = 5500;
    const sales: OwnerSummarySale[] = [];
    for (let i = 0; i < n; i++) {
      sales.push(
        sale({
          id: `s${i}`,
          soldAt: new Date("2026-08-10T12:00:00.000Z"),
          price: "1",
          currency: "UZS",
          clientId: i % 2 === 0 ? "c-even" : "c-odd",
          clientName: i % 2 === 0 ? "Even" : "Odd",
        }),
      );
    }
    const summary = computeOwnerSummary(sales, AUG, 10);
    expect(summary.saleCount).toBe(n);
    expect(summary.grandTotals).toEqual([
      { currency: "UZS", amount: "5500.00", count: n },
    ]);
    // Both clients present in ranks (top by equal UZS uses saleCount tie-break)
    const ids = new Set(summary.topClients.map((c) => c.clientId));
    expect(ids.has("c-even")).toBe(true);
    expect(ids.has("c-odd")).toBe(true);
    const even = summary.topClients.find((c) => c.clientId === "c-even")!;
    expect(even.totals[0].amount).toBe("2750.00");
  });

  it("OWNER_SUMMARY_PAGE_SIZE is a page size, not a hard max", async () => {
    const { OWNER_SUMMARY_PAGE_SIZE } = await import("@/lib/owner-summary");
    expect(OWNER_SUMMARY_PAGE_SIZE).toBeGreaterThan(0);
    expect(OWNER_SUMMARY_PAGE_SIZE).toBeLessThanOrEqual(5000);
  });
});

