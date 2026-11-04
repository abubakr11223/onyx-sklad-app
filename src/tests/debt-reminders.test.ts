// ТЗ №20 D — напоминания о долгах: пороги, идемпотентность, сводка, валюты.
// БД нет: in-memory ReminderStore повторяет CAS-семантику prisma-адаптера.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  daysPastDue,
  debtLink,
  prismaReminderStore,
  reachedMilestone,
  runDebtReminders,
  summaryText,
  type ReminderDebt,
  type ReminderPerson,
  type ReminderStore,
  type SendFn,
} from "@/lib/debt-reminders";
import { endOfTashkentCalendarDay } from "@/lib/debts";

const BASE = "https://onyx.test";

const manager: ReminderPerson = { id: "m1", name: "Алишер", telegramId: "100", isActive: true };
const owner: ReminderPerson = { id: "o1", name: "Владелец", telegramId: "900", isActive: true };

/** Момент «09:00 по Ташкенту» указанного дня (= 04:00 UTC). */
const at9 = (ymd: string) => new Date(`${ymd}T09:00:00+05:00`);
const due = (ymd: string) => endOfTashkentCalendarDay(ymd);

function debt(over: Partial<ReminderDebt> = {}): ReminderDebt {
  return {
    id: "d1",
    amount: "200",
    repaidAmount: null,
    currency: "USD",
    dueDate: due("2026-10-25"),
    remindedDueAt: null,
    overdueRemindDay: 0,
    customerName: "Тимур",
    soldAt: new Date("2026-10-21T10:00:00+05:00"),
    manager,
    ...over,
  };
}

class MemStore implements ReminderStore {
  summaryYmd: string | null = null;
  constructor(
    public debts: ReminderDebt[],
    public owners: ReminderPerson[] = [owner],
  ) {}
  private get(id: string) {
    return this.debts.find((d) => d.id === id)!;
  }
  async loadActiveDebts() {
    return this.debts.map((d) => ({ ...d }));
  }
  async loadOwners() {
    return this.owners;
  }
  async claimTomorrow(id: string, dueDate: Date) {
    const d = this.get(id);
    if (d.dueDate?.getTime() !== dueDate.getTime()) return false;
    if (d.remindedDueAt?.getTime() === dueDate.getTime()) return false;
    d.remindedDueAt = dueDate;
    return true;
  }
  async releaseTomorrow(id: string, dueDate: Date, prev: Date | null) {
    const d = this.get(id);
    if (d.remindedDueAt?.getTime() === dueDate.getTime()) d.remindedDueAt = prev;
  }
  async setOverdueDay(id: string, from: number, to: number) {
    const d = this.get(id);
    if (d.overdueRemindDay !== from) return false;
    d.overdueRemindDay = to;
    return true;
  }
  async claimSummary(ymd: string) {
    if (this.summaryYmd === ymd) return false;
    this.summaryYmd = ymd;
    return true;
  }
  async releaseSummary(ymd: string) {
    if (this.summaryYmd === ymd) this.summaryYmd = null;
  }
}

let sent: { chatId: string; text: string }[];
const okSend: SendFn = async (chatId, text) => {
  sent.push({ chatId, text });
  return { ok: true, messageId: 1 };
};
const run = (store: ReminderStore, now: Date, send: SendFn = okSend) =>
  runDebtReminders({ store, sendMessage: send, now, baseUrl: BASE });
/** Только напоминания по долгам (без ежедневной сводки). */
const reminders = () => sent.filter((m) => !m.text.startsWith("Долги на"));

