// Zaxira tirikligini tekshirish — «o'lik odam tugmasi».
//
// Nega alohida testlar: bu mexanizm faqat NARSA ISHLAMAY QOLGANDA ishga
// tushadi, ya'ni odatdagi kunda hech qachon sinovdan o'tmaydi. Xatosi esa
// bilinmaydi — «xabar kelmadi» degan holat «hammasi joyida» bilan bir xil
// ko'rinadi. Shuning uchun har bir yo'l shu yerda qo'lda tekshiriladi.

import { describe, expect, it, vi } from "vitest";

import {
  BACKUP_STALE_HOURS,
  LAST_BACKUP_OK_KEY,
  hoursSince,
  isBackupStale,
  readLastBackupOk,
  recordBackupOk,
  staleBackupMessage,
  type BackupStatusClient,
} from "@/lib/backup-status";

const NOW = "2026-09-02T12:00:00.000Z";

function hoursAgo(h: number): string {
  return new Date(Date.parse(NOW) - h * 3600_000).toISOString();
}

describe("eskirganlikni aniqlash", () => {
  it("yaqinda olingan zaxira — eskirmagan", () => {
    expect(isBackupStale(hoursAgo(1), NOW)).toBe(false);
    expect(isBackupStale(hoursAgo(24), NOW)).toBe(false);
    expect(isBackupStale(hoursAgo(BACKUP_STALE_HOURS - 1), NOW)).toBe(false);
  });

  it("bitta o'tkazib yuborilgan kun kechiriladi, ikkinchisi — yo'q", () => {
    // 24 soat — normal oraliq; 36 dan oshsa ikkita kun ketma-ket o'tgan.
    expect(isBackupStale(hoursAgo(BACKUP_STALE_HOURS + 1), NOW)).toBe(true);
    expect(isBackupStale(hoursAgo(72), NOW)).toBe(true);
  });

  it("hech qachon olinmagan bo'lsa — eskirgan deb hisoblanadi", () => {
    // Yangi o'rnatishda ham «zaxira ishlayaptimi?» degan savol darhol chiqsin.
    expect(isBackupStale(null, NOW)).toBe(true);
    expect(isBackupStale("", NOW)).toBe(true);
  });

  it("buzuq sana — eskirgan (jim o'tkazib yuborilmaydi)", () => {
    expect(isBackupStale("kecha", NOW)).toBe(true);
    expect(isBackupStale(hoursAgo(1), "qachondir")).toBe(true);
  });

  it("hoursSince to'g'ri sanaydi", () => {
    expect(hoursSince(hoursAgo(30), NOW)).toBe(30);
    expect(hoursSince(null, NOW)).toBeNull();
  });
});

describe("bazaga yozish va o'qish", () => {
  function fakeClient(over: Partial<BackupStatusClient["appConfig"]> = {}) {
    const upsert = vi.fn().mockResolvedValue({});
    const findUnique = vi.fn().mockResolvedValue({ value: hoursAgo(2) });
    return {
      client: { appConfig: { upsert, findUnique, ...over } } as unknown as BackupStatusClient,
      upsert,
      findUnique,
    };
  }

  it("muvaffaqiyatli zaxira sanasi to'g'ri kalit bilan yoziladi", async () => {
    const { client, upsert } = fakeClient();
    await expect(recordBackupOk(client, NOW)).resolves.toBe(true);
    expect(upsert).toHaveBeenCalledWith({
      where: { key: LAST_BACKUP_OK_KEY },
      create: { key: LAST_BACKUP_OK_KEY, value: NOW },
      update: { value: NOW },
    });
  });

  it("yozish yiqilsa — false qaytaradi, LEKIN throw qilmaydi", async () => {
    // Muhim: bu yozuv qo'shimcha himoya. Uning xatosi tayyor bo'lgan
    // zaxirani bekor qilib yuborsa — dorining o'zi kasallikdan yomon bo'ladi.
    const { client } = fakeClient({ upsert: vi.fn().mockRejectedValue(new Error("baza yiqildi")) });
    await expect(recordBackupOk(client, NOW)).resolves.toBe(false);
  });

  it("o'qish yiqilsa — null, throw yo'q", async () => {
    const { client } = fakeClient({ findUnique: vi.fn().mockRejectedValue(new Error("yo'q")) });
    await expect(readLastBackupOk(client)).resolves.toBeNull();
  });

  it("yozuv umuman bo'lmasa — null", async () => {
    const { client } = fakeClient({ findUnique: vi.fn().mockResolvedValue(null) });
    await expect(readLastBackupOk(client)).resolves.toBeNull();
  });
});

describe("ogohlantirish matni", () => {
  it("hech qachon zaxira bo'lmagan holatni ochiq aytadi", () => {
    const text = staleBackupMessage(null, NOW);
    expect(text).toContain("не приходят");
    expect(text).toContain("ни одной резервной копии");
  });

  it("oxirgi zaxira sanasini va necha soat o'tganini ko'rsatadi", () => {
    const text = staleBackupMessage(hoursAgo(40), NOW);
    expect(text).toContain("2026-08-31");
    expect(text).toContain("40 ч назад");
  });
});
