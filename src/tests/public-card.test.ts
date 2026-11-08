// ТЗ №20 H — карточка камня по скану: виды по ролям, заявка клиента
// (анти-спам, Telegram, «Менеджер связался»), язык публичных страниц,
// счётчик сканирований, ориентир цены. Без БД — mock-клиенты.
import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { capabilitiesFor, DENY_ALL } from "@/lib/permissions";
import {
  availabilityOf,
  buildCardView,
  loadCardFacts,
  viewerForRole,
  type CardFacts,
} from "@/lib/public-card";
import {
  claimLeadFromTelegram,
  decideLeadIpLimit,
  handleLeadClaimCallback,
  leadClaimKeyboard,
  leadDedupeKey,
  parseLeadClaimCallbackData,
  parsePublicLeadForm,
  phoneKeyVariants,
  submitPublicLead,
  PUBLIC_LEAD_IP_LIMIT,
} from "@/lib/public-lead";
import {
  localeFromAcceptLanguage,
  publicDict,
  resolvePublicLocale,
} from "@/lib/public-i18n";
import { recordScan, scanDay, shouldCountScan } from "@/lib/stone-scans";
import { formatPriceHint, parsePriceHint } from "@/lib/price-hint";
import { describeHistoryEntry } from "@/lib/history-labels";

const OPTS = { canSeePurchasePrice: false };

function facts(over: Partial<CardFacts> = {}): CardFacts {
  return {
    code: "ONX-7K3QD",
    kind: "PATTERN",
    stoneTypeId: "st1",
    ids: {
      stoneTypeId: "st1",
      batchId: "b1",
      batchPatternId: "p1",
      slabId: null,
      pieceId: null,
    },
    name: "Травертин Классик",
    rockType: "Травертин",
    color: "бежевый",
    description: "Тёплый бежевый",
    detail: "светлый",
    size: "280 × 160 см",
    thickness: "2 см",
    photoIds: ["ph1"],
    interiorPhotoIds: ["int1"],
    textures: [{ code: "ONX-7K3QD", detail: "светлый" }],
    free: { slabs: 7, areaM2: 31.36 },
    freePieces: 2,
    inShowroom: false,
    unitStatus: null,
    staff: {
      rows: [
        {
          id: "p1",
          batchId: "b1",
          label: "узор «светлый»",
          code: null,
          format: "280 × 160 см · 2 см",
          freeSlabs: 7,
          freeAreaM2: 31.36,
          heldSlabs: 3,
          heldAreaM2: 13.44,
          location: "Блок A1 · ориентир 2",
        },
      ],
      location: "Блок A1 · ориентир 2",
      activeReservations: 1,
      reservations: [
        {
          id: "r1",
          customerName: "Тимур Алиев",
          managerName: "Азиз Менеджер",
          expiresAt: new Date("2026-11-10T00:00:00Z"),
          what: "3 пл.",
        },
      ],
      priceHintUzsM2: 450000,
      priceHintUsdM2: 35.5,
      showroomBatchId: "b1:p1",
    },
    ...over,
  };
}

// ───────────────────────── Виды по ролям (таблица 9.1) ─────────────────────────

describe("viewerForRole", () => {
  it("нет сессии → клиент, PARTNER → партнёр, остальные → сотрудник", () => {
    expect(viewerForRole(null)).toBe("client");
    expect(viewerForRole(undefined)).toBe("client");
    expect(viewerForRole("PARTNER")).toBe("partner");
    for (const r of ["OWNER", "MANAGER", "WAREHOUSE", "WAREHOUSE_LEAD"]) {
      expect(viewerForRole(r)).toBe("staff");
    }
  });
});

