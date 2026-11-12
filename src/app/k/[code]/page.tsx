// ТЗ №20 H (§9) — карточка камня по скану /k/ONX-XXXXX.
//
// Одна ссылка — три вида (таблица 9.1), решает сессия:
//   • без входа  — клиент: витрина + наличие словом + «Оставить заявку»;
//   • PARTNER    — + свободно плит и м² + «Заявка на объём»;
//   • сотрудник  — + узоры, брони, локации, ориентир цены и кнопки
//                  «Продать» / «Забронировать» / «В шоу-рум».
// Что можно показать — решает buildCardView (src/lib/public-card.ts); служебные
// данные для клиента даже не грузятся.
//
// Маршрут ВНЕ login-gate (gated-request.isProxyPublicPath: /k/*). Публичные
// виды — ru / uz (cookie → язык браузера); сотруднику интерфейс по-русски.
// noindex — metadata.robots + заголовок X-Robots-Tag (next.config.ts).
// Счётчик сканирований — только клиент и партнёр (stone-scans.ts).
import type { Metadata } from "next";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { DENY_ALL, capabilitiesFor } from "@/lib/permissions";
import { findByCode, STONE_CODE_KIND_RU, type StoneCodeKind } from "@/lib/stone-code";
import {
  buildCardView,
  loadCardFacts,
  viewerForRole,
  type CardAvailability,
  type CardView,
  type StaffCardView,
} from "@/lib/public-card";
import {
  PUBLIC_LOCALE_COOKIE,
  htmlLangOf,
  publicDict,
  resolvePublicLocale,
  type PublicDict,
  type PublicLocale,
} from "@/lib/public-i18n";
import { recordScan } from "@/lib/stone-scans";
import { recordPassiveView } from "@/lib/leads";
import {
  notifyPartnerLeadSafe,
  VOLUME_REQUEST_ERROR_RU,
  type VolumeRequestError,
} from "@/lib/partners";
import { sendMessage } from "@/lib/telegram";
import { formatTashkentDate } from "@/lib/datetime";
import { formatPriceHint } from "@/lib/price-hint";
import { requestLead } from "@/app/kamen/[id]/lead-actions";
import LocaleSwitch from "@/components/public/LocaleSwitch";
import CardLeadForm from "./CardLeadForm";
import SimilarStones from "./SimilarStones";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Alert from "@/components/ui/Alert";
import Button, { buttonClass } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";

export const dynamic = "force-dynamic";

type Params = { code: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { code } = await params;
  const hit = await findByCode(db, code).catch(() => null);
  const st = hit
    ? await db.stoneType
        .findUnique({ where: { id: hit.stoneTypeId }, select: { name: true } })
        .catch(() => null)
    : null;
  return {
    title: st ? `${st.name} — Onyx` : "Камень по коду — Onyx",
    // §9.3 — публичные страницы закрыты от поисковиков.
    robots: { index: false, follow: false },
  };
}

const m2Fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

function availabilityLabel(a: CardAvailability, t: PublicDict): string {
  return a === "IN_STOCK" ? t.inStock : a === "IN_SHOWROOM" ? t.inShowroom : t.outOfStock;
}

function kindLabel(kind: StoneCodeKind, t: PublicDict): string | null {
  switch (kind) {
    case "PATTERN":
      return t.kindPattern;
    case "SLAB":
      return t.kindSlab;
    case "BATCH":
      return t.kindBatch;
    case "PIECE":
      return t.kindPiece;
    default:
      return null;
  }
}

