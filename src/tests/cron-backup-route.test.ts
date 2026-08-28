// W2-T2 — kunlik zaxira cron'i endi JIM yiqilmaydi.
//
// Shartnoma (testlar shu bilan qotiriladi):
//   • sendDocument yiqilsa → HTTP 500 + ok:false (Vercel cron logi qizil)
//     va egalarga sendMessage bilan ogohlantirish ketadi;
//   • fayl 50 MB dan katta → sendDocument UMUMAN chaqirilmaydi, egaga
//     /api/export/snapshot yo'li aytiladi, javob ok:false/500;
//   • ogohlantirish best-effort: sendMessage yiqilsa route yiqilmaydi,
//     natija javob tanasida (notifyFailed) ko'rinadi;
//   • baxtli yo'l o'zgarmagan: ok:true, delivered soni, failed bo'sh.
//
// DB YO'Q: @/lib/db soxta — buildSnapshot topilmagan jadvalni bo'sh deb oladi.
import { beforeEach, describe, expect, it, vi } from "vitest";

const M = vi.hoisted(() => ({
  userFindMany: vi.fn(),
  appConfigFindMany: vi.fn(),
  sendDocument: vi.fn(),
  sendMessage: vi.fn(),
  /** Oversize testlari uchun: null bo'lmasa snapshotToJson shu satrni qaytaradi. */
  jsonOverride: null as string | null,
}));

vi.mock("@/lib/db", () => ({
  db: {
    // Ham snapshot'dagi "user" jadvali (argumentsiz findMany), ham OWNER
    // so'rovi (where bilan) shu delegate orqali o'tadi.
    user: { findMany: (...a: unknown[]) => M.userFindMany(...a) },
    // SNAPSHOT_TABLES ro'yxatidagi birinchi jadval — snapshot yiqilishini
    // shu orqali simulyatsiya qilamiz.
    appConfig: { findMany: (...a: unknown[]) => M.appConfigFindMany(...a) },
  },
}));

vi.mock("@/lib/telegram", () => ({
  sendDocument: (...a: unknown[]) => M.sendDocument(...a),
  sendMessage: (...a: unknown[]) => M.sendMessage(...a),
}));

vi.mock("@/lib/db-snapshot", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-snapshot")>();
  return {
    ...actual,
    snapshotToJson: (s: Parameters<typeof actual.snapshotToJson>[0]) =>
      M.jsonOverride ?? actual.snapshotToJson(s),
  };
});

import {
  EXPORT_SNAPSHOT_PATH,
  GET,
  TELEGRAM_DOCUMENT_LIMIT_BYTES,
} from "@/app/api/cron/backup/route";

const SECRET = "s3cr3t-backup";
const OWNER_CHAT = "111222333";

function req(auth = true): Request {
  return new Request("https://onyx.test/api/cron/backup", {
    headers: auth ? { authorization: `Bearer ${SECRET}` } : {},
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  M.jsonOverride = null;
  M.userFindMany.mockReset();
  M.appConfigFindMany.mockReset();
  M.sendDocument.mockReset();
  M.sendMessage.mockReset();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  // Standart: bitta OWNER (where bilan so'ralganda), snapshot jadvali bo'sh.
  M.userFindMany.mockImplementation((args?: unknown) =>
    args ? Promise.resolve([{ id: "u1", telegramId: OWNER_CHAT }]) : Promise.resolve([]),
  );
  M.appConfigFindMany.mockResolvedValue([]);
  M.sendDocument.mockResolvedValue({ ok: true, messageId: 42 });
  M.sendMessage.mockResolvedValue({ ok: true, messageId: 43 });
});

describe("auth darvozasi", () => {
  it("secret'siz → 401, hech narsa yuborilmaydi", async () => {
    const res = await GET(req(false));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false });
    expect(M.sendDocument).not.toHaveBeenCalled();
    expect(M.sendMessage).not.toHaveBeenCalled();
  });
});