describe("buildCardView — клиент не видит цифр, локаций, цен, клиентов, менеджеров", () => {
  const view = buildCardView(facts(), "client", DENY_ALL);

  it("только витрина и наличие словом", () => {
    expect(Object.keys(view).sort()).toEqual(
      [
        "availability",
        "code",
        "color",
        "description",
        "detail",
        "has3d", // ТЗ №20 J — «Показать в интерьере»
        "interiorPhotoIds", // ТЗ №20 J — «В интерьере»
        "kind",
        "name",
        "photoIds",
        "rockType",
        "size",
        "thickness",
        "viewer",
      ].sort(),
    );
    expect(view.availability).toBe("IN_STOCK");
  });

  it("ТЗ №20 J — 3D клиенту можно, скачивание текстуры — нет", () => {
    expect(view.has3d).toBe(true);
    expect(view.interiorPhotoIds).toEqual(["int1"]);
    expect("textureDownloads" in view).toBe(false);
    expect(JSON.stringify(view)).not.toContain("/api/texture/");
  });

  it("ТЗ №20 J — партнёр и сотрудник скачивают текстуру", () => {
    for (const v of ["partner", "staff"] as const) {
      const pv = buildCardView(facts(), v, DENY_ALL);
      if (pv.viewer === "client") throw new Error("unexpected");
      expect(pv.textureDownloads).toEqual([
        { code: "ONX-7K3QD", label: "узор «светлый»", href: "/api/texture/ONX-7K3QD" },
      ]);
    }
  });

  it("ТЗ №20 J — без текстуры кнопки 3D нет", () => {
    expect(buildCardView(facts({ textures: [] }), "client", DENY_ALL).has3d).toBe(false);
  });

  it("в сериализованном виде нет остатка, места, цены, имён", () => {
    const json = JSON.stringify(view);
    for (const leak of [
      "31.36",
      "\"7\"",
      "Блок",
      "450000",
      "35.5",
      "Тимур",
      "Азиз",
      "free",
      "priceHint",
      "reservations",
      "location",
      "actions",
    ]) {
      expect(json).not.toContain(leak);
    }
  });

  it("даже с полными правами вид клиента тот же (решает viewer, не caps)", () => {
    const v = buildCardView(facts(), "client", capabilitiesFor("OWNER", OPTS));
    expect(v).toEqual(view);
  });
});

describe("buildCardView — партнёр", () => {
  const view = buildCardView(facts(), "partner", capabilitiesFor("PARTNER", OPTS));
  it("свободно плиты и м², но без узоров, броней, локаций и цены", () => {
    expect(view.viewer).toBe("partner");
    if (view.viewer !== "partner") throw new Error();
    expect(view.freeSlabs).toBe(7);
    expect(view.freeAreaM2).toBeCloseTo(31.36);
    const json = JSON.stringify(view);
    for (const leak of ["Блок", "450000", "Тимур", "Азиз", "priceHint", "reservations", "rows"]) {
      expect(json).not.toContain(leak);
    }
  });
});

describe("buildCardView — сотрудник", () => {
  it("менеджер: узоры, брони, локация, ориентир, кнопки продажи/брони/шоу-рума", () => {
    const view = buildCardView(facts(), "staff", capabilitiesFor("MANAGER", OPTS));
    if (view.viewer !== "staff") throw new Error();
    expect(view.rows).toHaveLength(1);
    expect(view.reservations[0].customerName).toBe("Тимур Алиев");
    expect(view.location).toBe("Блок A1 · ориентир 2");
    expect(view.priceHint).toEqual({ uzsM2: 450000, usdM2: 35.5 });
    expect(view.actions.sellHref).toBe(
      `/prodazha?catalogQ=${encodeURIComponent("Травертин Классик")}`,
    );
    expect(view.actions.reserveHref).toContain("/bron?catalogQ=");
    expect(view.actions.showroomHref).toBe(`/shourum?batch=${encodeURIComponent("b1:p1")}`);
    expect(view.actions.historyHref).toBeNull(); // история — только владелец
  });

  it("складчик видит ориентир, но не продаёт и не бронирует", () => {
    const view = buildCardView(facts(), "staff", capabilitiesFor("WAREHOUSE", OPTS));
    if (view.viewer !== "staff") throw new Error();
    expect(view.priceHint).not.toBeNull();
    expect(view.actions.sellHref).toBeNull();
    expect(view.actions.reserveHref).toBeNull();
    expect(view.actions.showroomHref).not.toBeNull();
  });

  it("код плиты → продажа и шоу-рум открываются с этой плитой", () => {
    const f = facts({
      kind: "SLAB",
      ids: { stoneTypeId: "st1", batchId: "b1", batchPatternId: "p1", slabId: "s9", pieceId: null },
    });
    const view = buildCardView(f, "staff", capabilitiesFor("OWNER", OPTS));
    if (view.viewer !== "staff") throw new Error();
    expect(view.actions.sellHref).toBe("/prodazha?slab=s9");
    expect(view.actions.showroomHref).toBe(`/shourum?unit=${encodeURIComponent("SLAB:s9")}`);
    expect(view.actions.historyHref).toBe("/istoriya");
  });
});

