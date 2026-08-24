// Rasm ombori drayveri (src/lib/storage/photo-storage.ts).
//
// Nima uchun bu testlar muhim:
//  1) KO'CHIRISH — loyiha oxirida ega serveriga o'tadi; drayver tanlovi bitta
//     env bilan hal bo'lishi va VPS'da (token yo'q) o'zi «local»ga tushishi shart;
//  2) XAVFSIZLIK — `local:` kaliti bazadan keladi; u hech qachon ombor
//     papkasidan tashqariga chiqmasligi kerak (path traversal).
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCAL_DIR,
  LOCAL_PREFIX,
  contentTypeFromPath,
  extFromMime,
  isLocalKey,
  isRemoteUrl,
  localKeyToAbsPath,
  localKeyToRelPath,
  localRoot,
  objectPath,
  putLocalObject,
  readLocalObject,
  resolveDriver,
} from "@/lib/storage/photo-storage";

describe("resolveDriver — ombor tanlovi", () => {
  it("PHOTO_STORAGE=local → disk", () => {
    expect(resolveDriver({ PHOTO_STORAGE: "local" })).toBe("local");
    expect(resolveDriver({ PHOTO_STORAGE: " LOCAL " })).toBe("local");
  });

  it("PHOTO_STORAGE=vercel-blob → blob (token bo'lmasa ham, aniq ko'rsatilgan)", () => {
    expect(resolveDriver({ PHOTO_STORAGE: "vercel-blob" })).toBe("vercel-blob");
    expect(resolveDriver({ PHOTO_STORAGE: "vercel" })).toBe("vercel-blob");
  });

  it("ko'rsatilmagan: token bor → blob, yo'q → local (VPS o'zi to'g'ri tanlaydi)", () => {
    expect(resolveDriver({ BLOB_READ_WRITE_TOKEN: "tok" })).toBe("vercel-blob");
    expect(resolveDriver({})).toBe("local");
  });

  it("localRoot: PHOTO_STORAGE_DIR yoki standart", () => {
    expect(localRoot({ PHOTO_STORAGE_DIR: "/srv/onyx-photos" })).toBe("/srv/onyx-photos");
    expect(localRoot({})).toBe(DEFAULT_LOCAL_DIR);
    expect(localRoot({ PHOTO_STORAGE_DIR: "   " })).toBe(DEFAULT_LOCAL_DIR);
  });
});

describe("storageKey shakllari", () => {
  it("https → tashqi URL; local: → o'z diskimiz; qolgani Telegram file_id", () => {
    expect(isRemoteUrl("https://x.public.blob.vercel-storage.com/a.jpg")).toBe(true);
    expect(isLocalKey("https://x/a.jpg")).toBe(false);
    expect(isLocalKey("local:patterns/b1/p1.jpg")).toBe(true);
    expect(isRemoteUrl("AgACAgIAAxkBAAI")).toBe(false);
    expect(isLocalKey("AgACAgIAAxkBAAI")).toBe(false);
  });
});

describe("localKeyToRelPath — path traversal yopiq", () => {
  it("oddiy kalit o'tadi", () => {
    expect(localKeyToRelPath("local:patterns/b1/p1.jpg")).toBe("patterns/b1/p1.jpg");
  });

  it("«..», mutlaq yo'l, bo'sh segment, disk harfi → null", () => {
    for (const bad of [
      "local:../../etc/passwd",
      "local:patterns/../../../etc/passwd",
      "local:/etc/passwd",
      "local:\\\\windows\\\\x.jpg",
      "local:C:/x.jpg",
      "local:",
      "local:   ",
      "local:a/./b.jpg",
    ]) {
      expect(localKeyToRelPath(bad)).toBeNull();
    }
  });

  it("takroriy ajratgich normallashadi (xavf yo'q): «a//b» → «a/b»", () => {
    expect(localKeyToRelPath("local:patterns//x.jpg")).toBe("patterns/x.jpg");
  });

  it("local: bo'lmagan kalit → null", () => {
    expect(localKeyToRelPath("https://x/a.jpg")).toBeNull();
    expect(localKeyToRelPath("AgACAgIAAxkBAAI")).toBeNull();
  });

  it("localKeyToAbsPath ildizdan chiqmaydi", () => {
    const env = { PHOTO_STORAGE_DIR: "/data/photos" };
    expect(localKeyToAbsPath("local:a/b.jpg", env)).toBe("/data/photos/a/b.jpg");
    expect(localKeyToAbsPath("local:../b.jpg", env)).toBeNull();
  });
});

describe("kengaytma va MIME", () => {
  it("extFromMime", () => {
    expect(extFromMime("image/png")).toBe("png");
    expect(extFromMime("image/webp")).toBe("webp");
    expect(extFromMime("image/jpeg")).toBe("jpg");
    expect(extFromMime("")).toBe("jpg");
  });

  it("contentTypeFromPath", () => {
    expect(contentTypeFromPath("a/b.png")).toBe("image/png");
    expect(contentTypeFromPath("a/b.webp")).toBe("image/webp");
    expect(contentTypeFromPath("a/b.gif")).toBe("image/gif");
    expect(contentTypeFromPath("a/b.jpg")).toBe("image/jpeg");
    expect(contentTypeFromPath("kengaytmasiz")).toBe("image/jpeg");
  });

  it("objectPath prefiksga kengaytma qo'shadi", () => {
    expect(objectPath("patterns/b1/p1-17", "image/png")).toBe("patterns/b1/p1-17.png");
  });
});

describe("diskka yozish va o'qish", () => {
  it("yozilgan bayt o'qilganda o'zgarmaydi, kalit local: bilan qaytadi", async () => {
    const dir = await mkdtemp(join(tmpdir(), "onyx-photos-"));
    const env = { PHOTO_STORAGE_DIR: dir };
    const bytes = Buffer.from([1, 2, 3, 4, 5]);

    const put = await putLocalObject(
      { pathPrefix: "patterns/b1/p1", bytes, mediaType: "image/png" },
      env,
    );
    expect(put.storageKey).toBe(LOCAL_PREFIX + "patterns/b1/p1.png");

    const onDisk = await readFile(join(dir, "patterns/b1/p1.png"));
    expect(Buffer.compare(onDisk, bytes)).toBe(0);

    const back = await readLocalObject(put.storageKey, env);
    expect(back?.contentType).toBe("image/png");
    expect(Buffer.from(back!.bytes)).toEqual(bytes);
  });

  it("yo'q fayl → null (marshrut 404 beradi, yiqilmaydi)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "onyx-photos-"));
    expect(await readLocalObject("local:yoq/fayl.jpg", { PHOTO_STORAGE_DIR: dir })).toBeNull();
  });

  it("yaroqsiz kalit → null (o'qishda ham himoya)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "onyx-photos-"));
    expect(await readLocalObject("local:../x.jpg", { PHOTO_STORAGE_DIR: dir })).toBeNull();
  });
});
