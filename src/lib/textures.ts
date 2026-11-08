// ТЗ №20 J (§11.2) — «Текстура для 3D»: чистые правила (без БД и хранилища).
//
//   • проверка фото: JPG, не меньше 4000 px по длинной стороне;
//   • пропорции фото против длины × ширины плиты (допуск 10%) — только
//     предупреждение, сохранить можно;
//   • имя архива `ONX-7K3QD_Travertin-Klassik_280x160.zip` и info.txt;
//   • ZIP без сжатия (JPG уже сжат — deflate не выигрывает, а код проще);
//   • масштаб текстуры в 3D-сцене: одна плита = её реальный размер.

import { createHash } from "node:crypto";

export const TEXTURE_MIN_LONG_PX = 4000;
export const TEXTURE_PREVIEW_PX = 2048;
export const TEXTURE_ASPECT_TOLERANCE = 0.1;
/** Верхний предел оригинала (телефон/камера 50 Мп в JPG — ~25 МБ). */
export const TEXTURE_MAX_BYTES = 60 * 1024 * 1024;
/** Путь в хранилище, куда браузер грузит оригиналы напрямую. */
export const TEXTURE_UPLOAD_PREFIX = "textures/";
/** §11.1 — до 10 фото «В интерьере» на вид. */
export const INTERIOR_MAX = 10;


export type TextureCheckError = "notJpeg" | "tooSmall" | "tooBig" | "unreadable";

export const TEXTURE_ERROR_RU: Record<TextureCheckError | "noTarget" | "hasPatterns" | "denied" | "failed", string> = {
  notJpeg: "Нужен файл JPG.",
  tooSmall: `Фото слишком маленькое: нужно не меньше ${TEXTURE_MIN_LONG_PX} px по длинной стороне.`,
  tooBig: "Файл слишком большой (больше 60 МБ).",
  unreadable: "Не удалось прочитать фото — попробуйте другой файл.",
  noTarget: "Код не найден: текстура грузится на узор или на партию без узоров.",
  hasPatterns: "У партии есть узоры — загрузите текстуру на конкретный узор.",
  denied: "Недостаточно прав.",
  failed: "Не удалось сохранить текстуру — попробуйте ещё раз.",
};

export const ASPECT_WARNING_RU = "Пропорции фото не совпадают с размером плиты.";

/** Длинная сторона фото достаточна? */
export function checkTextureSize(
  format: string | undefined,
  widthPx: number | undefined,
  heightPx: number | undefined,
  sizeBytes: number,
): TextureCheckError | null {
  if (sizeBytes > TEXTURE_MAX_BYTES) return "tooBig";
  if (!widthPx || !heightPx) return "unreadable";
  if (format !== "jpeg" && format !== "jpg") return "notJpeg";
  if (Math.max(widthPx, heightPx) < TEXTURE_MIN_LONG_PX) return "tooSmall";
  return null;
}

/**
 * Фото плиты анфас: отношение длинной стороны к короткой должно совпадать с
 * длиной/шириной плиты с точностью 10%. Ориентация (портрет/альбом) не важна.
 * Размер плиты неизвестен → сравнить не с чем, предупреждения нет.
 */
export function aspectMismatch(
  widthPx: number,
  heightPx: number,
  lengthCm: number | null,
  widthCm: number | null,
): boolean {
  if (!lengthCm || !widthCm || lengthCm <= 0 || widthCm <= 0) return false;
  if (widthPx <= 0 || heightPx <= 0) return false;
  const photo = Math.max(widthPx, heightPx) / Math.min(widthPx, heightPx);
  const slab = Math.max(lengthCm, widthCm) / Math.min(lengthCm, widthCm);
  return Math.abs(photo - slab) / slab > TEXTURE_ASPECT_TOLERANCE;
}

/** EXIF-ориентация 5–8 = фото повёрнуто на 90°: ширина и высота меняются местами. */
export function orientedSize(
  widthPx: number,
  heightPx: number,
  orientation: number | undefined,
): { widthPx: number; heightPx: number } {
  return orientation && orientation >= 5 && orientation <= 8
    ? { widthPx: heightPx, heightPx: widthPx }
    : { widthPx, heightPx };
}

