// ТЗ №20 J — подписи 3D-просмотра из публичного словаря (ru / uz).
import type { PublicDict } from "./public-i18n";
import type { ViewerLabels } from "@/components/three/StoneViewer3D";

export function viewerLabels(t: PublicDict): ViewerLabels {
  return {
    kitchen: t.scene3dKitchen,
    bath: t.scene3dBath,
    hall: t.scene3dHall,
    loading: t.scene3dLoading,
    noWebgl: t.scene3dNoWebgl,
    hint: t.scene3dHint,
    stones: t.scene3dStones,
    slab: t.scene3dSlab,
    fullscreen: t.fullscreen,
  };
}

/** Камни без повторов текстуры, в исходном порядке. */
export function uniqueByTexture<T extends { textureId: string }>(list: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const s of list) {
    if (seen.has(s.textureId)) continue;
    seen.add(s.textureId);
    out.push(s);
  }
  return out;
}
