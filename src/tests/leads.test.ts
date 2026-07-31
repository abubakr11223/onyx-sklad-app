// A1 / W8-A (TZ §6.8) — чистые хелперы лидов (DB YO'Q).
import { describe, expect, it } from "vitest";
import {
  LEAD_KINDS,
  LEAD_KIND_RU,
  LEAD_STATUSES,
  LEAD_STATUS_FLOW,
  LEAD_STATUS_RU,
  canTransitionLead,
  decidePassiveViewAction,
  isLeadKind,
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

describe("LEAD_KIND — REQUEST vs VIEW (W8-A, manager must not confuse)", () => {
  it("isLeadKind accepts only REQUEST/VIEW", () => {
    expect(isLeadKind("REQUEST")).toBe(true);
    expect(isLeadKind("VIEW")).toBe(true);
    expect(isLeadKind("request")).toBe(false);
    expect(isLeadKind("")).toBe(false);
  });
  it("RU labels are distinct for REQUEST and VIEW", () => {
    expect(LEAD_KIND_RU.REQUEST).not.toBe(LEAD_KIND_RU.VIEW);
    expect(LEAD_KIND_RU.VIEW.toLowerCase()).toMatch(/интерес|смотрел/);
    expect(LEAD_KIND_RU.REQUEST.toLowerCase()).toMatch(/заявк/);
    for (const k of LEAD_KINDS) {
      expect(LEAD_KIND_RU[k].length).toBeGreaterThan(0);
    }
  });
});

describe("decidePassiveViewAction — dedupe rule (W8-A)", () => {
  it("no open leads → create", () => {
    expect(
      decidePassiveViewAction({
        existingOpenRequest: false,
        existingOpenViewId: null,
      }),
    ).toBe("create");
  });
  it("open VIEW exists → touch that id (no second row)", () => {
    expect(
      decidePassiveViewAction({
        existingOpenRequest: false,
        existingOpenViewId: "view-1",
      }),
    ).toEqual({ touch: "view-1" });
  });
  it("open REQUEST exists → skip VIEW (request is stronger)", () => {
    expect(
      decidePassiveViewAction({
        existingOpenRequest: true,
        existingOpenViewId: null,
      }),
    ).toBe("skip");
    // Even if a VIEW id is also present, request wins.
    expect(
      decidePassiveViewAction({
        existingOpenRequest: true,
        existingOpenViewId: "view-1",
      }),
    ).toBe("skip");
  });
});

describe("recordPassiveView — mock db (W8-A)", () => {
  it("creates VIEW when none open; second call touches, no second create", async () => {
    const { recordPassiveView } = await import("@/lib/leads");
    const rows: Array<{
      id: string;
      kind: string;
      status: string;
      createdById: string;
      stoneTypeId: string;
    }> = [];
    let seq = 0;
    const db = {
      lead: {
        findMany: async (args: {
          where: { createdById: string; stoneTypeId: string };
        }) =>
          rows.filter(
            (r) =>
              r.createdById === args.where.createdById &&
              r.stoneTypeId === args.where.stoneTypeId &&
              (r.status === "NEW" || r.status === "CONTACTED"),
          ),
        create: async (args: {
          data: {
            createdById: string;
            stoneTypeId: string;
            kind: string;
            status: string;
          };
        }) => {
          seq += 1;
          const row = {
            id: `lead-${seq}`,
            kind: args.data.kind,
            status: args.data.status,
            createdById: args.data.createdById,
            stoneTypeId: args.data.stoneTypeId,
          };
          rows.push(row);
          return { id: row.id };
        },
        update: async (args: { where: { id: string } }) => ({
          id: args.where.id,
        }),
      },
    };

    const a = await recordPassiveView(db as never, {
      createdById: "partner-1",
      stoneTypeId: "st-1",
    });
    expect(a.created).toBe(true);
    expect(a.id).toBe("lead-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("VIEW");

    const b = await recordPassiveView(db as never, {
      createdById: "partner-1",
      stoneTypeId: "st-1",
    });
    expect(b.created).toBe(false);
    expect(b.id).toBe("lead-1");
    expect(rows).toHaveLength(1);
  });

  it("skips VIEW create when open REQUEST exists for same pair", async () => {
    const { recordPassiveView } = await import("@/lib/leads");
    const rows = [
      {
        id: "req-1",
        kind: "REQUEST",
        status: "NEW",
        createdById: "partner-1",
        stoneTypeId: "st-1",
      },
    ];
    const create = async () => {
      throw new Error("create must not be called");
    };
    const db = {
      lead: {
        findMany: async () => rows,
        create,
        update: async () => ({ id: "x" }),
      },
    };
    const r = await recordPassiveView(db as never, {
      createdById: "partner-1",
      stoneTypeId: "st-1",
    });
    expect(r.created).toBe(false);
    expect(r.id).toBe("req-1");
  });
});