const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh",
  щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  // узбекская кириллица
  ў: "o", қ: "q", ғ: "g", ҳ: "h",
};

/** «Травертин Классик» → «Travertin-Klassik» (латиница, без пробелов). */
export function latinSlug(name: string): string {
  let out = "";
  for (const ch of name.normalize("NFC")) {
    const lower = ch.toLowerCase();
    const t = TRANSLIT[lower];
    if (t === undefined) {
      out += ch;
    } else if (ch !== lower && t.length > 0) {
      out += t.charAt(0).toUpperCase() + t.slice(1);
    } else {
      out += t;
    }
  }
  const slug = out
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug.slice(0, 60) : "stone";
}

function dimPart(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10).replace(".", ",");
}

/** `ONX-7K3QD_Travertin-Klassik_280x160.zip` (без размера — без хвоста). */
export function textureZipName(
  code: string,
  name: string,
  lengthCm: number | null,
  widthCm: number | null,
): string {
  const size = lengthCm && widthCm ? `_${dimPart(lengthCm)}x${dimPart(widthCm)}` : "";
  return `${code}_${latinSlug(name)}${size}.zip`;
}

export interface TextureInfo {
  name: string;
  code: string;
  rockType: string;
  color: string | null;
  /** Уточнение: узор «…» / партия от … */
  detail: string | null;
  lengthCm: number | null;
  widthCm: number | null;
  thicknessCm: number | null;
  widthPx: number;
  heightPx: number;
}

/** info.txt: название, код ONX, порода, цвет, размер плиты в см, толщина. */
export function textureInfoTxt(i: TextureInfo): string {
  const lines = [
    `Название: ${i.name}`,
    ...(i.detail ? [`Узор / партия: ${i.detail}`] : []),
    `Код: ${i.code}`,
    `Порода: ${i.rockType}`,
    `Цвет: ${i.color ?? "—"}`,
    `Размер плиты: ${
      i.lengthCm && i.widthCm ? `${dimPart(i.lengthCm)} × ${dimPart(i.widthCm)} см` : "не указан"
    }`,
    `Толщина: ${i.thicknessCm ? `${dimPart(i.thicknessCm)} см` : "не указана"}`,
    "",
    `texture.jpg — оригинал, ${i.widthPx} × ${i.heightPx} px`,
    `texture_2048.jpg — превью ${TEXTURE_PREVIEW_PX} px по длинной стороне`,
    "Масштаб: всё фото = одна плита указанного размера.",
    "",
  ];
  return lines.join("\r\n");
}

/** Подпись содержимого ZIP: поменялись данные или файлы → архив пересобирается. */
export function textureZipSignature(parts: {
  fileName: string;
  info: string;
  originalKey: string;
  previewKey: string;
}): string {
  return createHash("sha256")
    .update([parts.fileName, parts.info, parts.originalKey, parts.previewKey].join("\n"))
    .digest("hex")
    .slice(0, 32);
}

// ───────────────────────── ZIP (store, без сжатия) ─────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d: Date): { date: number; time: number } {
  const year = Math.max(1980, d.getUTCFullYear());
  return {
    date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
  };
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** Собрать ZIP (метод 0 «store», имена в UTF-8). Без ZIP64: файлы < 4 ГБ. */
export function buildStoredZip(entries: readonly ZipEntry[], now: Date = new Date()): Buffer {
  const { date, time } = dosDateTime(now);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const crc = crc32(e.data);
    const size = e.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // bit 11 — UTF-8 имена
    local.writeUInt16LE(0, 8); // store
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, Buffer.from(e.data.buffer, e.data.byteOffset, e.data.byteLength));

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += 30 + name.length + size;
  }
  const centralSize = centrals.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, end]);
}

export { DEFAULT_SLAB_CM } from "./texture-scale";