describe("availabilityOf", () => {
  const base = { free: { slabs: 0, areaM2: 0 }, freePieces: 0, inShowroom: false, unitStatus: null };
  it("проданный / разбитый камень — «Нет в наличии»", () => {
    expect(availabilityOf({ ...base, kind: "STONE_TYPE" })).toBe("OUT_OF_STOCK");
    expect(availabilityOf({ ...base, kind: "SLAB", unitStatus: "SOLD" })).toBe("OUT_OF_STOCK");
    expect(availabilityOf({ ...base, kind: "PIECE", unitStatus: "BROKEN_OFFCUT" })).toBe(
      "OUT_OF_STOCK",
    );
  });
  it("в шоу-руме — когда свободного нет, а витрина есть", () => {
    expect(availabilityOf({ ...base, kind: "BATCH", inShowroom: true })).toBe("IN_SHOWROOM");
    expect(availabilityOf({ ...base, kind: "SLAB", unitStatus: "SHOWROOM" })).toBe("IN_SHOWROOM");
  });
  it("свободный остаток или кусок — «В наличии» (даже если что-то в шоу-руме)", () => {
    expect(
      availabilityOf({ ...base, kind: "STONE_TYPE", free: { slabs: 1, areaM2: 4 }, inShowroom: true }),
    ).toBe("IN_STOCK");
    expect(availabilityOf({ ...base, kind: "STONE_TYPE", freePieces: 1 })).toBe("IN_STOCK");
  });
});

describe("loadCardFacts — служебное для клиента даже не грузится", () => {
  it("код плиты, клиент: брони/партии/узоры не запрашиваются, цены нет в select", async () => {
    const forbidden = () => {
      throw new Error("служебный запрос для клиента");
    };
    const stoneTypeFind = vi.fn(async () => ({
      name: "Травертин Классик",
      rockType: "Травертин",
      color: null,
      description: null,
    }));
    const db = {
      stoneType: { findUnique: stoneTypeFind, findMany: async () => [] },
      // Партии по коду — только для подписи этикетки (loadQrLabels); остаток
      // партий/узоров для клиента не читается.
      batch: {
        findMany: async (a: { where: { code?: unknown } }) => (a.where.code ? [] : forbidden()),
      },
      batchPattern: { findMany: async () => [] },
      slab: {
        findMany: async () => [],
        findUnique: async () => ({
          status: "SOLD",
          needsCheck: false,
          areaM2: 4.48,
          block: "A1",
          landmark: "2",
        }),
      },
      piece: { findMany: async () => [] },
      photo: { findMany: async () => [{ id: "ph1" }] },
      stoneTexture: { findMany: async () => [] },
      reservation: { count: forbidden, findMany: forbidden },
    };
    const f = await loadCardFacts(
      db as never,
      {
        kind: "SLAB",
        code: "ONX-AAAAA",
        stoneTypeId: "st1",
        ids: { stoneTypeId: "st1", batchId: "b1", batchPatternId: null, slabId: "s1", pieceId: null },
      },
      { viewer: "client", caps: DENY_ALL, actorId: null },
    );
    expect(f).not.toBeNull();
    expect(f!.staff).toBeNull();
    expect(availabilityOf(f!)).toBe("OUT_OF_STOCK"); // продана — карточка всё равно открывается
    const sel = (stoneTypeFind.mock.calls[0] as unknown as [{ select: Record<string, boolean> }])[0]
      .select;
    expect(sel.priceHintUzsM2).toBe(false);
    expect(sel.priceHintUsdM2).toBe(false);
    expect(buildCardView(f!, "client", DENY_ALL).availability).toBe("OUT_OF_STOCK");
  });
});