function Photos({ ids, name, t }: { ids: string[]; name: string; t: PublicDict }) {
  if (ids.length === 0) {
    return (
      <div className="flex aspect-[16/10] w-full flex-col items-center justify-center gap-3 rounded-card border border-line bg-gold/10 px-4">
        <span
          aria-hidden
          className="flex h-16 w-16 items-center justify-center rounded-card bg-gold/20 font-serif text-3xl font-bold text-gold-deep"
        >
          {name.trim().charAt(0).toUpperCase() || "·"}
        </span>
        <p className="text-center text-sm font-medium text-ink/70">{t.noPhotos}</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-3 gap-2">
      {ids.map((id, i) => (
        <a
          key={id}
          href={`/api/photo/${id}`}
          target="_blank"
          rel="noreferrer"
          className={
            (i === 0 ? "col-span-3 " : "") +
            "block rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          }
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/photo/${id}`}
            alt={`${name} — ${t.photoAlt} ${i + 1}`}
            loading={i === 0 ? "eager" : "lazy"}
            className={
              (i === 0 ? "aspect-[4/3]" : "aspect-square") +
              " w-full rounded-card bg-ink/5 object-cover"
            }
          />
        </a>
      ))}
    </div>
  );
}

function Facts({ view, t }: { view: CardView; t: PublicDict }) {
  const rows: Array<[string, string]> = [[t.rockType, view.rockType]];
  if (view.color) rows.push([t.color, view.color]);
  if (view.size) rows.push([t.slabSize, view.size]);
  if (view.thickness) rows.push([t.thickness, view.thickness]);
  rows.push([t.code, view.code]);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink/55">{k}</dt>
          <dd className={"font-medium text-ink " + (k === t.code ? "tnum tracking-wide" : "")}>
            {v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function StaffBlock({ view }: { view: StaffCardView }) {
  const a = view.actions;
  return (
    <>
      <Card className="mt-4">
        <h2 className="font-serif text-xl font-bold text-ink">Склад</h2>
        <p className="mt-2 text-sm text-ink/70">
          Свободно:{" "}
          <span className="tnum font-semibold text-ink">
            {view.freeSlabs} пл. · {m2Fmt.format(view.freeAreaM2)} м²
          </span>
          {view.freePieces > 0 && (
            <>
              {" "}
              · бой/остатки: <span className="tnum font-semibold text-ink">{view.freePieces}</span>
            </>
          )}
        </p>
        {view.location && (
          <p className="mt-1 text-sm text-ink/70">
            <span className="text-ink/55">Локация:</span> {view.location}
          </p>
        )}

        {view.rows.length > 0 && (
          <div className="mt-3 onyx-table-wrap">
            <table className="onyx-table">
              <thead>
                <tr>
                  <th className="py-2 pl-3 font-medium">Узор / партия</th>
                  <th className="py-2 pl-3 text-right font-medium">Плит</th>
                  <th className="py-2 pl-3 text-right font-medium">м²</th>
                  <th className="py-2 pl-3 text-right font-medium">В брони</th>
                  <th className="py-2 px-3 font-medium">Где</th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="py-2 pl-3">
                      <span className="font-medium text-ink">{r.label}</span>
                      {r.format && <span className="block text-xs text-ink/55">{r.format}</span>}
                    </td>
                    <td className="tnum py-2 pl-3 text-right">{r.freeSlabs}</td>
                    <td className="tnum py-2 pl-3 text-right">{m2Fmt.format(r.freeAreaM2)}</td>
                    <td className="tnum py-2 pl-3 text-right text-ink/70">
                      {r.heldSlabs > 0 || r.heldAreaM2 > 0
                        ? `${r.heldSlabs} пл. / ${m2Fmt.format(r.heldAreaM2)} м²`
                        : "—"}
                    </td>
                    <td className="py-2 px-3 text-ink/70">{r.location}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h3 className="mt-4 text-sm font-semibold text-ink">
          Брони: <span className="tnum">{view.activeReservations}</span>
        </h3>
        {view.reservations.length > 0 ? (
          <ul className="mt-1 space-y-1 text-sm text-ink/70">
            {view.reservations.map((r) => (
              <li key={r.id}>
                <span className="font-medium text-ink">{r.customerName}</span> · {r.what} · до{" "}
                {formatTashkentDate(r.expiresAt)} · {r.managerName}
              </li>
            ))}
          </ul>
        ) : view.activeReservations > 0 ? (
          <p className="mt-1 text-sm text-ink/55">Брони других менеджеров — детали у них.</p>
        ) : null}

        {view.priceHint && (
          <p className="mt-4 text-sm text-ink/70">
            <span className="text-ink/55">Ориентир цены:</span>{" "}
            <span className="tnum font-semibold text-ink">
              {formatPriceHint(view.priceHint.uzsM2, view.priceHint.usdM2)}
            </span>
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <Link href={a.fullCardHref} className="font-semibold text-gold-deep underline">
            Полная карточка вида
          </Link>
          {a.reservationsHref && (
            <Link href={a.reservationsHref} className="font-semibold text-gold-deep underline">
              Все брони
            </Link>
          )}
          {a.historyHref && (
            <Link href={a.historyHref} className="font-semibold text-gold-deep underline">
              История
            </Link>
          )}
        </div>
      </Card>

      {(a.sellHref || a.reserveHref || a.showroomHref || a.collectionHref) && (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          {a.sellHref && (
            <Link href={a.sellHref} className={buttonClass("primary", "md", "w-full sm:w-auto")}>
              Продать
            </Link>
          )}
          {a.reserveHref && (
            <Link href={a.reserveHref} className={buttonClass("secondary", "md", "w-full sm:w-auto")}>
              Забронировать
            </Link>
          )}
          {a.showroomHref && (
            <Link href={a.showroomHref} className={buttonClass("secondary", "md", "w-full sm:w-auto")}>
              В шоу-рум
            </Link>
          )}
          {/* ТЗ №20 I (§10.3) — «В подборку»: выбрать свою подборку или создать. */}
          {a.collectionHref && (
            <Link href={a.collectionHref} className={buttonClass("secondary", "md", "w-full sm:w-auto")}>
              В подборку
            </Link>
          )}
        </div>
      )}
    </>
  );
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function StoneByCodePage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ code }, sp, user, cookieStore, h] = await Promise.all([
    params,
    searchParams,
    getCurrentUser().catch(() => null),
    cookies(),
    headers(),
  ]);
  const viewer = viewerForRole(user?.role);
  const caps = user
    ? capabilitiesFor(user.role, { canSeePurchasePrice: user.canSeePurchasePrice })
    : DENY_ALL;
  // Сотруднику — всегда русский (интерфейс персонала не переводится).
  const locale: PublicLocale =
    viewer === "staff"
      ? "ru"
      : resolvePublicLocale({
          cookie: cookieStore.get(PUBLIC_LOCALE_COOKIE)?.value,
          acceptLanguage: h.get("accept-language"),
        });
  const t = publicDict(locale);

  const hit = await findByCode(db, code);
  const facts = hit
    ? await loadCardFacts(db, hit, { viewer, caps, actorId: user?.id ?? null })
    : null;

  if (!hit || !facts) {
    return (
      <main lang={htmlLangOf(locale)} className="mx-auto max-w-2xl px-4 pb-12 pt-4 sm:p-8">
        {viewer !== "staff" && (
          <div className="mb-4 flex justify-end">
            <LocaleSwitch locale={locale} back={`/k/${encodeURIComponent(code)}`} t={t} />
          </div>
        )}
        <div className="rounded-card border border-line bg-paper-2 p-6 text-center">
          <h1 className="font-serif text-xl font-bold text-ink">{t.notFoundTitle}</h1>
          <p className="mt-2 text-sm text-ink/55">{t.notFoundBody}</p>
          {viewer === "staff" && (
            <Link href="/poisk" className={buttonClass("secondary", "md", "mt-4")}>
              Открыть «Поиск»
            </Link>
          )}
        </div>
      </main>
    );
  }

  const view = buildCardView(facts, viewer, caps);
  const back = `/k/${facts.code}`;

  // §9.3 — счётчик (клиент и партнёр; сотрудник не считается). Не роняет.
  await recordScan(db, { code: facts.code, stoneTypeId: facts.stoneTypeId, viewer });
  // §6.8.5 — партнёр открыл карточку: «интерес» в «Заявках», как в /kamen.
  if (viewer === "partner" && user) {
    try {
      const v = await recordPassiveView(db, { createdById: user.id, stoneTypeId: facts.stoneTypeId });
      // ТЗ №20 L (§13.1) — новый интерес уведомляет закреплённого менеджера.
      if (v.created && v.id) await notifyPartnerLeadSafe(db, sendMessage, v.id);
    } catch (err) {
      console.error("[k] recordPassiveView:", err);
    }
  }

  const leadOk = first(sp.lead) === "ok";
  const leadErr = first(sp.leadErr);
  const kLabel = kindLabel(view.kind, t);
  const staffKind = viewer === "staff" && view.kind !== "STONE_TYPE" ? STONE_CODE_KIND_RU[view.kind] : null;

  return (
    <main lang={htmlLangOf(locale)} className="mx-auto max-w-2xl px-4 pb-12 pt-4 sm:p-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold-deep">
          {viewer === "staff" ? "Onyx · карточка по коду" : t.brand}
        </p>
        {viewer !== "staff" && <LocaleSwitch locale={locale} back={back} t={t} />}
      </div>

      <Photos ids={view.photoIds} name={view.name} t={t} />

      <header className="mt-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="font-serif text-display font-bold tracking-tight text-ink">{view.name}</h1>
          <Badge variant={view.availability === "IN_STOCK" ? "success" : "neutral"}>
            {availabilityLabel(view.availability, t)}
          </Badge>
        </div>
        {(staffKind || kLabel || view.detail) && (
          <p className="mt-1 text-sm text-ink/60">
            {[staffKind ?? kLabel, view.detail].filter(Boolean).join(" · ")}
          </p>
        )}
      </header>

      {/* ТЗ №20 J (§11.3) — «Показать в интерьере» (есть текстура для 3D). */}
      {view.has3d && (
        <Link
          href={`/k/${view.code}/3d`}
          className={buttonClass("primary", "md", "mt-4 w-full sm:w-auto")}
        >
          {t.show3d}
        </Link>
      )}

      <Card className="mt-4">
        <Facts view={view} t={t} />
        {view.description && (
          <p className="mt-4 border-t border-line pt-3 text-base leading-relaxed text-ink/80">
            {view.description}
          </p>
        )}
      </Card>

      {/* Наличие: клиенту — словом, партнёру — плиты и м², сотруднику — блок «Склад». */}
      {view.viewer !== "staff" && (
        <Card className="mt-4">
          <h2 className="text-sm font-semibold text-ink">{t.availability}</h2>
          <p className="mt-1 text-lg font-semibold text-ink">
            {availabilityLabel(view.availability, t)}
          </p>
          {view.viewer === "partner" && view.availability === "IN_STOCK" && (
            <p className="mt-1 text-sm text-ink/70">
              {t.freeNow}:{" "}
              <span className="tnum font-semibold text-ink">
                {view.freeSlabs} {t.slabsShort} · {m2Fmt.format(view.freeAreaM2)} {t.m2}
              </span>
            </p>
          )}
          {view.availability === "OUT_OF_STOCK" && (
            <p className="mt-1 text-sm text-ink/60">{t.outOfStockHint}</p>
          )}
          {view.availability === "IN_SHOWROOM" && (
            <p className="mt-1 text-sm text-ink/60">{t.showroomHint}</p>
          )}
        </Card>
      )}

      {/* ТЗ №20 J (§11.1) — «В интерьере» (когда основные фото — фото узора). */}
      {view.interiorPhotoIds.length > 0 && (
        <Card className="mt-4">
          <h2 className="font-serif text-xl font-bold text-ink">{t.interiorTitle}</h2>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {view.interiorPhotoIds.map((id, i) => (
              <a key={id} href={`/api/photo/${id}`} target="_blank" rel="noreferrer" className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/photo/${id}`}
                  alt={`${view.name} — ${t.interiorTitle} ${i + 1}`}
                  loading="lazy"
                  className="aspect-square w-full rounded-card bg-ink/5 object-cover"
                />
              </a>
            ))}
          </div>
        </Card>
      )}

      {/* ТЗ №20 J (§11.2) — «Скачать текстуру для 3D»: партнёр и сотрудник. */}
      {view.viewer !== "client" && view.textureDownloads.length > 0 && (
        <Card className="mt-4">
          <h2 className="font-serif text-xl font-bold text-ink">{t.downloadTexture}</h2>
          <p className="mt-1 text-sm text-ink/60">{t.downloadTextureHint}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {view.textureDownloads.map((d) => (
              <a key={d.code} href={d.href} className={buttonClass("secondary", "sm")}>
                {view.textureDownloads.length > 1 ? `ZIP · ${d.label}` : "ZIP"}
              </a>
            ))}
          </div>
        </Card>
      )}

      {view.viewer === "staff" && <StaffBlock view={view} />}

      {/* ТЗ №20 I (§10.2) — до 6 похожих в наличии (во всех трёх видах). */}
      <SimilarStones stoneTypeId={facts.stoneTypeId} viewer={viewer} locale={locale} />
      <p className="mt-3">
        <Link href="/katalog" className="text-sm font-semibold text-gold-deep underline">
          {t.catalogLink}
        </Link>
      </p>

      {view.viewer === "client" && (
        <Card className="mt-4" id="zayavka">
          <h2 className="font-serif text-xl font-bold text-ink">{t.leaveRequest}</h2>
          <p className="mt-1 text-sm text-ink/60">{t.leaveRequestHint}</p>
          <CardLeadForm
            code={view.code}
            t={{
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
            }}
          />
        </Card>
      )}

      {/* Партнёр: «Заявка на объём» — тот же поток, что в /kamen (A1); часть L
          расширит его (закреплённый менеджер, «Мои заявки»). */}
      {view.viewer === "partner" && (
        <Card className="mt-4" id="zayavka">
          <h2 className="font-serif text-xl font-bold text-ink">{t.volumeRequest}</h2>
          <p className="mt-1 text-sm text-ink/60">{t.volumeRequestHint}</p>
          {leadOk && (
            <Alert variant="success" className="mt-3">
              {t.leadOk}{" "}
              <Link href="/moi-zayavki" className="font-semibold underline">
                {t.myLeads}
              </Link>
            </Alert>
          )}
          {leadErr && (
            // Код ошибки → текст (из ссылки показываем только известные коды).
            <Alert variant="danger" className="mt-3">
              {leadErr === "volume"
                ? t.volumeRequired
                : leadErr in VOLUME_REQUEST_ERROR_RU && locale === "ru"
                  ? VOLUME_REQUEST_ERROR_RU[leadErr as VolumeRequestError]
                  : t.partnerLeadErr}
            </Alert>
          )}
          <form action={requestLead} className="mt-3 flex flex-col gap-3">
            <input type="hidden" name="stoneTypeId" value={view.stoneTypeId} />
            <input type="hidden" name="stoneCode" value={view.code} />
            <input type="hidden" name="next" value={back} />
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
                {t.slabsShort}
                <input name="requestedSlabs" inputMode="numeric" placeholder="10" className={inputClass + " tnum"} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
                {t.m2}
                <input name="requestedAreaM2" inputMode="decimal" placeholder="12,5" className={inputClass + " tnum"} />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
              {t.siteLabel}
              <input name="siteText" maxLength={200} placeholder={t.sitePlaceholder} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
              {t.dueLabel}
              <input name="dueDate" type="date" className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
              {t.comment}
              <textarea name="note" rows={2} maxLength={1000} placeholder={t.commentPlaceholder} className={inputClass + " py-2"} />
            </label>
            <Button type="submit" className="w-full sm:w-auto">
              {t.submit}
            </Button>
          </form>
        </Card>
      )}
    </main>
  );
}
