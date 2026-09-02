// Zaxira faylining shakli — siqish, shifrlash, sirlarni olib tashlash.
//
// Nega bu testlar muhim: zaxira faqat FALOKAT KUNI ochiladi. Agar o'sha kuni
// fayl ochilmasa, ikkinchi imkon bo'lmaydi. Shuning uchun har bir yo'l
// (shifrli, shifrsiz, eski shifrsiz `.json`) alohida tekshiriladi.

import { describe, expect, it } from "vitest";

import {
  BackupKeyError,
  ENC_MAGIC,
  MIN_KEY_LENGTH,
  backupFilename,
  detectFormat,
  packBackup,
  redactSecrets,
  resolveBackupKey,
  unpackBackup,
} from "@/lib/backup-file";
import { snapshotToJson, type Snapshot } from "@/lib/db-snapshot";

const KEY = "juda-uzun-va-maxfiy-kalit-2026";

function makeSnapshot(): Snapshot {
  return {
    version: 1,
    takenAt: "2026-09-02T21:00:00.000Z",
    counts: { user: 2, batch: 1 },
    rows: {
      user: [
        { id: "u1", email: "owner@onyx.local", role: "OWNER", passwordHash: "pbkdf2$100000$abc$def" },
        { id: "u2", email: "sklad@onyx.local", role: "WAREHOUSE", passwordHash: null },
      ],
      batch: [{ id: "b1", note: "Оникс Медовый" }],
    },
  };
}

describe("zaxira kaliti", () => {
  it("bo'sh yoki qisqa kalit — kalit yo'q deb hisoblanadi", () => {
    expect(resolveBackupKey({})).toBeNull();
    expect(resolveBackupKey({ BACKUP_ENCRYPTION_KEY: "" })).toBeNull();
    expect(resolveBackupKey({ BACKUP_ENCRYPTION_KEY: "   " })).toBeNull();
    expect(resolveBackupKey({ BACKUP_ENCRYPTION_KEY: "a".repeat(MIN_KEY_LENGTH - 1) })).toBeNull();
  });

  it("yetarli uzunlikdagi kalit qabul qilinadi va bo'shliqlari kesiladi", () => {
    expect(resolveBackupKey({ BACKUP_ENCRYPTION_KEY: `  ${KEY}  ` })).toBe(KEY);
  });
});

describe("sirlarni olib tashlash", () => {
  it("parol xeshi null bo'ladi, qolgan maydonlar tegilmaydi", () => {
    const { snapshot, removed } = redactSecrets(makeSnapshot());
    const users = snapshot.rows.user as Record<string, unknown>[];
    expect(users[0].passwordHash).toBeNull();
    expect(users[0].email).toBe("owner@onyx.local");
    expect(users[0].role).toBe("OWNER");
    expect(removed).toContain("user.passwordHash");
  });

  it("asl obyektga tegmaydi (sof funksiya)", () => {
    const original = makeSnapshot();
    redactSecrets(original);
    const users = original.rows.user as Record<string, unknown>[];
    expect(users[0].passwordHash).toBe("pbkdf2$100000$abc$def");
  });

  it("olib tashlanadigan sir bo'lmasa — ro'yxat bo'sh", () => {
    const snap = makeSnapshot();
    (snap.rows.user as Record<string, unknown>[]).forEach((u) => (u.passwordHash = null));
    expect(redactSecrets(snap).removed).toEqual([]);
  });
});