// ───────────────────────── Заявка клиента: анти-спам ─────────────────────────

describe("parsePublicLeadForm", () => {
  it("ловушка заполнена → бот (без подсказки, что не так)", () => {
    expect(
      parsePublicLeadForm({ name: "", phone: "", honeypot: "http://spam" }).kind,
    ).toBe("bot");
  });
  it("имя и телефон обязательны; короткий телефон — неполный", () => {
    const r = parsePublicLeadForm({ name: " ", phone: "" });
    expect(r).toEqual({ kind: "invalid", errors: { name: "name", phone: "phone" } });
    const r2 = parsePublicLeadForm({ name: "Азиз", phone: "12-34" });
    expect(r2).toEqual({ kind: "invalid", errors: { phone: "phoneInvalid" } });
  });
  it("нормальная заявка: телефон в цифрах для сверки", () => {
    const r = parsePublicLeadForm({ name: "  Азиз  ", phone: "+998 90 123-45-67", comment: "" });
    expect(r).toEqual({
      kind: "ok",
      value: { name: "Азиз", phone: "+998 90 123-45-67", phoneKey: "998901234567", comment: null },
    });
  });
});

describe("одна заявка с телефона на камень в сутки (по Ташкенту)", () => {
  it("тот же ташкентский день → тот же ключ; после полуночи по Ташкенту — новый", () => {
    const a = leadDedupeKey("998901234567", "st1", new Date("2026-11-07T05:00:00Z"));
    const b = leadDedupeKey("998901234567", "st1", new Date("2026-11-07T18:59:00Z"));
    const c = leadDedupeKey("998901234567", "st1", new Date("2026-11-07T19:01:00Z")); // 00:01 08.11 Ташкент
    expect(a).toBe(b);
    expect(c).not.toBe(a);
    expect(c).toBe("998901234567|st1|2026-11-08");
  });
  it("другой камень — другой ключ", () => {
    const now = new Date("2026-11-07T05:00:00Z");
    expect(leadDedupeKey("1", "st1", now)).not.toBe(leadDedupeKey("1", "st2", now));
  });
  it("телефон с 998 и без — одни и те же клиенты", () => {
    expect(phoneKeyVariants("998901234567").sort()).toEqual(["901234567", "998901234567"]);
    expect(phoneKeyVariants("901234567").sort()).toEqual(["901234567", "998901234567"]);
  });
});

describe("не больше 10 заявок с IP в час", () => {
  const now = new Date("2026-11-07T10:00:00Z");
  it("9 в окне — можно, 10 — нельзя, через час — снова можно", () => {
    const firstAt = new Date(now.getTime() - 30 * 60 * 1000);
    expect(decideLeadIpLimit({ failures: 9, firstAt }, now).blocked).toBe(false);
    expect(decideLeadIpLimit({ failures: PUBLIC_LEAD_IP_LIMIT, firstAt }, now).blocked).toBe(true);
    const old = new Date(now.getTime() - 61 * 60 * 1000);
    expect(decideLeadIpLimit({ failures: 50, firstAt: old }, now).blocked).toBe(false);
    expect(decideLeadIpLimit(null, now).blocked).toBe(false);
  });
});

