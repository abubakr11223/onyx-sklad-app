// instrumentation.register() — node-cron jadvali va klaster himoyasi testlari.
// node-cron MOCK qilinadi (haqiqiy timer o'rnatilmasin); DB kodi callback ICHIDA
// lazy import bo'lgani uchun register() DB'ga tegmaydi.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const scheduleMock = vi.fn();

// node-cron'ni mock qilamiz: register() `await import("node-cron")` qiladi va
// `cron.schedule(...)` chaqiradi. Named + default eksportni ta'minlaymiz.
vi.mock("node-cron", () => {
  const api = { schedule: scheduleMock };
  return { ...api, default: api };
});

import {
  register,
  shouldScheduleSweep,
  SWEEP_CRON_EXPRESSION,
} from "@/instrumentation";

const SAVED = {
  runtime: process.env.NEXT_RUNTIME,
  instance: process.env.NODE_APP_INSTANCE,
};

beforeEach(() => {
  scheduleMock.mockClear();
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  if (SAVED.runtime === undefined) delete process.env.NEXT_RUNTIME;
  else process.env.NEXT_RUNTIME = SAVED.runtime;
  if (SAVED.instance === undefined) delete process.env.NODE_APP_INSTANCE;
  else process.env.NODE_APP_INSTANCE = SAVED.instance;
});

describe("shouldScheduleSweep — klaster/runtime himoyasi (sof)", () => {
  it("nodejs + instance yo'q → true (fork/bitta nusxa)", () => {
    expect(shouldScheduleSweep({ NEXT_RUNTIME: "nodejs" })).toBe(true);
  });

  it("nodejs + instance '0' → true (klasterning yagona nusxasi)", () => {
    expect(
      shouldScheduleSweep({ NEXT_RUNTIME: "nodejs", NODE_APP_INSTANCE: "0" }),
    ).toBe(true);
  });

  it("nodejs + instance '1' → false (dublikat sweep oldini olamiz)", () => {
    expect(
      shouldScheduleSweep({ NEXT_RUNTIME: "nodejs", NODE_APP_INSTANCE: "1" }),
    ).toBe(false);
  });

  it("edge runtime → false", () => {
    expect(shouldScheduleSweep({ NEXT_RUNTIME: "edge" })).toBe(false);
  });

  // ⚠️ Standalone `node server.js` (repo prod yo'li) da NEXT_RUNTIME UNDEFINED —
  // cron shu yerda ISHLASHI shart, aks holda prod'da jimgina o'lik bo'ladi.
  it("runtime yo'q (standalone node server.js) → true", () => {
    expect(shouldScheduleSweep({})).toBe(true);
  });

  it("runtime yo'q + instance '1' → false (klaster dublikat)", () => {
    expect(shouldScheduleSweep({ NODE_APP_INSTANCE: "1" })).toBe(false);
  });
});

describe("register() — node-cron wiring", () => {
  it("nodejs + instance 0 → cron.schedule bir marta, to'g'ri ifoda bilan", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.NODE_APP_INSTANCE = "0";

    await expect(register()).resolves.toBeUndefined(); // throw QILMAYDI

    expect(scheduleMock).toHaveBeenCalledTimes(1);
    expect(scheduleMock.mock.calls[0][0]).toBe(SWEEP_CRON_EXPRESSION);
    expect(typeof scheduleMock.mock.calls[0][1]).toBe("function");
  });

  it("standalone (NEXT_RUNTIME yo'q) + instance yo'q → schedule CHAQIRILADI", async () => {
    delete process.env.NEXT_RUNTIME;
    delete process.env.NODE_APP_INSTANCE;

    await register();

    expect(scheduleMock).toHaveBeenCalledTimes(1);
    expect(scheduleMock.mock.calls[0][0]).toBe(SWEEP_CRON_EXPRESSION);
  });

  it("edge runtime → schedule CHAQIRILMAYDI", async () => {
    process.env.NEXT_RUNTIME = "edge";
    delete process.env.NODE_APP_INSTANCE;

    await register();

    expect(scheduleMock).not.toHaveBeenCalled();
  });

  it("nodejs + instance 1 (klaster dublikat) → schedule CHAQIRILMAYDI", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.NODE_APP_INSTANCE = "1";

    await register();

    expect(scheduleMock).not.toHaveBeenCalled();
  });
});
