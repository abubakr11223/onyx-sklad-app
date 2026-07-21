// runReservationSweep — jadvalli sweep-runner testlari. DB YO'Q: `expire`ni
// mock qilamiz. Asosiy shart: xato HECH QACHON throw bo'lmaydi (jarayon yiqilmasin).
import { describe, expect, it, vi } from "vitest";
import { runReservationSweep } from "@/lib/reservation-sweep";

describe("runReservationSweep", () => {
  it("expire'ni chaqiradi va yopilgan bronlar sonini qaytaradi", async () => {
    const expire = vi.fn().mockResolvedValue(3);
    const log = vi.fn();

    const result = await runReservationSweep({ expire, log });

    expect(expire).toHaveBeenCalledTimes(1);
    expect(result).toBe(3);
    expect(log).toHaveBeenCalledWith("[reservation-sweep] 3 ta bron EXPIRED qilindi.");
  });

  it("expire throw qilsa — xatoni YUTADI, null qaytaradi, throw QILMAYDI", async () => {
    const boom = new Error("DB ulanmadi");
    const expire = vi.fn().mockRejectedValue(boom);
    const logError = vi.fn();

    // .rejects EMAS — funksiya throw qilmasligi kerak.
    const result = await runReservationSweep({ expire, logError });

    expect(result).toBeNull();
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0][1]).toBe(boom);
  });

  it("sinxron throw (masalan expire()ning o'zi) ham yutiladi", async () => {
    const expire = vi.fn(() => {
      throw new Error("sync boom");
    });
    const logError = vi.fn();

    const result = await runReservationSweep({ expire, logError });

    expect(result).toBeNull();
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it("0 yopilganda ham muvaffaqiyat (0 qaytadi)", async () => {
    const expire = vi.fn().mockResolvedValue(0);
    const result = await runReservationSweep({ expire, log: vi.fn() });
    expect(result).toBe(0);
  });
});