// ───────────────────────── submitPublicLead (mock БД) ─────────────────────────

function leadDb(over: {
  existingDedupe?: boolean;
  ipRow?: { failures: number; firstAt: Date } | null;
  createThrows?: unknown;
  client?: { id: string; name: string } | null;
} = {}) {
  const created: unknown[] = [];
  const audits: unknown[] = [];
  const upserts: unknown[] = [];
  const db = {
    stoneType: {
      findUnique: vi.fn(async (args: { where: { code?: string; id?: string } }) =>
        args.where.code === "ONX-7K3QD"
          ? { id: "st1" }
          : args.where.id === "st1"
            ? { name: "Травертин Классик" }
            : null,
      ),
    },
    batch: { findUnique: async () => null },
    batchPattern: { findUnique: async () => null },
    slab: { findUnique: async () => null },
    piece: { findUnique: async () => null },
    lead: {
      findUnique: vi.fn(async () => (over.existingDedupe ? { id: "old" } : null)),
    },
    loginAttempt: {
      findUnique: vi.fn(async () => over.ipRow ?? null),
      upsert: vi.fn(async (a: unknown) => {
        upserts.push(a);
        return {};
      }),
    },
    user: {
      findMany: vi.fn(async () => [{ telegramId: "111" }, { telegramId: "222" }]),
    },
    $queryRaw: vi.fn(async () => (over.client ? [over.client] : [])),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      if (over.createThrows) throw over.createThrows;
      return fn({
        lead: {
          create: async (a: unknown) => {
            created.push(a);
            return { id: "lead1" };
          },
        },
        auditLog: {
          create: async (a: unknown) => {
            audits.push(a);
            return {};
          },
        },
      });
    }),
  };
  return { db, created, audits, upserts };
}

const FORM = { name: "Азиз", phone: "+998 90 123 45 67", comment: "на кухню" };
const NOW = new Date("2026-11-07T08:00:00Z");