describe("shifrsiz rejim (kalit yo'q)", () => {
  it("gzip qiladi, parol xeshini olib tashlaydi va faylga izoh yozadi", () => {
    const packed = packBackup(makeSnapshot(), snapshotToJson, null);
    expect(packed.encrypted).toBe(false);
    expect(packed.redacted).toContain("user.passwordHash");
    expect(packed.filename).toBe("onyx-backup-2026-09-02.json.gz");
    expect(detectFormat(packed.bytes)).toBe("gzip");

    const back = JSON.parse(unpackBackup(packed.bytes, null));
    expect(back.rows.user[0].passwordHash).toBeNull();
    expect(back.rows.user[0].email).toBe("owner@onyx.local");
    expect(back.redacted).toContain("user.passwordHash");
  });

  it("siqilgan fayl xom JSON'dan kichik", () => {
    const snap = makeSnapshot();
    // Takrorlanuvchi matn — haqiqiy zaxira ham shunday (bir xil ustun nomlari).
    snap.rows.batch = Array.from({ length: 200 }, (_, i) => ({ id: `b${i}`, note: "Оникс Медовый" }));
    const packed = packBackup(snap, snapshotToJson, null);
    expect(packed.bytes.length).toBeLessThan(Buffer.byteLength(snapshotToJson(snap), "utf8") / 2);
  });
});

describe("shifrlangan rejim (kalit bor)", () => {
  it("fayl ONYXENC1 bilan boshlanadi va parol xeshi ICHIDA qoladi", () => {
    const packed = packBackup(makeSnapshot(), snapshotToJson, KEY);
    expect(packed.encrypted).toBe(true);
    expect(packed.redacted).toEqual([]);
    expect(packed.filename).toBe("onyx-backup-2026-09-02.json.gz.enc");
    expect(packed.bytes.subarray(0, 8).toString("ascii")).toBe(ENC_MAGIC);
    expect(detectFormat(packed.bytes)).toBe("enc");

    const back = JSON.parse(unpackBackup(packed.bytes, KEY));
    expect(back.rows.user[0].passwordHash).toBe("pbkdf2$100000$abc$def");
  });

  it("shifrlangan faylda ochiq matn qolmaydi", () => {
    const packed = packBackup(makeSnapshot(), snapshotToJson, KEY);
    const asText = packed.bytes.toString("latin1");
    expect(asText).not.toContain("owner@onyx.local");
    expect(asText).not.toContain("pbkdf2");
  });

  it("har safar boshqa tuz va vektor — bir xil ma'lumot bir xil fayl bermaydi", () => {
    const a = packBackup(makeSnapshot(), snapshotToJson, KEY).bytes;
    const b = packBackup(makeSnapshot(), snapshotToJson, KEY).bytes;
    expect(a.equals(b)).toBe(false);
  });

  it("kalitsiz ochilmaydi — tushunarli xato beradi", () => {
    const packed = packBackup(makeSnapshot(), snapshotToJson, KEY);
    expect(() => unpackBackup(packed.bytes, null)).toThrow(BackupKeyError);
  });

  it("noto'g'ri kalit bilan ochilmaydi", () => {
    const packed = packBackup(makeSnapshot(), snapshotToJson, KEY);
    expect(() => unpackBackup(packed.bytes, "boshqa-kalit-uzun-2026")).toThrow(BackupKeyError);
  });

  it("fayl o'zgartirilsa sezadi (GCM tegi)", () => {
    const packed = packBackup(makeSnapshot(), snapshotToJson, KEY);
    const tampered = Buffer.from(packed.bytes);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => unpackBackup(tampered, KEY)).toThrow(BackupKeyError);
  });
});

describe("eski fayllar bilan moslik", () => {
  it("shifrsiz `.json` zaxira hamon o'qiladi", () => {
    const plain = Buffer.from(snapshotToJson(makeSnapshot()), "utf8");
    expect(detectFormat(plain)).toBe("plain");
    const back = JSON.parse(unpackBackup(plain, null));
    expect(back.counts.user).toBe(2);
  });

  it("kalit bor bo'lsa ham eski shifrsiz fayl ochiladi", () => {
    const plain = Buffer.from(snapshotToJson(makeSnapshot()), "utf8");
    expect(JSON.parse(unpackBackup(plain, KEY)).version).toBe(1);
  });
});

describe("fayl nomi", () => {
  it("sana bo'yicha saralanadi va rejimni ko'rsatadi", () => {
    expect(backupFilename("2026-09-02T21:00:00.000Z", false)).toBe("onyx-backup-2026-09-02.json.gz");
    expect(backupFilename("2026-09-02T21:00:00.000Z", true)).toBe("onyx-backup-2026-09-02.json.gz.enc");
  });
});
