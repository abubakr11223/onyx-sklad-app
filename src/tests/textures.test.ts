// ТЗ №20 J — текстуры для 3D, интерьеры, 3D-масштаб (чистые правила).
import { describe, expect, it } from "vitest";
import {
  aspectMismatch,
  buildStoredZip,
  checkTextureSize,
  crc32,
  latinSlug,
  orientedSize,
  textureInfoTxt,
  textureZipName,
  textureZipSignature,
} from "@/lib/textures";
import { textureRepeat } from "@/lib/texture-scale";
import { isOwnBlobUrl } from "@/lib/storage/photo-storage";
import { coverRank } from "@/lib/catalog";
import { LEAD_KIND_RU, LEAD_KINDS } from "@/lib/leads";
import { ACTION_RU, ENTITY_RU } from "@/lib/history-labels";
import { isProxyPublicPath } from "@/lib/gated-request";
import { uniqueByTexture } from "@/lib/viewer-labels";

describe("§11.2 проверка фото текстуры", () => {
  it("JPG ≥ 4000 px по длинной стороне — ок (портрет и альбом)", () => {
    expect(checkTextureSize("jpeg", 4000, 2300, 5e6)).toBeNull();
    expect(checkTextureSize("jpeg", 2300, 4000, 5e6)).toBeNull();
  });
  it("меньше 4000 px — ошибка", () => {
    expect(checkTextureSize("jpeg", 3999, 2000, 5e6)).toBe("tooSmall");
  });
  it("не JPG — ошибка", () => {
    expect(checkTextureSize("png", 5000, 3000, 5e6)).toBe("notJpeg");
  });
  it("нечитаемое и слишком большое", () => {
    expect(checkTextureSize("jpeg", undefined, 3000, 5e6)).toBe("unreadable");
    expect(checkTextureSize("jpeg", 5000, 3000, 61 * 1024 * 1024)).toBe("tooBig");
  });
  it("EXIF 6/8 (поворот на 90°) меняет стороны местами", () => {
    expect(orientedSize(4000, 3000, 6)).toEqual({ widthPx: 3000, heightPx: 4000 });
    expect(orientedSize(4000, 3000, 1)).toEqual({ widthPx: 4000, heightPx: 3000 });
    expect(orientedSize(4000, 3000, undefined)).toEqual({ widthPx: 4000, heightPx: 3000 });
  });
});

describe("§11.2 пропорции фото против плиты (10%)", () => {
  it("280 × 160 и фото 1,75 — совпадает", () => {
    expect(aspectMismatch(5600, 3200, 280, 160)).toBe(false);
  });
  it("ориентация не важна", () => {
    expect(aspectMismatch(3200, 5600, 280, 160)).toBe(false);
    expect(aspectMismatch(5600, 3200, 160, 280)).toBe(false);
  });
  it("в пределах 10% — без предупреждения, больше — предупреждение", () => {
    // 1,75 × 1,09 ≈ 1,91 — ещё в допуске; 1,75 × 1,12 = 1,96 — уже нет.
    expect(aspectMismatch(1908, 1000, 280, 160)).toBe(false);
    expect(aspectMismatch(1960, 1000, 280, 160)).toBe(true);
    expect(aspectMismatch(4000, 4000, 280, 160)).toBe(true);
  });
  it("размер плиты неизвестен — сравнить не с чем", () => {
    expect(aspectMismatch(4000, 4000, null, 160)).toBe(false);
    expect(aspectMismatch(4000, 4000, null, null)).toBe(false);
  });
});

describe("§11.2 имя архива и info.txt", () => {
  it("пример из ТЗ", () => {
    expect(latinSlug("Травертин Классик")).toBe("Travertin-Klassik");
    expect(textureZipName("ONX-7K3QD", "Травертин Классик", 280, 160)).toBe(
      "ONX-7K3QD_Travertin-Klassik_280x160.zip",
    );
  });
  it("без размера — без хвоста; латиница и знаки", () => {
    expect(textureZipName("ONX-AAAAA", "Onyx «Black» №2", null, null)).toBe("ONX-AAAAA_Onyx-Black-No2.zip");
    expect(latinSlug("Щебень Ёлка")).toBe("Scheben-Yolka");
    expect(latinSlug("Ўзбек қора")).toBe("Ozbek-qora");
    expect(latinSlug("***")).toBe("stone");
  });
  it("info.txt — название, код, порода, цвет, размер, толщина", () => {
    const txt = textureInfoTxt({
      name: "Травертин Классик",
      code: "ONX-7K3QD",
      rockType: "Травертин",
      color: "бежевый",
      detail: "узор «светлый»",
      lengthCm: 280,
      widthCm: 160,
      thicknessCm: 1.8,
      widthPx: 5600,
      heightPx: 3200,
    });
    expect(txt).toContain("Название: Травертин Классик");
    expect(txt).toContain("Код: ONX-7K3QD");
    expect(txt).toContain("Порода: Травертин");
    expect(txt).toContain("Цвет: бежевый");
    expect(txt).toContain("Размер плиты: 280 × 160 см");
    expect(txt).toContain("Толщина: 1,8 см");
  });
  it("подпись меняется вместе с данными", () => {
    const a = textureZipSignature({ fileName: "a.zip", info: "x", originalKey: "o", previewKey: "p" });
    expect(textureZipSignature({ fileName: "a.zip", info: "x", originalKey: "o", previewKey: "p" })).toBe(a);
    expect(textureZipSignature({ fileName: "a.zip", info: "y", originalKey: "o", previewKey: "p" })).not.toBe(a);
  });
});