describe("submitPublicLead", () => {
  it("успех: «QR / каталог», «Новая», без автора, клиент привязан по телефону, Telegram всем", async () => {
    const { db, created, audits, upserts } = leadDb({ client: { id: "c1", name: "Азиз Каримов" } });
    const send = vi.fn(async () => ({ ok: true as const, messageId: 1 }));
    const r = await submitPublicLead(
      db as never,
      { code: "onx-7k3qd", form: FORM, ip: "1.2.3.4", now: NOW },
      { send },
    );
    expect(r).toEqual({ status: "ok", leadId: "lead1" });
    const data = (created[0] as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({
      createdById: null,
      source: "QR_CATALOG",
      status: "NEW",
      kind: "REQUEST",
      stoneTypeId: "st1",
      stoneCode: "ONX-7K3QD",
      clientName: "Азиз",
      clientId: "c1",
      phoneKey: "998901234567",
      dedupeKey: "998901234567|st1|2026-11-07",
    });
    // Клиент не создаётся — только ссылка на существующего.
    expect(Object.keys(db)).not.toContain("client");
    expect((audits[0] as { data: { payload: { kind: string } } }).data.payload.kind).toBe(
      "lead.qr_create",
    );
    expect(upserts).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(2);
    const calls = send.mock.calls as unknown as Array<[string, string, { reply_markup: unknown }]>;
    expect(calls[0][1]).toContain("Новая заявка: Травертин Классик ONX-7K3QD, Азиз +998 90 123 45 67");
    expect(calls[0][2].reply_markup).toEqual(leadClaimKeyboard("lead1"));
  });

  it("ловушка: «успех» без записи и без Telegram", async () => {
    const { db, created } = leadDb();
    const send = vi.fn();
    const r = await submitPublicLead(
      db as never,
      { code: "ONX-7K3QD", form: { ...FORM, honeypot: "x" }, ip: "1.2.3.4", now: NOW },
      { send },
    );
    expect(r).toEqual({ status: "ok", leadId: null });
    expect(created).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("второй раз с того же телефона на тот же камень в те же сутки — не проходит", async () => {
    const { db, created } = leadDb({ existingDedupe: true });
    const r = await submitPublicLead(
      db as never,
      { code: "ONX-7K3QD", form: FORM, ip: "1.2.3.4", now: NOW },
      { send: vi.fn() },
    );
    expect(r).toEqual({ status: "duplicate" });
    expect(created).toHaveLength(0);
  });

  it("гонка двух отправок: UNIQUE dedupeKey (P2002) → «уже оставили»", async () => {
    const { db } = leadDb({
      createThrows: new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "6.19.0",
      }),
    });
    const r = await submitPublicLead(
      db as never,
      { code: "ONX-7K3QD", form: FORM, ip: "", now: NOW },
      { send: vi.fn() },
    );
    expect(r).toEqual({ status: "duplicate" });
  });

  it("11-я заявка с IP за час — отказ до записи", async () => {
    const { db, created } = leadDb({
      ipRow: { failures: 10, firstAt: new Date(NOW.getTime() - 10 * 60 * 1000) },
    });
    const r = await submitPublicLead(
      db as never,
      { code: "ONX-7K3QD", form: FORM, ip: "1.2.3.4", now: NOW },
      { send: vi.fn() },
    );
    expect(r).toEqual({ status: "rate" });
    expect(created).toHaveLength(0);
  });

  it("неизвестный код и пустые поля", async () => {
    const { db } = leadDb();
    expect(
      await submitPublicLead(
        db as never,
        { code: "ONX-ZZZZZ", form: FORM, ip: "", now: NOW },
        { send: vi.fn() },
      ),
    ).toEqual({ status: "notfound" });
    expect(
      (
        await submitPublicLead(
          db as never,
          { code: "ONX-7K3QD", form: { name: "", phone: "" }, ip: "", now: NOW },
          { send: vi.fn() },
        )
      ).status,
    ).toBe("invalid");
  });
});

// ───────────────────────── «Менеджер связался»: первый нажавший ─────────────────────────

function claimDb(users: Record<string, { id: string; name: string; role: string }>) {
  const lead = { id: "lead1", status: "NEW", assignedManagerId: null as string | null };
  const names: Record<string, string> = Object.fromEntries(
    Object.values(users).map((u) => [u.id, u.name]),
  );
  const tx = {
    lead: {
      // Условный UPDATE: срабатывает ровно один раз.
      updateMany: vi.fn(async (a: { where: { status: string }; data: { assignedManagerId: string } }) => {
        if (lead.status !== "NEW" || lead.assignedManagerId !== null) return { count: 0 };
        lead.status = "CONTACTED";
        lead.assignedManagerId = a.data.assignedManagerId;
        return { count: 1 };
      }),
    },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  return {
    lead,
    tx,
    db: {
      user: {
        findFirst: async (a: { where: { telegramId: string } }) => users[a.where.telegramId] ?? null,
      },
      lead: {
        findUnique: async () => ({
          id: lead.id,
          assignedManager: lead.assignedManagerId ? { name: names[lead.assignedManagerId] } : null,
        }),
      },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
  };
}

describe("claimLeadFromTelegram", () => {
  const users = {
    "111": { id: "m1", name: "Азиз", role: "MANAGER" },
    "222": { id: "o1", name: "Владелец", role: "OWNER" },
    "333": { id: "w1", name: "Склад", role: "WAREHOUSE" },
  };

  it("первый нажавший — ответственный, второй получает «уже взял»", async () => {
    const { db, lead, tx } = claimDb(users);
    const a = await claimLeadFromTelegram(db as never, { leadId: "lead1", telegramUserId: 111 });
    const b = await claimLeadFromTelegram(db as never, { leadId: "lead1", telegramUserId: 222 });
    expect(a).toEqual({ status: "claimed", managerName: "Азиз" });
    expect(b).toEqual({ status: "taken", managerName: "Азиз" });
    expect(lead).toMatchObject({ status: "CONTACTED", assignedManagerId: "m1" });
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    // Условие атомарного захвата — «ещё новая и без ответственного».
    expect(tx.lead.updateMany.mock.calls[0][0].where).toEqual({
      id: "lead1",
      status: "NEW",
      assignedManagerId: null,
    });
  });

  it("одновременные нажатия: победитель ровно один", async () => {
    const { db } = claimDb(users);
    const rs = await Promise.all([
      claimLeadFromTelegram(db as never, { leadId: "lead1", telegramUserId: 111 }),
      claimLeadFromTelegram(db as never, { leadId: "lead1", telegramUserId: 222 }),
    ]);
    expect(rs.filter((r) => r.status === "claimed")).toHaveLength(1);
  });

  it("складчик / чужой Telegram — нельзя", async () => {
    const { db, lead } = claimDb(users);
    expect(await claimLeadFromTelegram(db as never, { leadId: "lead1", telegramUserId: 333 })).toEqual({
      status: "denied",
    });
    expect(await claimLeadFromTelegram(db as never, { leadId: "lead1", telegramUserId: 999 })).toEqual({
      status: "denied",
    });
    expect(lead.assignedManagerId).toBeNull();
  });

  it("кнопка: ответ нажавшему и снятие кнопки; чужая кнопка не наша", async () => {
    const { db } = claimDb(users);
    const answer = vi.fn(async () => true);
    const edit = vi.fn(async () => true);
    const handled = await handleLeadClaimCallback(
      {
        id: "cq1",
        from: { id: 111 },
        data: "lc:lead1",
        message: { message_id: 5, chat: { id: 111 }, text: "Новая заявка: …" },
      },
      { db: db as never, answer, edit },
    );
    expect(handled).toBe(true);
    expect(answer).toHaveBeenCalledWith("cq1", expect.stringContaining("ответственный"));
    expect(edit).toHaveBeenCalledWith(111, 5, "Новая заявка: …\n\nВзял(а): Азиз");

    await handleLeadClaimCallback(
      { id: "cq2", from: { id: 222 }, data: "lc:lead1" },
      { db: db as never, answer, edit },
    );
    expect(answer).toHaveBeenLastCalledWith("cq2", "Заявку уже взял(а) Азиз.", true);

    expect(
      await handleLeadClaimCallback({ id: "x", from: { id: 1 }, data: "other:1" }, { db: db as never, answer, edit }),
    ).toBe(false);
    expect(parseLeadClaimCallbackData("lc:")).toBeNull();
  });
});

// ───────────────────────── Язык ─────────────────────────

describe("язык публичных страниц", () => {
  it("по умолчанию — язык браузера", () => {
    expect(localeFromAcceptLanguage("uz-UZ,uz;q=0.9,ru;q=0.8")).toBe("uz");
    expect(localeFromAcceptLanguage("uz-Latn")).toBe("uz");
    expect(localeFromAcceptLanguage("ru-RU,ru;q=0.9,en-US;q=0.8")).toBe("ru");
    expect(localeFromAcceptLanguage("en-US,en;q=0.9,uz;q=0.5,ru;q=0.4")).toBe("uz");
    expect(localeFromAcceptLanguage("en-US,en;q=0.9")).toBe("ru");
    expect(localeFromAcceptLanguage(null)).toBe("ru");
    expect(localeFromAcceptLanguage("uz;q=0")).toBe("ru");
  });
  it("выбор в cookie сильнее браузера; мусор в cookie игнорируется", () => {
    expect(resolvePublicLocale({ cookie: "ru", acceptLanguage: "uz" })).toBe("ru");
    expect(resolvePublicLocale({ cookie: "uz", acceptLanguage: "ru" })).toBe("uz");
    expect(resolvePublicLocale({ cookie: "en", acceptLanguage: "uz" })).toBe("uz");
  });
  it("словари ru и uz полные (одинаковые ключи, без пустых строк)", () => {
    const ru = publicDict("ru");
    const uz = publicDict("uz");
    expect(Object.keys(uz).sort()).toEqual(Object.keys(ru).sort());
    for (const v of [...Object.values(ru), ...Object.values(uz)]) expect(v.trim()).not.toBe("");
    expect(uz.inStock).not.toBe(ru.inStock);
  });
});

// ───────────────────────── Счётчик сканирований ─────────────────────────

describe("счётчик сканирований", () => {
  it("клиент и партнёр считаются, сотрудник — нет", async () => {
    expect(shouldCountScan("client")).toBe(true);
    expect(shouldCountScan("partner")).toBe(true);
    expect(shouldCountScan("staff")).toBe(false);
    const db = { $executeRaw: vi.fn(async () => 1) };
    expect(await recordScan(db as never, { code: "ONX-7K3QD", stoneTypeId: "st1", viewer: "staff" })).toBe(
      false,
    );
    expect(db.$executeRaw).not.toHaveBeenCalled();
    expect(await recordScan(db as never, { code: "ONX-7K3QD", stoneTypeId: "st1", viewer: "client" })).toBe(
      true,
    );
    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
  });
  it("сбой записи не роняет страницу", async () => {
    const db = { $executeRaw: vi.fn(async () => Promise.reject(new Error("db down"))) };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await recordScan(db as never, { code: "X", stoneTypeId: "s", viewer: "partner" })).toBe(false);
    warn.mockRestore();
  });
  it("день — по Ташкенту", () => {
    expect(scanDay(new Date("2026-11-07T19:30:00Z")).toISOString()).toBe("2026-11-08T00:00:00.000Z");
    expect(scanDay(new Date("2026-11-07T18:30:00Z")).toISOString()).toBe("2026-11-07T00:00:00.000Z");
  });
});

// ───────────────────────── Ориентир цены ─────────────────────────

describe("ориентир цены", () => {
  it("разбор: пробелы и запятая, пусто = снять, мусор = ошибка", () => {
    expect(parsePriceHint("450 000")).toBe(450000);
    expect(parsePriceHint("35,5")).toBe(35.5);
    expect(parsePriceHint("")).toBeNull();
    expect(parsePriceHint("0")).toBeUndefined();
    expect(parsePriceHint("-5")).toBeUndefined();
    expect(parsePriceHint("1.234")).toBeUndefined();
    expect(parsePriceHint("abc")).toBeUndefined();
  });
  it("формат и «История»", () => {
    // Разделитель разрядов в ru-RU — неразрывный пробел; сравниваем по смыслу.
    expect(formatPriceHint(450000, 35.5)?.replace(/[  ]/g, " ")).toBe(
      "450 000 сум/м² · $35,5/м²",
    );
    expect(formatPriceHint(null, null)).toBeNull();
    const d = describeHistoryEntry({
      action: "STATUS_CHANGE",
      entityType: "StoneType",
      entityId: "st1",
      payload: { kind: "stonetype.pricehint", name: "Травертин", from: null, to: "$35/м²" },
    } as never);
    expect(d.summary).toContain("ориентир цены");
    expect(d.changes[0]).toContain("$35/м²");
    const l = describeHistoryEntry({
      action: "STATUS_CHANGE",
      entityType: "Lead",
      entityId: "lead1",
      payload: { kind: "lead.qr_create", stoneName: "Травертин", code: "ONX-7K3QD", clientName: "Азиз" },
    } as never);
    expect(l.summary).toBe("Заявка «QR / каталог» · Травертин · ONX-7K3QD · Азиз");
  });
});
