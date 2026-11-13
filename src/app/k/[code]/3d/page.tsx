// ТЗ №20 J (§11.3) — «Показать в интерьере» с карточки /k/<код>.
// Камень кода + похожие (у которых есть текстура) — переключение без
// перезагрузки. Публично (как карточка): ни цифр, ни цен — только превью.
import type { Metadata } from "next";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { findByCode } from "@/lib/stone-code";
import { viewerForRole } from "@/lib/public-card";
import { loadSimilarStones } from "@/lib/catalog";
import { loadTexturesForHit, loadTexturesForTypes } from "@/lib/texture-store";
import {
  PUBLIC_LOCALE_COOKIE,
  htmlLangOf,
  publicDict,
  resolvePublicLocale,
} from "@/lib/public-i18n";
import { uniqueByTexture, viewerLabels } from "@/lib/viewer-labels";
import LocaleSwitch from "@/components/public/LocaleSwitch";
import StoneViewer3D from "@/components/three/StoneViewer3D";
import { buttonClass } from "@/components/ui/Button";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "3D — Onyx",
  robots: { index: false, follow: false },
};

export default async function Stone3DPage({ params }: { params: Promise<{ code: string }> }) {
  const [{ code }, user, cookieStore, h] = await Promise.all([
    params,
    getCurrentUser().catch(() => null),
    cookies(),
    headers(),
  ]);
  const viewer = viewerForRole(user?.role);
  const locale =
    viewer === "staff"
      ? "ru"
      : resolvePublicLocale({
          cookie: cookieStore.get(PUBLIC_LOCALE_COOKIE)?.value,
          acceptLanguage: h.get("accept-language"),
        });
  const t = publicDict(locale);
  const hit = await findByCode(db, code);
  const back = hit ? `/k/${hit.code}` : "/katalog";

  const own = hit ? await loadTexturesForHit(db, hit) : [];
  let similar: typeof own = [];
  if (hit) {
    // Похожие — те же, что на карточке (правила видимости зрителя), по коду вида.
    const items = await loadSimilarStones(db, hit.stoneTypeId, { viewer });
    const types = await db.stoneType.findMany({
      where: { code: { in: items.map((i) => i.code) } },
      select: { id: true, code: true },
    });
    const idByCode = new Map(types.map((x) => [x.code, x.id]));
    const ids = items.map((i) => idByCode.get(i.code)).filter((x) => x !== undefined);
    const tex = await loadTexturesForTypes(db, ids);
    similar = ids.map((id) => tex.get(id)).filter((s) => s !== undefined);
  }
  const stones = uniqueByTexture([...own, ...similar]);

  return (
    <main lang={htmlLangOf(locale)} className="mx-auto max-w-5xl px-4 pb-12 pt-4 sm:p-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Link href={back} className="text-sm font-semibold text-gold-deep underline">
          ← {t.back}
        </Link>
        {viewer !== "staff" && <LocaleSwitch locale={locale} back={`/k/${encodeURIComponent(code)}/3d`} t={t} />}
      </div>
      <h1 className="text-display font-semibold text-ink">{t.show3d}</h1>
      <p className="mb-4 mt-1 text-sm text-ink-2">{t.show3dHint}</p>
      {own.length === 0 ? (
        <div className="rounded-card border border-line bg-paper-2 p-6 text-center">
          <p className="text-sm text-ink-2">{hit ? t.scene3dEmpty : t.notFoundBody}</p>
          <Link href={back} className={buttonClass("secondary", "md", "mt-4")}>
            {t.back}
          </Link>
        </div>
      ) : (
        <StoneViewer3D stones={stones} labels={viewerLabels(t)} />
      )}
    </main>
  );
}
