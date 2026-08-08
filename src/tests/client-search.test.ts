// TZ №14 BUG-02 — единый поиск клиентов (pure + mock DB).
// Доказывает: оба call-site (справочник / продажа) строят ОДИН И ТОТ ЖЕ
// name/phone OR; partial / case / пробелы; sale attachAnyExisting.

import { describe, expect, it, vi } from "vitest";
import {
  CLIENT_SEARCH_MAX_TAKE,
  CLIENT_SEARCH_SALE_TAKE,
  clientSearchOrFilters,
  clientSearchWhere,
  normalizeClientSearchQuery,
  searchClients,
} from "@/lib/client-search";

describe("normalizeClientSearchQuery", () => {
  it("trim + collapse internal spaces", () => {
    expect(normalizeClientSearchQuery("  Тимур  ")).toBe("Тимур");
    expect(normalizeClientSearchQuery("Ти  мур")).toBe("Ти мур");
    expect(normalizeClientSearchQuery("\t  ")).toBe("");
  });
});

describe("clientSearchOrFilters — shared name + phone", () => {
  it("empty → no filters", () => {
    expect(clientSearchOrFilters("")).toEqual([]);
    expect(clientSearchOrFilters("   ")).toEqual([]);
  });

  it("name: contains + insensitive; phone: raw contains", () => {
    const or = clientSearchOrFilters("Тимур");
    expect(or).toContainEqual({
      name: { contains: "Тимур", mode: "insensitive" },
    });
    expect(or).toContainEqual({ phone: { contains: "Тимур" } });
  });

  it("partial mid-name (Тим) still contains on name", () => {
    const or = clientSearchOrFilters("Тим");
    expect(or[0]).toEqual({
      name: { contains: "Тим", mode: "insensitive" },
    });
  });

  it("case folded only via mode:insensitive (query kept as typed after space collapse)", () => {
    const or = clientSearchOrFilters("тиМУР");
    expect(or[0]).toEqual({
      name: { contains: "тиМУР", mode: "insensitive" },
    });
  });

  it("phone digits ≥3 add digits-only contains (formatting tolerance)", () => {
    const or = clientSearchOrFilters("+998 90 123");
    const phones = or.filter(
      (c) => "phone" in c && typeof (c as { phone: unknown }).phone === "object",
    );
    expect(phones.length).toBeGreaterThanOrEqual(2);
    expect(or).toContainEqual({ phone: { contains: "99890123" } });
  });

  it("extra spaces collapsed before name contains", () => {
    const or = clientSearchOrFilters("  Иван   Петров ");
    expect(or[0]).toEqual({
      name: { contains: "Иван Петров", mode: "insensitive" },
    });
  });
});

describe("clientSearchWhere — directory scope + same OR", () => {
  it("owner: no managerId, same OR as clientSearchOrFilters", () => {
    const where = clientSearchWhere({
      q: "Тим",
      canSeeAllClients: true,
      actorId: "owner-1",
    });
    expect(where.managerId).toBeUndefined();
    expect(where.OR).toEqual(clientSearchOrFilters("Тим"));
  });

  it("manager: managerId = actor, same OR (name not phone-only)", () => {
    const where = clientSearchWhere({
      q: "Тимур",
      canSeeAllClients: false,
      actorId: "mgr-9",
    });
    expect(where.managerId).toBe("mgr-9");
    expect(where.OR).toEqual(clientSearchOrFilters("Тимур"));
    // Name branch present — not phone-only.
    expect(
      (where.OR as { name?: unknown }[]).some((c) => c.name != null),
    ).toBe(true);
  });

  it("type filter composes without dropping OR", () => {
    const where = clientSearchWhere({
      q: "ООО",
      canSeeAllClients: true,
      actorId: null,
      type: "B2B",
    });
    expect(where.type).toBe("B2B");
    expect(where.OR).toEqual(clientSearchOrFilters("ООО"));
  });
});

describe("searchClients — both call sites same OR; sale attachAnyExisting", () => {
  it("directory-style (scoped only): uses clientSearchWhere OR", async () => {
    const findMany = vi.fn(async () => [
      {
        id: "c1",
        name: "Тимур Каримов",
        phone: "+998901111111",
        type: "B2C",
      },
    ]);
    const db = { client: { findMany } } as never;

    const hits = await searchClients(db, {
      q: "тим",
      canSeeAllClients: false,
      actorId: "mgr-1",
      take: 20,
      attachAnyExisting: false,
    });

    expect(hits).toHaveLength(1);
    expect(hits[0]!.name).toBe("Тимур Каримов");
    expect(findMany).toHaveBeenCalledTimes(1);
    const arg = findMany.mock.calls[0]![0] as unknown as {
      where: { managerId?: string; OR?: unknown };
      take: number;
    };
    expect(arg.where.managerId).toBe("mgr-1");
    expect(arg.where.OR).toEqual(clientSearchOrFilters("тим"));
    expect(arg.take).toBeLessThanOrEqual(CLIENT_SEARCH_MAX_TAKE);
  });

  it("sale attachAnyExisting: second query global OR when attaching other manager's card by NAME", async () => {
    const findMany = vi
      .fn()
      // 1) scoped empty (manager has no own clients matching)
      .mockResolvedValueOnce([])
      // 2) global name/phone OR finds owner-created card
      .mockResolvedValueOnce([
        {
          id: "owner-client",
          name: "Тимур",
          phone: "998902222222",
          type: "B2C",
        },
      ]);

    const db = { client: { findMany } } as never;
    const hits = await searchClients(db, {
      q: "Тимур",
      canSeeAllClients: false,
      actorId: "mgr-other",
      take: CLIENT_SEARCH_SALE_TAKE,
      attachAnyExisting: true,
    });

    expect(hits.map((h) => h.id)).toEqual(["owner-client"]);
    expect(findMany).toHaveBeenCalledTimes(2);
    const scoped = findMany.mock.calls[0]![0] as unknown as {
      where: { managerId?: string; OR?: unknown };
    };
    const global = findMany.mock.calls[1]![0] as unknown as {
      where: { managerId?: string; OR?: unknown };
    };
    expect(scoped.where.managerId).toBe("mgr-other");
    expect(scoped.where.OR).toEqual(clientSearchOrFilters("Тимур"));
    // Global: same OR, no managerId
    expect(global.where.managerId).toBeUndefined();
    expect(global.where.OR).toEqual(clientSearchOrFilters("Тимур"));
  });

  it("sale + directory share identical OR for the same q (contract)", () => {
    const samples = ["Тим", "тимур", "  Иван  ", "+998 90", "901234567"];
    for (const q of samples) {
      const dir = clientSearchWhere({
        q,
        canSeeAllClients: true,
        actorId: "o",
      });
      const saleScoped = clientSearchWhere({
        q,
        canSeeAllClients: false,
        actorId: "m",
      });
      expect(dir.OR).toEqual(clientSearchOrFilters(q));
      expect(saleScoped.OR).toEqual(clientSearchOrFilters(q));
      expect(dir.OR).toEqual(saleScoped.OR);
    }
  });

  it("empty q → no DB call", async () => {
    const findMany = vi.fn();
    const db = { client: { findMany } } as never;
    expect(
      await searchClients(db, {
        q: "  ",
        canSeeAllClients: true,
        actorId: null,
      }),
    ).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
