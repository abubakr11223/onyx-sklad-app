// ТЗ №20 J (§11.3) — 3D-просмотр камней подборки (переключение без
// перезагрузки). Закрытая подборка — та же заглушка, что и /podborka.
import type { Metadata } from "next";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { db } from "@/lib/db";
import { collectionPath, normalizeCollectionCode } from "@/lib/collections";
import { loadTexturesForTypes } from "@/lib/texture-store";
import {
  PUBLIC_LOCALE_COOKIE,
  htmlLangOf,
  publicDict,
  resolvePublicLocale,
} from "@/lib/public-i18n";
import { uniqueByTexture, viewerLabels } from "@/lib/viewer-labels";
import StoneViewer3D from "@/components/three/StoneViewer3D";
import { buttonClass } from "@/components/ui/Button";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "3D — Onyx",
  robots: { index: false, follow: false },
};

export default async function Collection3DPage({ params }: { params: Promise<{ code: string }> }) {
  const [{ code: raw }, cookieStore, h] = await Promise.all([params, cookies(), headers()]);
  const locale = resolvePublicLocale({
    cookie: cookieStore.get(PUBLIC_LOCALE_COOKIE)?.value,
    acceptLanguage: h.get("accept-language"),
  });
  const t = publicDict(locale);
  const code = normalizeCollectionCode(raw);
  const c = code
    ? await db.collection.findUnique({
        where: { code },
        select: {
          code: true,
          closedAt: true,
          items: {
            orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
            select: { stoneTypeId: true },
          },
        },
      })
    : null;
  const back = c ? collectionPath(c.code) : "/katalog";

  let body: React.ReactNode;
  if (!c || c.closedAt) {
    body = (
      <div className="rounded-card border border-line bg-paper-2 p-6 text-center">
        <h1 className="text-xl font-semibold text-ink">
          {!c ? t.collectionNotFoundTitle : t.collectionClosedTitle}
        </h1>
        <p className="mt-2 text-sm text-ink-2">
          {!c ? t.collectionNotFoundBody : t.collectionClosedBody}
        </p>
      </div>
    );
  } else {
    const tex = await loadTexturesForTypes(db, c.items.map((i) => i.stoneTypeId));
    const stones = uniqueByTexture(
      c.items.map((i) => tex.get(i.stoneTypeId)).filter((s) => s !== undefined),
    );
    body =
      stones.length === 0 ? (
        <div className="rounded-card border border-line bg-paper-2 p-6 text-center">
          <p className="text-sm text-ink-2">{t.scene3dEmpty}</p>
          <Link href={back} className={buttonClass("secondary", "md", "mt-4")}>
            {t.back}
          </Link>
        </div>
      ) : (
        <StoneViewer3D stones={stones} labels={viewerLabels(t)} />
      );
  }

  return (
    <main lang={htmlLangOf(locale)} className="mx-auto max-w-5xl px-4 pb-12 pt-4 sm:p-8">
      <Link href={back} className="text-sm font-semibold text-gold-deep underline">
        ← {t.back}
      </Link>
      <h1 className="mb-4 mt-3 text-display font-semibold text-ink">{t.show3d}</h1>
      {body}
    </main>
  );
}
