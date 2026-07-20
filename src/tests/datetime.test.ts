// BUG-05 — единый форматтер в Asia/Tashkent (UTC+5). Сервер работает в UTC,
// поэтому Intl без timeZone отставал на 5 часов. Тесты фиксируют именно этот
// сценарий: час должен быть 17, а не 12; и переход через полночь (+5) сдвигает
// дату вперёд. Модуль чистый — DB/сеть НЕ нужны (singan.test.ts uslubi).
import { describe, expect, it } from "vitest";
import {
  formatTashkentDate,
  formatTashkentDateTime,
  todayTashkentISO,
} from "@/lib/datetime";

describe("datetime — Asia/Tashkent (UTC+5)", () => {
  it("dateTime: 12:03 UTC → 17:03 Ташкент (тот самый баг)", () => {
    const out = formatTashkentDateTime(new Date("2026-07-21T12:03:00Z"));
    expect(out).toContain("17:03"); // час = 17, НЕ 12
    expect(out).toContain("21.07.2026");
  });

  it("date: 20:00 UTC → следующий день в Ташкенте (переход через полночь)", () => {
    const out = formatTashkentDate(new Date("2026-07-21T20:00:00Z"));
    // 21T20:00Z + 5ч = 22T01:00 Ташкент → дата уже 22-е.
    expect(out).toBe("22.07.2026");
  });

  it("todayTashkentISO: формат YYYY-MM-DD", () => {
    expect(todayTashkentISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
