// Zaxiradan tiklash — sof mantiq (src/lib/restore.ts). Baza kerak emas.
//
// Nega bu testlar: zaxira faylining o'zi yetarli emas — uni QAYTARIB QO'YA
// olish kerak. Tiklash birinchi marta falokat kunida sinalmasin.
import { describe, expect, it } from "vitest";
import { SNAPSHOT_TABLES } from "@/lib/db-snapshot";
import {
  DEFERRED_FIELDS,
  RESTORE_ALLOW_ENV,
  RESTORE_ALLOW_VALUE,
  RESTORE_ORDER,
  formatRestorePlan,
  parseRestoreArgs,
  parseSnapshotJson,
  planRestore,
  splitDeferred,
  validateRestoreArgs,
} from "@/lib/restore";

describe("RESTORE_ORDER — to'liq va tashqi kalitlarga mos", () => {
  it("zaxiradagi har bir jadval tiklash tartibida bor (va aksincha)", () => {
    expect([...RESTORE_ORDER].sort()).toEqual([...SNAPSHOT_TABLES].sort());
  });

  it("takror yo'q", () => {
    expect(new Set(RESTORE_ORDER).size).toBe(RESTORE_ORDER.length);
  });

  it("ota jadvallar bolalardan oldin turadi", () => {
    const pos = (t: string) => RESTORE_ORDER.indexOf(t as never);
    // Tanlangan, sxemadan aniq ma'lum bog'lamlar.
    expect(pos("user")).toBeLessThan(pos("client"));
    expect(pos("client")).toBeLessThan(pos("site"));
    expect(pos("stoneType")).toBeLessThan(pos("batch"));
    expect(pos("batch")).toBeLessThan(pos("batchLocation"));
    expect(pos("batch")).toBeLessThan(pos("slab"));
    expect(pos("slab")).toBeLessThan(pos("piece")); // Piece.originSlabId
    expect(pos("slab")).toBeLessThan(pos("photoRequest")); // PhotoRequest.slabId
    expect(pos("photoRequest")).toBeLessThan(pos("photoDispatch"));
    expect(pos("saleRecord")).toBeLessThan(pos("sample")); // Sample.saleRecordId
    expect(pos("sample")).toBeLessThan(pos("shipment")); // Shipment.sampleId
    expect(pos("shipment")).toBeLessThan(pos("shipmentLine"));
    expect(pos("shipment")).toBeLessThan(pos("showroomPlacement"));
    expect(pos("saleRecord")).toBeLessThan(pos("debt"));
  });

  it("halqa faqat Slab.photoRequestId orqali va u keyinga qoldirilgan", () => {
    expect(DEFERRED_FIELDS.slab).toEqual(["photoRequestId"]);
  });
});

describe("parseSnapshotJson", () => {
  const good = JSON.stringify({
    version: 1,
    takenAt: "2026-08-24T21:00:00.000Z",
    counts: { user: 1 },
    rows: { user: [{ id: "u1" }] },
  });

  it("to'g'ri fayl → ok", () => {
    const r = parseSnapshotJson(good);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.snapshot.rows.user).toEqual([{ id: "u1" }]);
  });

  it("buzilgan JSON → aniq xato, baza ochilmaydi", () => {
    const r = parseSnapshotJson("{ bu json emas");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/JSON o'qilmadi/);
  });

  it("noma'lum versiya → rad", () => {
    const r = parseSnapshotJson(JSON.stringify({ version: 2, takenAt: "x", rows: {} }));
    expect(r.ok).toBe(false);
  });

  it("rows yo'q yoki massiv emas → rad", () => {
    expect(parseSnapshotJson(JSON.stringify({ version: 1, takenAt: "2026-08-24" })).ok).toBe(false);
    const r = parseSnapshotJson(
      JSON.stringify({ version: 1, takenAt: "2026-08-24", rows: { user: 5 } }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/user/);
  });
});

