// ТЗ №20 I (§10.3) — публичная подборка /podborka/<код>.
//
// Права клиента без входа (таблица 9.1) для ВСЕХ, кто открыл ссылку, — даже
// для сотрудника: это страница «как видит клиент» (управление подборкой —
// /podborki/<id>). Камни — плитками каталога (вид «client»: без цифр, локаций,
// цен, клиентов, менеджеров), комментарий менеджера, «Нравится» и заявка на
// конкретный камень (поток H, источник «QR / каталог», в заявке — подборка).
//
// Закрытая подборка: только «Подборка закрыта, свяжитесь с менеджером».
// Вне login-gate (gated-request /podborka/), noindex — metadata + X-Robots-Tag.
import type { Metadata } from "next";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { viewerForRole } from "@/lib/public-card";
import { collectionPath, loadPublicCollection } from "@/lib/collections";
import { typesWithTexture } from "@/lib/texture-store";

import {
  PUBLIC_LOCALE_COOKIE,
  htmlLangOf,
  publicDict,
  resolvePublicLocale,
  type PublicDict,
} from "@/lib/public-i18n";
import { toggleLikeAction } from "@/app/k/actions";
import CardLeadForm from "@/app/k/[code]/CardLeadForm";
import LocaleSwitch from "@/components/public/LocaleSwitch";
import ShareButtons from "@/components/public/ShareButtons";
import StoneTile from "@/components/public/StoneTile";
import { buttonClass } from "@/components/ui/Button";

async function typeIdsByCodes(codes: string[]): Promise<string[]> {
  if (codes.length === 0) return [];
  const rows = await db.stoneType.findMany({ where: { code: { in: codes } }, select: { id: true } });
  return rows.map((r) => r.id);
}

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Подборка камней — Onyx",
  robots: { index: false, follow: false },
};

function leadTexts(t: PublicDict) {
  return {
    name: t.name,
    phone: t.phone,
    comment: t.comment,
    commentPlaceholder: t.commentPlaceholder,
    submit: t.submit,
    sending: t.sending,
    leadOk: t.leadOk,
    errName: t.errName,
    errPhone: t.errPhone,
    errPhoneInvalid: t.errPhoneInvalid,
    errDuplicate: t.errDuplicate,
    errRate: t.errRate,
    errFailed: t.errFailed,
  };
}

export default async function PublicCollectionPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const [{ code }, user, cookieStore, h] = await Promise.all([
    params,
    getCurrentUser().catch(() => null),
    cookies(),
    headers(),
  ]);
  const isStaff = viewerForRole(user?.role) === "staff";
  const locale = resolvePublicLocale({
    cookie: cookieStore.get(PUBLIC_LOCALE_COOKIE)?.value,
    acceptLanguage: h.get("accept-language"),
  });
  const t = publicDict(locale);
  const data = await loadPublicCollection(db, code);
  const back = data.status === "notfound" ? "/katalog" : collectionPath(data.code);

  const top = (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold-deep">
        {t.collectionEyebrow}
      </p>
      <LocaleSwitch locale={locale} back={back} t={t} />
    </div>
  );

  if (data.status !== "open") {
    const notFound = data.status === "notfound";
    return (
      <main lang={htmlLangOf(locale)} className="mx-auto max-w-2xl px-4 pb-12 pt-4 sm:p-8">
        {top}
        <div className="rounded-card border border-line bg-paper-2 p-6 text-center">
          {!notFound && <p className="text-sm text-ink/55">«{data.title}»</p>}
          <h1 className="mt-1 font-serif text-xl font-bold text-ink">
            {notFound ? t.collectionNotFoundTitle : t.collectionClosedTitle}
          </h1>
          <p className="mt-2 text-sm text-ink/60">
            {notFound ? t.collectionNotFoundBody : t.collectionClosedBody}
          </p>
          <Link href="/katalog" className={buttonClass("secondary", "md", "mt-4")}>
            {t.catalogLink}
          </Link>
        </div>
      </main>
    );
  }

  const path = collectionPath(data.code);
  // ТЗ №20 J — «Показать в интерьере», если хоть у одного камня есть текстура.
  const has3d =
    (await typesWithTexture(db, await typeIdsByCodes(data.items.map((i) => i.stone.code)))).size > 0;
  return (
    <main lang={htmlLangOf(locale)} className="mx-auto max-w-5xl px-4 pb-12 pt-4 sm:p-8">
      {top}
      <header className="mb-4">
        <h1 className="font-serif text-display font-bold tracking-tight text-ink">{data.title}</h1>
        <p className="mt-1 text-sm text-ink/60">{t.collectionHint}</p>
        {isStaff && (
          <p className="mt-1 text-sm text-ink/55">
            Вы видите подборку глазами клиента. Отметки «Нравится» — в «Подборках».
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {has3d && (
            <Link href={`${path}/3d`} className={buttonClass("primary", "sm")}>
              {t.show3d}
            </Link>
          )}
          <ShareButtons
            path={path}
            title={data.title}
            t={{ copyLink: t.copyLink, linkCopied: t.linkCopied, share: t.share }}
          />
        </div>
      </header>

      {data.items.length === 0 ? (
        <div className="rounded-card border border-line bg-paper-2 p-6 text-center">
          <p className="text-sm text-ink/60">{t.collectionEmpty}</p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map((it) => (
            <li key={it.id} id={`s-${it.id}`}>
              <StoneTile item={it.stone} t={t} href={`/k/${it.code}`}>
                {it.comment && (
                  <p className="rounded-field bg-gold/10 px-3 py-2 text-sm text-ink/80">
                    <span className="block text-xs font-semibold text-gold-deep">
                      {t.managerComment}
                    </span>
                    {it.comment}
                  </p>
                )}
                <form action={toggleLikeAction}>
                  <input type="hidden" name="collection" value={data.code} />
                  <input type="hidden" name="item" value={it.id} />
                  <button
                    type="submit"
                    aria-pressed={it.liked}
                    title={it.liked ? t.likeUndo : t.like}
                    className={buttonClass(
                      it.liked ? "primary" : "secondary",
                      "sm",
                      "w-full",
                    )}
                  >
                    {it.liked ? t.liked : t.like}
                  </button>
                </form>
                <details className="rounded-field border border-line bg-paper px-3 py-2">
                  <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold">
                    {t.requestThis}
                  </summary>
                  <CardLeadForm
                    code={it.code}
                    collection={data.code}
                    idPrefix={`p-${it.id}`}
                    t={leadTexts(t)}
                  />
                </details>
              </StoneTile>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-6 text-center">
        <Link href="/katalog" className="text-sm font-semibold text-gold-deep underline">
          {t.catalogLink}
        </Link>
      </p>
    </main>
  );
}