describe("§11.2 ZIP (store)", () => {
  it("CRC-32 эталон", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });
  it("структура: локальные заголовки, центральный каталог, конец", () => {
    const files = [
      { name: "texture.jpg", data: Buffer.from([0xff, 0xd8, 1, 2, 3]) },
      { name: "info.txt", data: Buffer.from("Название: Камень", "utf8") },
    ];
    const zip = buildStoredZip(files, new Date(Date.UTC(2026, 10, 9, 10, 30, 0)));
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    const eocd = zip.length - 22;
    expect(zip.readUInt32LE(eocd)).toBe(0x06054b50);
    expect(zip.readUInt16LE(eocd + 10)).toBe(2);
    const cdOffset = zip.readUInt32LE(eocd + 16);
    expect(zip.readUInt32LE(cdOffset)).toBe(0x02014b50);
    // Содержимое первого файла лежит сразу после заголовка и имени.
    const nameLen = zip.readUInt16LE(26);
    expect(zip.subarray(30 + nameLen, 30 + nameLen + 5)).toEqual(files[0].data);
    expect(zip.readUInt32LE(14)).toBe(crc32(files[0].data));
    // Второй файл: смещение из центрального каталога указывает на его заголовок.
    const cd2 = cdOffset + 46 + Buffer.byteLength("texture.jpg");
    expect(zip.readUInt32LE(zip.readUInt32LE(cd2 + 42))).toBe(0x04034b50);
  });
});

describe("§11.3 натуральный масштаб", () => {
  it("столешница 3,6 × 0,62 м при плите 280 × 160", () => {
    const [x, y] = textureRepeat(3.6, 0.62, 280, 160);
    expect(x).toBeCloseTo(3.6 / 2.8);
    expect(y).toBeCloseTo(0.62 / 1.6);
  });
  it("ориентация плиты в данных не важна; без размера — 280 × 160", () => {
    expect(textureRepeat(6, 6, 160, 280)).toEqual(textureRepeat(6, 6, 280, 160));
    expect(textureRepeat(6, 6, null, null)).toEqual(textureRepeat(6, 6, 280, 160));
  });
});

describe("загрузка из браузера — только наше хранилище", () => {
  const env = { BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_AbC123_secret" };
  it("наш стор и папка textures/", () => {
    expect(
      isOwnBlobUrl("https://abc123.public.blob.vercel-storage.com/textures/uploads/x.jpg", "textures/", env),
    ).toBe(true);
  });
  it("чужой стор, чужая папка, http, параметры — нет", () => {
    expect(isOwnBlobUrl("https://zzz999.public.blob.vercel-storage.com/textures/x.jpg", "textures/", env)).toBe(false);
    expect(isOwnBlobUrl("https://abc123.public.blob.vercel-storage.com/interiors/x.jpg", "textures/", env)).toBe(false);
    expect(isOwnBlobUrl("http://abc123.public.blob.vercel-storage.com/textures/x.jpg", "textures/", env)).toBe(false);
    expect(isOwnBlobUrl("https://abc123.public.blob.vercel-storage.com/textures/x.jpg?a=1", "textures/", env)).toBe(false);
    expect(isOwnBlobUrl("https://169.254.169.254/textures/x.jpg", "textures/", env)).toBe(false);
    expect(isOwnBlobUrl("не ссылка", "textures/", env)).toBe(false);
  });
});

describe("подписи, обложка, публичные пути", () => {
  it("«Интерес: скачал текстуру» в «Заявках»", () => {
    expect(LEAD_KINDS).toContain("TEXTURE_DOWNLOAD");
    expect(LEAD_KIND_RU.TEXTURE_DOWNLOAD).toBe("Интерес: скачал текстуру");
  });
  it("загрузка текстуры видна в «Истории»", () => {
    expect(ACTION_RU.TEXTURE_UPLOAD).toBeTruthy();
    expect(ENTITY_RU.StoneTexture).toBeTruthy();
  });
  it("обложка каталога: узор → готовая работа → AI → паллета", () => {
    expect(coverRank("SAMPLE")).toBeLessThan(coverRank("INTERIOR"));
    expect(coverRank("INTERIOR")).toBeLessThan(coverRank("INTERIOR_AI"));
    expect(coverRank("INTERIOR_AI")).toBeLessThan(coverRank("BATCH"));
  });
  it("/showroom-3d — без входа; /shourum — нет", () => {
    expect(isProxyPublicPath("/showroom-3d")).toBe(true);
    expect(isProxyPublicPath("/shourum")).toBe(false);
    expect(isProxyPublicPath("/k/ONX-7K3QD/3d")).toBe(true);
    expect(isProxyPublicPath("/podborka/ABCDEFGHJK/3d")).toBe(true);
  });
  it("камни 3D без повторов текстуры", () => {
    expect(
      uniqueByTexture([{ textureId: "a" }, { textureId: "b" }, { textureId: "a" }]).map((s) => s.textureId),
    ).toEqual(["a", "b"]);
  });
});
