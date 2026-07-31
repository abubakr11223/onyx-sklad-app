// §6.7 QR showroom — pure helpers (DB-free). Public page must prefer real
// warehouse photos when AI interiors are missing, and never invent stock data.
// Ordering + public payload shape unit-tested in src/tests/qr-showroom.test.ts.

/** Photo kinds the public /q card is allowed to request from the DB.
 *  Subset of api/photo allowlist — only kinds that are product imagery, not
 *  internal drawings of broken stones (DRAWING) or offcut-only (PIECE). */
export const QR_PUBLIC_PHOTO_KINDS = [
  "INTERIOR_AI",
  "SAMPLE",
  "SLAB",
] as const;

export type QrPublicPhotoKind = (typeof QR_PUBLIC_PHOTO_KINDS)[number];

export interface QrPhotoRef {
  id: string;
  kind: string;
}

/** Lower = earlier in the grid. Spec §6.7 wants interiors first; warehouse
 *  SAMPLE/SLAB are the fallback when AI has not been generated. */
const KIND_RANK: Record<string, number> = {
  INTERIOR_AI: 0,
  SAMPLE: 1,
  SLAB: 2,
};

/**
 * Stable showroom order: INTERIOR_AI → SAMPLE → SLAB, then by createdAt desc
 * when timestamps are provided (newer first within a kind).
 * Unknown kinds sink to the end (should not appear if DB filter is applied).
 */
export function orderShowroomPhotos<
  T extends { kind: string; createdAt?: Date | string | null },
>(photos: readonly T[]): T[] {
  return [...photos].sort((a, b) => {
    const ra = KIND_RANK[a.kind] ?? 99;
    const rb = KIND_RANK[b.kind] ?? 99;
    if (ra !== rb) return ra - rb;
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  });
}

export type ShowroomMediaMode =
  | "has_interiors"
  | "warehouse_photos_only"
  | "no_photos";

/** What the client is looking at when imagery is thin or rich. */
export function showroomMediaMode(
  photos: readonly { kind: string }[],
): ShowroomMediaMode {
  if (photos.length === 0) return "no_photos";
  if (photos.some((p) => p.kind === "INTERIOR_AI")) return "has_interiors";
  return "warehouse_photos_only";
}

export function photoKindLabelRu(kind: string): string {
  switch (kind) {
    case "INTERIOR_AI":
      return "В интерьере";
    case "SAMPLE":
      return "Образец";
    case "SLAB":
      return "Плита";
    default:
      return "Фото";
  }
}

/**
 * Fields a non-staff scanner may ever see on /q/[slug]. Used in tests to
 * lock the public contract — staff extras live only behind isStaff UI.
 */
export interface QrPublicViewModel {
  name: string;
  rockType: string;
  color: string | null;
  description: string | null;
  /** Key/value from StoneType.properties — product facts, not warehouse stock. */
  properties: Array<[string, string]>;
  /** Neutral stock fact only (no counts, blocks, prices). */
  stockLabel: "в наличии" | "под заказ";
  textureFileUrl: string | null;
  photoIds: string[];
  photoKinds: string[];
  mediaMode: ShowroomMediaMode;
}

export interface QrStaffExtras {
  /** Only when canSeeExactRemainder — link target to full warehouse card. */
  fullCardHref: string;
}

/**
 * Build the public view model. Callers pass pre-ordered photos and a neutral
 * hasStock flag — never exact remainder numbers.
 */
export function buildQrPublicView(input: {
  name: string;
  rockType: string;
  color: string | null;
  description: string | null;
  properties: Array<[string, string]>;
  hasStock: boolean;
  textureFileUrl: string | null;
  photos: readonly QrPhotoRef[];
}): QrPublicViewModel {
  const ordered = orderShowroomPhotos(input.photos);
  return {
    name: input.name,
    rockType: input.rockType,
    color: input.color,
    description: input.description,
    properties: input.properties,
    stockLabel: input.hasStock ? "в наличии" : "под заказ",
    textureFileUrl: input.textureFileUrl,
    photoIds: ordered.map((p) => p.id),
    photoKinds: ordered.map((p) => p.kind),
    mediaMode: showroomMediaMode(ordered),
  };
}

/** Staff-only extras — empty for public (isStaff false). */
export function buildQrStaffExtras(
  isStaff: boolean,
  stoneTypeId: string,
): QrStaffExtras | null {
  if (!isStaff) return null;
  return { fullCardHref: `/kamen/${stoneTypeId}` };
}
