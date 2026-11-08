// ТЗ №20 J (§11.3) — режим шоу-рума для планшета: полный экран, крупные
// кнопки, справа — камни, которые сейчас стоят в «Шоу-руме». Без входа.
//
// Камень витрины → текстура: узор плиты/куска → однородная партия → любая
// свежая текстура вида. Наружу уходит только превью и размер плиты: ни
// локаций, ни сотрудников из «Шоу-рума» здесь нет.
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { db } from "@/lib/db";
import { loadTextureIndex, type Stone3D } from "@/lib/texture-store";
import {
  PUBLIC_LOCALE_COOKIE,
  htmlLangOf,
  publicDict,
  resolvePublicLocale,
} from "@/lib/public-i18n";
import { uniqueByTexture, viewerLabels } from "@/lib/viewer-labels";
import StoneViewer3D from "@/components/three/StoneViewer3D";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Шоу-рум 3D — Onyx",
  robots: { index: false, follow: false },
};

const MAX_UNITS = 100;

async function showroomStones(): Promise<Stone3D[]> {
  const rows = await db.showroomPlacement.findMany({
    where: { closedAt: null },
    orderBy: [{ sentAt: "desc" }, { id: "desc" }],
    take: MAX_UNITS,
    select: {
      slab: { select: { status: true, stoneTypeId: true, batchId: true, batchPatternId: true } },
      piece: { select: { status: true, stoneTypeId: true, batchId: true, batchPatternId: true } },
    },
  });
  const units = rows
    .map((r) => r.slab ?? r.piece)
    .filter((u): u is NonNullable<typeof u> => !!u && u.status === "SHOWROOM");
  const idx = await loadTextureIndex(db, units.map((u) => u.stoneTypeId));
  const out: Stone3D[] = [];
  for (const u of units) {
    // Точная текстура единицы (её узор / однородная партия), иначе — вида.
    const s =
      (u.batchPatternId ? idx.byPattern.get(u.batchPatternId) : undefined) ??
      (!u.batchPatternId && u.batchId ? idx.byBatch.get(u.batchId) : undefined) ??
      idx.byType.get(u.stoneTypeId);
    if (s) out.push(s);
  }
  return uniqueByTexture(out);
}

export default async function Showroom3DPage() {
  const [cookieStore, h] = await Promise.all([cookies(), headers()]);
  const locale = resolvePublicLocale({
    cookie: cookieStore.get(PUBLIC_LOCALE_COOKIE)?.value,
    acceptLanguage: h.get("accept-language"),
  });
  const t = publicDict(locale);
  const stones = await showroomStones();

  return (
    <main lang={htmlLangOf(locale)} className="min-h-[100dvh] bg-paper">
      {stones.length === 0 ? (
        <div className="flex min-h-[100dvh] items-center justify-center p-8 text-center">
          <div>
            <h1 className="font-serif text-2xl font-bold text-ink">{t.showroom3dTitle}</h1>
            <p className="mt-2 text-base text-ink/60">{t.scene3dEmpty}</p>
          </div>
        </div>
      ) : (
        <StoneViewer3D stones={stones} labels={viewerLabels(t)} showroom />
      )}
    </main>
  );
}
