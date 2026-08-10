// Аудит 2026-08-10 — троттлинг неудачных входов.
//
// До этого /login не ограничивал число попыток: подбор пароля упирался только
// в стоимость PBKDF2, и каждая попытка жгла CPU функции. Этот файл фиксирует
// поведение окна и порогов; если он падает — перебор снова открыт.
import { describe, expect, it } from "vitest";
import {
  LOGIN_MAX_FAILURES_EMAIL,
  LOGIN_MAX_FAILURES_IP,
  LOGIN_WINDOW_MS,
  decideThrottle,
  limitFor,
  nextFailureState,
  retryAfterMinutes,
} from "@/lib/login-throttle";

const T0 = new Date("2026-08-10T10:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

describe("decideThrottle — окно и порог", () => {
  it("нет строки → не блокируем (первый вход)", () => {
    expect(decideThrottle({ row: null, now: T0, limit: 10 })).toEqual({
      blocked: false,
      retryAfterMs: 0,
    });
  });

  it("неудач меньше порога → пропускаем", () => {
    const r = decideThrottle({
      row: { failures: 9, firstAt: T0 },
      now: at(60_000),
      limit: 10,
    });
    expect(r.blocked).toBe(false);
  });

  it("порог достигнут внутри окна → блокируем", () => {
    const r = decideThrottle({
      row: { failures: 10, firstAt: T0 },
      now: at(60_000),
      limit: 10,
    });
    expect(r.blocked).toBe(true);
    expect(r.retryAfterMs).toBe(LOGIN_WINDOW_MS - 60_000);
  });

  it("окно истекло → пропускаем, даже если неудач много", () => {
    const r = decideThrottle({
      row: { failures: 999, firstAt: T0 },
      now: at(LOGIN_WINDOW_MS),
      limit: 10,
    });
    expect(r.blocked).toBe(false);
    expect(r.retryAfterMs).toBe(0);
  });

  it("граница окна: ровно на LOGIN_WINDOW_MS уже свободно (не «навсегда»)", () => {
    const justBefore = decideThrottle({
      row: { failures: 10, firstAt: T0 },
      now: at(LOGIN_WINDOW_MS - 1),
      limit: 10,
    });
    const exactly = decideThrottle({
      row: { failures: 10, firstAt: T0 },
      now: at(LOGIN_WINDOW_MS),
      limit: 10,
    });
    expect(justBefore.blocked).toBe(true);
    expect(exactly.blocked).toBe(false);
  });
});

describe("nextFailureState — счётчик", () => {
  it("первая неудача → 1, firstAt = сейчас", () => {
    const s = nextFailureState({ row: null, now: T0 });
    expect(s).toEqual({ failures: 1, firstAt: T0 });
  });

  it("внутри окна → +1, firstAt НЕ сдвигается (иначе окно бесконечное)", () => {
    const s = nextFailureState({
      row: { failures: 3, firstAt: T0 },
      now: at(60_000),
    });
    expect(s).toEqual({ failures: 4, firstAt: T0 });
  });

  it("после окна → счёт с нуля", () => {
    const s = nextFailureState({
      row: { failures: 9, firstAt: T0 },
      now: at(LOGIN_WINDOW_MS + 1),
    });
    expect(s.failures).toBe(1);
    expect(s.firstAt.getTime()).toBe(T0.getTime() + LOGIN_WINDOW_MS + 1);
  });
});

describe("пороги по областям", () => {
  it("ip терпимее email — за одним NAT сидит весь склад", () => {
    expect(limitFor("email")).toBe(LOGIN_MAX_FAILURES_EMAIL);
    expect(limitFor("ip")).toBe(LOGIN_MAX_FAILURES_IP);
    expect(LOGIN_MAX_FAILURES_IP).toBeGreaterThan(LOGIN_MAX_FAILURES_EMAIL);
  });

  it("порог email допускает опечатки, но не перебор", () => {
    // Достаточно для человека, который путает раскладку; бесполезно для перебора.
    expect(LOGIN_MAX_FAILURES_EMAIL).toBeGreaterThanOrEqual(5);
    expect(LOGIN_MAX_FAILURES_EMAIL).toBeLessThanOrEqual(15);
  });
});

describe("retryAfterMinutes", () => {
  it("округляет вверх и никогда не показывает «0 минут»", () => {
    expect(retryAfterMinutes(1)).toBe(1);
    expect(retryAfterMinutes(60_000)).toBe(1);
    expect(retryAfterMinutes(61_000)).toBe(2);
    expect(retryAfterMinutes(0)).toBe(1);
  });
});
