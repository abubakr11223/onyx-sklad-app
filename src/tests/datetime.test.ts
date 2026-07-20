// BUG-05 — единый форматтер в Asia/Tashkent (UTC+5). Сервер работает в UTC,
// поэтому Intl без timeZone отставал на 5 часов. Тесты фиксируют именно этот
// сценарий: час должен быть 17, а не 12; и переход через полночь (+5) сдвигает
// дату вперёд. Модуль чистый — DB/сеть НЕ нужны (singan.test.ts uslubi).
import { describe, expect, it } from "vitest";
import {
  endOfTashkentDay,
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

  describe("endOfTashkentDay — граница дня (истекает сегодня)", () => {
    it("день берётся по Ташкенту, а не по UTC (переход через полночь)", () => {
      // 21T20:00Z + 5ч = 22T01:00 Ташкент → «сегодня» уже 22-е, а конец дня
      // = 22T23:59:59.999+05:00 = 22T18:59:59.999Z. UTC-логика ошибочно дала бы
      // границу 21-го числа и не пометила бы бронь на 22-е.
      const now = new Date("2026-07-21T20:00:00Z");
      const end = endOfTashkentDay(now);
      expect(end.toISOString()).toBe("2026-07-22T18:59:59.999Z");
    });

    it("бронь, истекающая днём (по Ташкенту) сегодня, попадает в границу", () => {
      const now = new Date("2026-07-21T20:00:00Z"); // 22T01:00 Ташкент
      const end = endOfTashkentDay(now);
      // 22T10:00Z = 22T15:00 Ташкент — тот же ташкентский день → «истекает сегодня».
      const expiresAt = new Date("2026-07-22T10:00:00Z");
      expect(expiresAt <= end).toBe(true);
      // UTC-граница сервера (конец 21-го) ошибочно исключила бы эту бронь.
      const utcEndOfServerDay = new Date("2026-07-21T23:59:59.999Z");
      expect(expiresAt <= utcEndOfServerDay).toBe(false);
    });

    it("бронь на завтра (по Ташкенту) выходит за границу", () => {
      const now = new Date("2026-07-21T12:00:00Z"); // 21T17:00 Ташкент
      const end = endOfTashkentDay(now);
      // 22T00:00Z = 22T05:00 Ташкент — уже следующий день → НЕ «сегодня».
      const expiresAt = new Date("2026-07-22T00:00:00Z");
      expect(expiresAt <= end).toBe(false);
    });
  });
});