beforeEach(() => {
  sent = [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("даты по Ташкенту", () => {
  it("день срока = 0, следующий день = 1, накануне = −1", () => {
    const d = due("2026-10-25");
    expect(daysPastDue(d, at9("2026-10-24"))).toBe(-1);
    expect(daysPastDue(d, at9("2026-10-25"))).toBe(0);
    // 23:59 по Ташкенту в день срока — ещё не просрочен
    expect(daysPastDue(d, new Date("2026-10-25T23:59:00+05:00"))).toBe(0);
    // 00:01 по Ташкенту следующего дня (= 19:01 UTC дня срока) — уже 1 день
    expect(daysPastDue(d, new Date("2026-10-25T19:01:00Z"))).toBe(1);
    expect(daysPastDue(d, at9("2026-11-01"))).toBe(7);
  });

  it("пороги 1/7/30", () => {
    expect([0, 1, 3, 6, 7, 29, 30, 90].map(reachedMilestone)).toEqual([0, 1, 1, 1, 7, 7, 30, 30]);
  });
});

describe("«завтра срок»", () => {
  it("уходит один раз менеджеру, текст и ссылка по ТЗ", async () => {
    const store = new MemStore([debt()]);
    await run(store, at9("2026-10-24"));
    expect(reminders()).toHaveLength(1);
    expect(reminders()[0]!.chatId).toBe("100");
    expect(reminders()[0]!.text).toBe(
      "Завтра срок: Тимур, $200, продажа 21.10\nhttps://onyx.test/dolzhniki?q=%D0%A2%D0%B8%D0%BC%D1%83%D1%80#debt-d1",
    );
    // повторный (или параллельный) запуск того же дня — ничего
    await run(store, new Date("2026-10-24T20:00:00+05:00"));
    expect(reminders()).toHaveLength(1);
  });

  it("за 2 дня и в сам день срока — не шлём", async () => {
    const store = new MemStore([debt()]);
    await run(store, at9("2026-10-23"));
    await run(store, at9("2026-10-25"));
    expect(reminders()).toHaveLength(0);
  });

  it("срок перенесли — напоминаем о новом сроке ещё раз", async () => {
    const store = new MemStore([debt()]);
    await run(store, at9("2026-10-24"));
    store.debts[0]!.dueDate = due("2026-10-30");
    await run(store, at9("2026-10-29"));
    expect(reminders()).toHaveLength(2);
  });

  it("частично погашенный — сумма остатка", async () => {
    const store = new MemStore([debt({ amount: "300", repaidAmount: "100" })]);
    await run(store, at9("2026-10-24"));
    expect(reminders()[0]!.text).toContain("Тимур, $200,");
  });

  it("полностью погашенный остаток 0 — не напоминаем", async () => {
    const store = new MemStore([debt({ repaidAmount: "200" })]);
    await run(store, at9("2026-10-24"));
    expect(reminders()).toHaveLength(0);
  });
});

describe("просрочка 1 / 7 / 30", () => {
  it("пороги приходят менеджеру и владельцу, между ними — тишина", async () => {
    const store = new MemStore([debt()]);
    const byDay: Record<string, number> = {};
    // каждый день с 26.10 (1 день) по 25.11 (31 день)
    for (let i = 1; i <= 31; i++) {
      const now = new Date(due("2026-10-25").getTime() + i * 86_400_000 - 12 * 3_600_000);
      const before = reminders().length;
      await run(store, now);
      const n = reminders().length - before;
      if (n > 0) byDay[String(daysPastDue(due("2026-10-25"), now))] = n;
    }
    expect(byDay).toEqual({ "1": 2, "7": 2, "30": 2 });
    const first = reminders()[0]!;
    expect(first.text.split("\n")[0]).toBe("Просрочено 1 день: Тимур, $200");
    expect(first.text).toContain("менеджер Алишер");
    expect(first.text).toContain("#debt-d1");
    expect(reminders().map((m) => m.chatId).slice(0, 2).sort()).toEqual(["100", "900"]);
    expect(store.debts[0]!.overdueRemindDay).toBe(30);
  });

  it("двойной запуск в день порога — одно сообщение на адресата", async () => {
    const store = new MemStore([debt()]);
    await Promise.all([run(store, at9("2026-10-26")), run(store, at9("2026-10-26"))]);
    expect(reminders()).toHaveLength(2);
  });

  it("догон: cron пропустил день 1, запуск на 3-й день — одно сообщение, без повтора", async () => {
    const store = new MemStore([debt()]);
    await run(store, at9("2026-10-28"));
    expect(reminders()).toHaveLength(2); // менеджер + владелец, одно сообщение
    expect(reminders()[0]!.text).toMatch(/^Просрочено 3 дня:/);
    expect(store.debts[0]!.overdueRemindDay).toBe(1);
    await run(store, at9("2026-10-29"));
    expect(reminders()).toHaveLength(2);
  });

  it("догон через несколько порогов (день 40, ничего не было) — только одно сообщение", async () => {
    const store = new MemStore([debt()]);
    await run(store, at9("2026-12-04"));
    expect(reminders()).toHaveLength(2);
    expect(store.debts[0]!.overdueRemindDay).toBe(30);
  });

  it("владелец сам продал — не получает дубль", async () => {
    const store = new MemStore([debt({ manager: owner })]);
    await run(store, at9("2026-10-26"));
    expect(reminders()).toHaveLength(1);
  });

  it("срок перенесли в будущее — счётчик порогов сбрасывается", async () => {
    const store = new MemStore([debt()]);
    await run(store, at9("2026-10-26"));
    store.debts[0]!.dueDate = due("2026-11-10");
    await run(store, at9("2026-10-27"));
    expect(store.debts[0]!.overdueRemindDay).toBe(0);
    await run(store, at9("2026-11-11"));
    expect(reminders().filter((m) => m.text.startsWith("Просрочено 1 день"))).toHaveLength(4);
  });
});

describe("без Telegram и ошибки отправки", () => {
  it("непривязанный менеджер пропускается без ошибки, владелец получает", async () => {
    const store = new MemStore([debt({ manager: { ...manager, telegramId: null } })]);
    const stats = await run(store, at9("2026-10-26"));
    expect(reminders().map((m) => m.chatId)).toEqual(["900"]);
    expect(stats.skippedUnlinked).toBeGreaterThanOrEqual(1);
    expect(stats.failed).toBe(0);
  });

  it("«завтра» непривязанному — считается отправленным, не повторяется", async () => {
    const store = new MemStore([debt({ manager: { ...manager, telegramId: null } })]);
    const stats = await run(store, at9("2026-10-24"));
    expect(reminders()).toHaveLength(0);
    expect(stats.skippedUnlinked).toBe(1);
    expect(store.debts[0]!.remindedDueAt).not.toBeNull();
  });

  it("сбой одному адресату не мешает другим; если упали все — повтор в следующий раз", async () => {
    const store = new MemStore([debt(), debt({ id: "d2", customerName: "Бек" })]);
    const flaky: SendFn = async (chatId, text) => {
      if (text.includes("Тимур")) throw new Error("network");
      return okSend(chatId, text);
    };
    const stats = await run(store, at9("2026-10-26"), flaky);
    expect(stats.failed).toBeGreaterThanOrEqual(2);
    expect(reminders().every((m) => m.text.includes("Бек"))).toBe(true);
    expect(reminders()).toHaveLength(2);
    // Тимур: все отправки упали → порог откатан, на следующий день уходит
    expect(store.debts[0]!.overdueRemindDay).toBe(0);
    await run(store, at9("2026-10-27"));
    expect(reminders().filter((m) => m.text.includes("Тимур"))).toHaveLength(2);
  });
});

describe("сводка владельцу", () => {
  it("раз в сутки, валюты отдельно, топ по сумме, «без срока» отдельно", async () => {
    const store = new MemStore([
      debt({ id: "a", customerName: "Тимур", amount: "200" }),
      debt({ id: "b", customerName: "Бек", amount: "500", repaidAmount: "100" }),
      debt({ id: "c", customerName: "Азиз", currency: "UZS", amount: "3000000" }),
      debt({ id: "e", customerName: "Санжар", dueDate: null, amount: "1000000", currency: "UZS" }),
      debt({ id: "f", customerName: "Не срок", dueDate: due("2026-12-01") }),
    ]);
    await run(store, at9("2026-10-30"));
    const summaries = sent.filter((m) => m.text.startsWith("Долги на"));
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.chatId).toBe("900");
    const t = summaries[0]!.text;
    expect(t).toContain("Просрочено: 3");
    // сум и $ — отдельно, $ = 200 + 400 (остаток Бека)
    expect(t).toMatch(/Сумма: 3\s000\s000 сум · \$600/);
    expect(t.indexOf("1. Бек — $400")).toBeLessThan(t.indexOf("2. Тимур — $200"));
    expect(t).toMatch(/Без срока: 1 — 1\s000\s000 сум/);
    expect(t).not.toContain("Санжар"); // без срока не в топе
    expect(t).not.toContain("Не срок");
    expect(t).toContain("https://onyx.test/dolzhniki?overdue=1");
    // долг без срока — никаких персональных напоминаний
    expect(reminders().some((m) => m.text.includes("Санжар"))).toBe(false);

    await run(store, new Date("2026-10-30T22:00:00+05:00"));
    expect(sent.filter((m) => m.text.startsWith("Долги на"))).toHaveLength(1);
    await run(store, at9("2026-10-31"));
    expect(sent.filter((m) => m.text.startsWith("Долги на"))).toHaveLength(2);
  });

  it("топ-5 — не больше пяти в валюте", () => {
    const ds = Array.from({ length: 7 }, (_, i) =>
      debt({ id: `x${i}`, customerName: `К${i}`, amount: String(100 + i) }),
    );
    const t = summaryText(ds, at9("2026-10-30"), BASE);
    expect(t).toContain("5. К2");
    expect(t).not.toContain("6.");
  });

  it("нет просроченных — короткая сводка", () => {
    const t = summaryText([debt({ dueDate: null })], at9("2026-10-30"), BASE);
    expect(t).toContain("Просроченных долгов нет.");
    expect(t).toContain("Без срока: 1 — $200");
  });

  it("владелец без Telegram — сводка не отправляется и не «тратится»", async () => {
    const store = new MemStore([debt()], [{ ...owner, telegramId: null }]);
    await run(store, at9("2026-10-30"));
    expect(sent.filter((m) => m.text.startsWith("Долги на"))).toHaveLength(0);
    expect(store.summaryYmd).toBeNull();
  });
});

describe("prismaReminderStore — условные UPDATE", () => {
  it("claimTomorrow/setOverdueDay — compare-and-set через updateMany", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = { debt: { updateMany } } as never;
    const s = prismaReminderStore(db);
    const dd = due("2026-10-25");
    expect(await s.claimTomorrow("d1", dd)).toBe(true);
    expect(updateMany.mock.calls[0]![0]).toEqual({
      where: {
        id: "d1",
        status: "ACTIVE",
        dueDate: dd,
        OR: [{ remindedDueAt: null }, { remindedDueAt: { not: dd } }],
      },
      data: { remindedDueAt: dd },
    });
    updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await s.setOverdueDay("d1", 1, 7)).toBe(false);
    expect(updateMany.mock.calls[1]![0]).toEqual({
      where: { id: "d1", status: "ACTIVE", overdueRemindDay: 1 },
      data: { overdueRemindDay: 7 },
    });
  });

  it("claimSummary: уже сегодня → false; впервые → create", async () => {
    const appConfig = {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      findUnique: vi.fn().mockResolvedValue({ value: "2026-10-30" }),
      create: vi.fn().mockResolvedValue({}),
    };
    const s = prismaReminderStore({ appConfig } as never);
    expect(await s.claimSummary("2026-10-30")).toBe(false);
    appConfig.findUnique.mockResolvedValueOnce(null);
    expect(await s.claimSummary("2026-10-30")).toBe(true);
    expect(appConfig.create).toHaveBeenCalled();
  });
});

describe("ссылка в напоминании", () => {
  it("есть карточка клиента → «Платёж клиента» (открывает и менеджер)", () => {
    expect(
      debtLink("https://x", { id: "d1", customerName: "Тимур", clientId: "c1", currency: "USD" }),
    ).toBe("https://x/dolzhniki/klient/c1?currency=USD");
  });
  it("без карточки → «Должники» с якорем", () => {
    expect(
      debtLink("https://x", { id: "d1", customerName: "Тимур", clientId: null, currency: "UZS" }),
    ).toBe("https://x/dolzhniki?q=%D0%A2%D0%B8%D0%BC%D1%83%D1%80#debt-d1");
  });
});
