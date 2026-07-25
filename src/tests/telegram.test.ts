// Аудит ТЗ №7 #30 — telegram.ts (sendMessage/getFile/downloadFile) в тестах
// заглушен через vi.fn() в вызывающем коде. Настоящая реализация — apiPost с
// discriminated-result и fail-closed на no-token / non-2xx / network — не была
// покрыта. Регрессия к «getFile теперь throws» приведёт к 500 у /api/photo/[id]
// (там путь ждёт null). Мокаем global fetch — реального HTTP нет.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ORIG_FETCH = globalThis.fetch;

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = "999:BOT-TOKEN";
  vi.resetModules();
});
afterEach(() => {
  if (ORIG_TOKEN === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = ORIG_TOKEN;
  globalThis.fetch = ORIG_FETCH;
});

/** Helper: import модуль ЗАНОВО после мутации env — telegram.ts читает env лениво,
 *  а getEnv-подобных helper'ов там нет; вызов чтения происходит в getToken() при
 *  каждом вызове sendMessage/getFile/downloadFile, так что resetModules избыточен,
 *  но безопасен. */
async function loadModule() {
  return await import("@/lib/telegram");
}

// ═══════════════ sendMessage — SendResult (ok:true|false) ═══════════════

describe("sendMessage — fail-closed без throws (ТЗ №7 #30)", () => {
  it("нет TELEGRAM_BOT_TOKEN → { ok:false, error:'no_token' }, fetch НЕ вызывается", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const { sendMessage } = await loadModule();
    const res = await sendMessage(123, "hi");
    expect(res).toEqual({ ok: false, error: "no_token" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("сетевая ошибка (fetch throws) → { ok:false, error:'network: ...' }, НЕ throw'ает", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;

    const { sendMessage } = await loadModule();
    const res = await sendMessage(123, "hi");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("network");
    if (!res.ok) expect(res.error).toContain("ECONNRESET");
  });

  it("HTTP 500 → { ok:false, error:'http_500: ...' }, НЕ throw'ает", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("server error body", { status: 500 }),
    ) as unknown as typeof fetch;

    const { sendMessage } = await loadModule();
    const res = await sendMessage(123, "hi");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("http_500");
  });

  it("ok:false в JSON → { ok:false, error:'api_not_ok' }", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({ ok: false, description: "chat_not_found" }),
    ) as unknown as typeof fetch;

    const { sendMessage } = await loadModule();
    const res = await sendMessage(123, "hi");
    expect(res).toEqual({ ok: false, error: "api_not_ok" });
  });

  it("happy: ok:true + message_id → { ok:true, messageId }", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({ ok: true, result: { message_id: 42, chat: { id: 123 } } }),
    ) as unknown as typeof fetch;

    const { sendMessage } = await loadModule();
    const res = await sendMessage(123, "hi");
    expect(res).toEqual({ ok: true, messageId: 42 });
  });
});

// ═══════════════ getFile — TgFile | null (fail-closed) ═══════════════

describe("getFile — fail-closed null (ТЗ №7 #30)", () => {
  it("нет token → null, fetch НЕ вызывается", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const { getFile } = await loadModule();
    expect(await getFile("fid_1")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("network throw → null (apiPost ловит fetch throws)", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("dns");
    }) as unknown as typeof fetch;

    const { getFile } = await loadModule();
    expect(await getFile("fid_1")).toBeNull();
  });

  it("HTTP 404 → null (fail-closed, /api/photo зависит от этого контракта)", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("not found", { status: 404 }),
    ) as unknown as typeof fetch;

    const { getFile } = await loadModule();
    expect(await getFile("fid_1")).toBeNull();
  });

  it("happy: ok:true + file_path → TgFile", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        ok: true,
        result: { file_id: "fid_1", file_path: "photos/abc.jpg" },
      }),
    ) as unknown as typeof fetch;

    const { getFile } = await loadModule();
    const res = await getFile("fid_1");
    expect(res).toEqual({ file_id: "fid_1", file_path: "photos/abc.jpg" });
  });
});

// ═══════════════ downloadFile — Uint8Array | null ═══════════════

describe("downloadFile — fail-closed на token/404/network (ТЗ №7 #30 + B5 follow-up)", () => {
  it("нет token → null, fetch НЕ вызывается", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const { downloadFile } = await loadModule();
    expect(await downloadFile("photos/abc.jpg")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("HTTP 404 → null", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("nope", { status: 404 }),
    ) as unknown as typeof fetch;

    const { downloadFile } = await loadModule();
    expect(await downloadFile("photos/abc.jpg")).toBeNull();
  });

  it("happy: 200 → Uint8Array с байтами", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(new Uint8Array([1, 2, 3])),
    ) as unknown as typeof fetch;

    const { downloadFile } = await loadModule();
    const res = await downloadFile("photos/abc.jpg");
    expect(res).toBeInstanceOf(Uint8Array);
    expect(res!.byteLength).toBe(3);
    expect(Array.from(res!)).toEqual([1, 2, 3]);
  });

  it("network throw → null (B5 follow-up: fail-closed единый с getFile)", async () => {
    // Раньше downloadFile НЕ оборачивал fetch в try/catch — network throws
    // ронял вызывающие (/api/photo/[id], webhook downloadPhotoBase64). Теперь
    // единый контракт: null + warn. Регрессия к «снова throws» ловится здесь.
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;

    const { downloadFile } = await loadModule();
    await expect(downloadFile("photos/abc.jpg")).resolves.toBeNull();
  });
});