describe("planRestore", () => {
  it("jami sanoq va tartib bo'yicha qadamlar", () => {
    const plan = planRestore({
      version: 1,
      takenAt: "2026-08-24T21:00:00.000Z",
      counts: {},
      rows: { user: [{ id: "u1" }], batch: [{ id: "b1" }, { id: "b2" }] },
    });
    expect(plan.total).toBe(3);
    expect(plan.steps.find((s) => s.table === "batch")?.count).toBe(2);
    expect(plan.steps.map((s) => s.table)).toEqual([...RESTORE_ORDER]);
  });

  it("notanish jadval ogohlantiradi, lekin tiklashni to'xtatmaydi", () => {
    const plan = planRestore({
      version: 1,
      takenAt: "2026-08-24T21:00:00.000Z",
      counts: {},
      rows: { user: [], yangiJadval: [{ id: "x" }] },
    });
    expect(plan.unknownTables).toEqual(["yangiJadval"]);
  });

  it("keyinga qoldiriladigan bog'lamlar sanaladi", () => {
    const plan = planRestore({
      version: 1,
      takenAt: "2026-08-24T21:00:00.000Z",
      counts: {},
      rows: {
        slab: [
          { id: "s1", photoRequestId: "pr1" },
          { id: "s2", photoRequestId: null },
        ],
      },
    });
    expect(plan.deferredRows).toBe(1);
  });

  it("reja matnida sana, jami va notanish jadval ko'rinadi", () => {
    const text = formatRestorePlan(
      planRestore({
        version: 1,
        takenAt: "2026-08-24T21:00:00.000Z",
        counts: {},
        rows: { user: [{ id: "u1" }], eski: [{ id: "x" }] },
      }),
    );
    expect(text).toContain("2026-08-24");
    expect(text).toContain("Jami yozuv: 1");
    expect(text).toContain("eski");
  });
});

describe("splitDeferred — halqani uzish", () => {
  it("photoRequestId null bilan qo'yiladi, keyin UPDATE ro'yxatiga tushadi", () => {
    const { base, updates, skipped } = splitDeferred("slab", [
      { id: "s1", label: "A", photoRequestId: "pr1" },
      { id: "s2", label: "B", photoRequestId: null },
    ]);
    expect(base[0]).toEqual({ id: "s1", label: "A", photoRequestId: null });
    expect(base[1]).toEqual({ id: "s2", label: "B", photoRequestId: null });
    expect(updates).toEqual([{ id: "s1", data: { photoRequestId: "pr1" } }]);
    expect(skipped).toBe(0);
  });

  it("id'siz yozuv — bog'lam tiklanmaydi, lekin sanaladi", () => {
    const { updates, skipped } = splitDeferred("slab", [{ photoRequestId: "pr1" }]);
    expect(updates).toEqual([]);
    expect(skipped).toBe(1);
  });

  it("keyinga qoldirilmaydigan jadval — yozuvlar o'zgarmaydi", () => {
    const rows = [{ id: "b1", x: 1 }];
    const { base, updates } = splitDeferred("batch", rows);
    expect(base).toBe(rows);
    expect(updates).toEqual([]);
  });
});

describe("darvozalar", () => {
  it("env berilmasa — rad", () => {
    const r = validateRestoreArgs(parseRestoreArgs(["--file=a.json"], {}));
    expect(r).toEqual({ ok: false, error: "env" });
  });

  it("fayl ko'rsatilmasa — rad", () => {
    const env = { [RESTORE_ALLOW_ENV]: RESTORE_ALLOW_VALUE };
    expect(validateRestoreArgs(parseRestoreArgs([], env))).toEqual({
      ok: false,
      error: "file",
    });
  });

  it("--execute bor, --yes yo'q — rad (tasodifan yozilmasin)", () => {
    const env = { [RESTORE_ALLOW_ENV]: RESTORE_ALLOW_VALUE };
    expect(
      validateRestoreArgs(parseRestoreArgs(["--file=a.json", "--execute"], env)),
    ).toEqual({ ok: false, error: "confirm" });
  });

  // Audit 2026-09-02 — «buzib kirishdi» ssenariysi uchun ikkinchi rejim.
  it("--overwrite tanib olinadi va standartda o'chiq turadi", () => {
    const off = parseRestoreArgs(["--file=a.json"], {});
    expect(off.overwrite).toBe(false);
    const on = parseRestoreArgs(["--file=a.json", "--overwrite"], {});
    expect(on.overwrite).toBe(true);
  });

  it("--overwrite darvozalardan o'tib natijaga tushadi", () => {
    const r = validateRestoreArgs({
      file: "a.json",
      execute: true,
      confirm: true,
      overwrite: true,
      envAllow: true,
    });
    expect(r).toEqual({
      ok: true,
      file: "a.json",
      execute: true,
      willWrite: true,
      overwrite: true,
    });
  });

  it("bayroqsiz — quruq yurgizish (willWrite=false)", () => {
    const env = { [RESTORE_ALLOW_ENV]: RESTORE_ALLOW_VALUE };
    const r = validateRestoreArgs(parseRestoreArgs(["--file=a.json"], env));
    expect(r).toEqual({ ok: true, file: "a.json", execute: false, willWrite: false, overwrite: false });
  });

  it("to'liq to'plam — yozishga ruxsat", () => {
    const env = { [RESTORE_ALLOW_ENV]: RESTORE_ALLOW_VALUE };
    const r = validateRestoreArgs(
      parseRestoreArgs(["--file=a.json", "--execute", "--yes"], env),
    );
    expect(r).toEqual({ ok: true, file: "a.json", execute: true, willWrite: true, overwrite: false });
  });
});