describe("baxtli yo'l (o'zgarmagan)", () => {
  it("hujjat yetkazildi → 200, ok:true, delivered=1, ogohlantirish yo'q", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, delivered: 1, failed: [] });
    expect(M.sendDocument).toHaveBeenCalledTimes(1);
    expect(M.sendDocument.mock.calls[0][0]).toBe(OWNER_CHAT);
    expect(M.sendMessage).not.toHaveBeenCalled();
  });
});

describe("sendDocument yiqilishi", () => {
  it("→ 500, ok:false, reason=send_failed, ega sendMessage bilan ogohlantiriladi", async () => {
    M.sendDocument.mockResolvedValue({ ok: false, error: "http_400: file too fat" });
    const res = await GET(req());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("send_failed");
    expect(body.failed).toEqual([
      { chatId: OWNER_CHAT, error: "http_400: file too fat" },
    ]);
    // Ogohlantirish o'sha OWNER chatiga ketdi va matnida eksport yo'li bor.
    expect(M.sendMessage).toHaveBeenCalledTimes(1);
    expect(M.sendMessage.mock.calls[0][0]).toBe(OWNER_CHAT);
    expect(String(M.sendMessage.mock.calls[0][1])).toContain(EXPORT_SNAPSHOT_PATH);
    expect(body.notified).toEqual([OWNER_CHAT]);
    expect(body.notifyFailed).toEqual([]);
  });

  it("ogohlantirish ham yiqilsa — route baribir javob qaytaradi, notifyFailed'da ko'rinadi", async () => {
    M.sendDocument.mockResolvedValue({ ok: false, error: "network: down" });
    M.sendMessage.mockResolvedValue({ ok: false, error: "network: down" });
    const res = await GET(req());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.notified).toEqual([]);
    expect(body.notifyFailed).toEqual([
      { chatId: OWNER_CHAT, error: "network: down" },
    ]);
  });
});

describe("50 MB chegarasi", () => {
  it("katta fayl → sendDocument CHAQIRILMAYDI, ega ogohlantiriladi, ok:false/500", async () => {
    M.jsonOverride = "a".repeat(TELEGRAM_DOCUMENT_LIMIT_BYTES + 1);
    const res = await GET(req());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("oversize");
    expect(body.bytes).toBe(TELEGRAM_DOCUMENT_LIMIT_BYTES + 1);
    expect(body.limit).toBe(TELEGRAM_DOCUMENT_LIMIT_BYTES);
    expect(M.sendDocument).not.toHaveBeenCalled();
    expect(M.sendMessage).toHaveBeenCalledTimes(1);
    expect(String(M.sendMessage.mock.calls[0][1])).toContain(EXPORT_SNAPSHOT_PATH);
    expect(body.notified).toEqual([OWNER_CHAT]);
  });

  it("roppa-rosa chegara → yuboriladi (chegara qat'iy `>` bilan)", async () => {
    M.jsonOverride = "a".repeat(TELEGRAM_DOCUMENT_LIMIT_BYTES);
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(M.sendDocument).toHaveBeenCalledTimes(1);
  });
});

describe("snapshot yiqilishi", () => {
  it("buildSnapshot throw → 500, ok:false, reason=snapshot_failed, ega ogohlantiriladi", async () => {
    M.appConfigFindMany.mockRejectedValue(new Error("db down"));
    const res = await GET(req());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("snapshot_failed");
    expect(body.error).toContain("db down");
    expect(M.sendDocument).not.toHaveBeenCalled();
    expect(M.sendMessage).toHaveBeenCalledTimes(1);
    expect(body.notified).toEqual([OWNER_CHAT]);
  });
});

describe("OWNER yo'q", () => {
  it("Telegram'i ulangan ega yo'q → ok:false/500 (zaxira hech kimga ketmadi — jim emas)", async () => {
    M.userFindMany.mockImplementation(() => Promise.resolve([]));
    const res = await GET(req());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("no_owners");
    expect(M.sendDocument).not.toHaveBeenCalled();
    expect(M.sendMessage).not.toHaveBeenCalled();
  });
});
