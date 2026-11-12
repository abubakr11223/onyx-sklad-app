// ТЗ №20 I (§10.1) — онлайн-каталог /katalog.
//
// Публичная витрина видов камня (вне login-gate: gated-request /katalog).
// Кто смотрит — решает сессия (как /k): без входа — клиент, PARTNER —
// партнёр, остальные — сотрудник. Что показать — loadCatalog/buildCatalogItem
// (src/lib/catalog.ts): клиенту без цифр, партнёру со свободным остатком,
// сотруднику всё + виды без фото / скрытые флагом (с пометкой).
//
// Фильтры (GET, в адресной строке — ссылкой можно поделиться): название или
// код ONX-… (тот же поиск, что «Поиск»), порода, цвет, толщина, нужный размер
// L×W — та же логика, что «Поиск» (poisk-size-fit.ts: запас 2 см, поворот).
// Сортировка: в наличии → по названию. noindex — metadata + X-Robots-Tag.
import AiSearchBox from "@/components/public/AiSearchBox";
import { PATTERN_RU, PATTERN_UZ, TONE_RU, TONE_UZ, parseWantedTraits } from "@/lib/stone-traits";
import type { Metadata } from "next";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { DENY_ALL, capabilitiesFor } from "@/lib/permissions";
import { viewerForRole } from "@/lib/public-card";
import {
  catalogQueryString,
  hasSizeFilter,
  loadCatalog,
  parseCatalogFilters,
} from "@/lib/catalog";
import {
  PUBLIC_LOCALE_COOKIE,
  htmlLangOf,
  publicDict,
  resolvePublicLocale,
  type PublicLocale,
} from "@/lib/public-i18n";
import { CUTTING_MARGIN_CM, formatThickness } from "@/lib/dimensions";
import LocaleSwitch from "@/components/public/LocaleSwitch";
import StoneTile from "@/components/public/StoneTile";
import Alert from "@/components/ui/Alert";
import Button, { buttonClass } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Каталог камня — Onyx",
  // §9.3 — публичные страницы закрыты от поисковиков.
  robots: { index: false, follow: false },
};

const selectClass = inputClass + " pr-8";

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [sp, user, cookieStore, h] = await Promise.all([
    searchParams,
    getCurrentUser().catch(() => null),
    cookies(),
    headers(),
  ]);
  const viewer = viewerForRole(user?.role);
  const caps = user
    ? capabilitiesFor(user.role, { canSeePurchasePrice: user.canSeePurchasePrice })
    : DENY_ALL;
  const locale: PublicLocale =
    viewer === "staff"
      ? "ru"
      : resolvePublicLocale({
          cookie: cookieStore.get(PUBLIC_LOCALE_COOKIE)?.value,
          acceptLanguage: h.get("accept-language"),
        });
  const t = publicDict(locale);
  const filters = parseCatalogFilters(sp);
  // ТЗ №20 K — тон/рисунок/прожилки/цвет по признакам (ИИ-поиск) ранжируют.
  const wanted = parseWantedTraits(sp);
  const result = await loadCatalog(db, { viewer, filters, wanted });
  const one = (k: string) => {
    const v = sp[k];
    return ((Array.isArray(v) ? v[0] : v) ?? "").trim();
  };
  const aiQuery = one("ai");
  const aiPhoto = one("aiPhoto");
  const aiMode = aiQuery !== "" || aiPhoto !== "";
  const toneName = (x: string) => (locale === "uz" ? TONE_UZ : TONE_RU)[x as keyof typeof TONE_RU] ?? x;
  const patName = (x: string) => (locale === "uz" ? PATTERN_UZ : PATTERN_RU)[x as keyof typeof PATTERN_RU] ?? x;
  // Чипы: каждый — ссылка на тот же каталог без этого фильтра.
  const chipDefs: Array<{ keys: string[]; label: string }> = [];
  if (filters.rock) chipDefs.push({ keys: ["rock"], label: `${t.chipRock}: ${filters.rock}` });
  if (filters.color) chipDefs.push({ keys: ["color"], label: `${t.chipColor}: ${filters.color}` });
  if (one("tcolor")) chipDefs.push({ keys: ["tcolor"], label: `${t.chipColor}: ${one("tcolor")}` });
  if (wanted.tone) chipDefs.push({ keys: ["tone"], label: `${t.chipTone}: ${toneName(wanted.tone)}` });
  if (wanted.pattern) chipDefs.push({ keys: ["pat"], label: `${t.chipPattern}: ${patName(wanted.pattern)}` });
  if (wanted.veinColor) chipDefs.push({ keys: ["vein"], label: `${t.chipVein}: ${wanted.veinColor}` });
  if (hasSizeFilter(filters)) {
    chipDefs.push({ keys: ["l", "w"], label: `${t.chipSize}: ${filters.lengthCm} × ${filters.widthCm} ${t.cm}` });
  }
  if (filters.thickness !== null) {
    chipDefs.push({ keys: ["t"], label: `${t.chipThickness}: ${formatThickness(filters.thickness)} ${t.cm}` });
  }
  if (filters.q && aiMode) chipDefs.push({ keys: ["q"], label: `«${filters.q}»` });
  const chipHref = (drop: string[]) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      const val = Array.isArray(v) ? v[0] : v;
      if (val && !drop.includes(k)) p.set(k, val);
    }
    const q = p.toString();
    return `/katalog${q ? `?${q}` : ""}#results`;
  };
  const back = `/katalog${catalogQueryString(filters)}`;
  const anyFilter =
    !!filters.q || !!filters.rock || !!filters.color || filters.thickness !== null ||
    filters.lengthCm !== null || filters.widthCm !== null;
  const halfSize = (filters.lengthCm === null) !== (filters.widthCm === null);

  return (
    <main lang={htmlLangOf(locale)} className="mx-auto max-w-5xl px-4 pb-12 pt-4 sm:p-8">
      <header className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold-deep">
            {viewer === "staff" ? "Onyx · каталог" : t.brand}
          </p>
          {viewer !== "staff" && <LocaleSwitch locale={locale} back={back} t={t} />}
          {viewer === "staff" && caps.canManageCollections && (
            <Link href="/podborki" className="text-sm font-semibold text-gold-deep underline">
              Мои подборки
            </Link>
          )}
        </div>
        <h1 className="mt-2 font-serif text-display font-bold tracking-tight text-ink">
          {t.catalogTitle}
        </h1>
        <p className="mt-1 text-sm text-ink/60">
          {viewer === "staff"
            ? "Так каталог видят клиенты — плюс виды без фото и скрытые (с пометкой). Ссылка для клиента: /katalog."
            : t.catalogSubtitle}
        </p>
      </header>

      {/* ТЗ №20 K — «Спросить ИИ» / «Найти по фото» → те же фильтры ниже. */}
      <AiSearchBox
        defaultQuery={aiQuery}
        labels={{
          title: t.aiTitle,
          placeholder: t.aiPlaceholder,
          submit: t.aiSubmit,
          thinking: t.aiThinking,
          photo: t.aiPhoto,
          photoHint: t.aiPhotoHint,
          photoBad: t.aiPhotoBad,
        }}
      />

      {/* Фильтры: GET-форма — состояние в адресе, кнопка «назад» работает. */}
      <form method="get" action="/katalog" className="rounded-card border border-line bg-paper-2 p-4">
        {/* ТЗ №20 K — правка фильтров не теряет признаки ИИ-запроса. */}
        {["ai", "tone", "pat", "vein", "tcolor"].map((k) =>
          one(k) ? <input key={k} type="hidden" name={k} value={one(k)} /> : null,
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink sm:col-span-2">
            {t.searchLabel}
            <input
              name="q"
              defaultValue={filters.q}
              placeholder={t.searchPlaceholder}
              autoComplete="off"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
            {t.rockType}
            <select name="rock" defaultValue={filters.rock} className={selectClass}>
              <option value="">{t.filterAny}</option>
              {result.options.rocks.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
            {t.color}
            <select name="color" defaultValue={filters.color} className={selectClass}>
              <option value="">{t.filterAny}</option>
              {result.options.colors.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
            {t.thicknesses}
            <select
              name="t"
              defaultValue={filters.thickness !== null ? String(filters.thickness) : ""}
              className={selectClass}
            >
              <option value="">{t.filterAny}</option>
              {result.options.thicknesses.map((x) => (
                <option key={x} value={String(x)}>
                  {formatThickness(x)} {t.cm}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="flex flex-col gap-1 sm:col-span-2 lg:col-span-2">
            <legend className="text-sm font-semibold text-ink">{t.filterSize}</legend>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <input
                name="l"
                inputMode="numeric"
                defaultValue={filters.lengthCm ?? ""}
                placeholder={t.lengthPlaceholder}
                aria-label={t.lengthPlaceholder}
                className={inputClass + " tnum"}
              />
              <input
                name="w"
                inputMode="numeric"
                defaultValue={filters.widthCm ?? ""}
                placeholder={t.widthPlaceholder}
                aria-label={t.widthPlaceholder}
                className={inputClass + " tnum"}
              />
            </div>
            <p className="text-sm font-normal text-ink/55">
              {viewer === "staff"
                ? `Как в «Поиске»: запас на рез ${CUTTING_MARGIN_CM} см, поворот заготовки учитывается.`
                : t.sizeHint}
            </p>
          </fieldset>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-1">
            <Button type="submit" className="w-full">
              {t.applyFilters}
            </Button>
            {anyFilter && (
              <Link href="/katalog" className={buttonClass("ghost", "md", "w-full")}>
                {t.resetFilters}
              </Link>
            )}
          </div>
        </div>
      </form>

      {halfSize && (
        <Alert variant="info" className="mt-4">
          {t.sizeNeedBoth}
        </Alert>
      )}

      {aiMode && (
        <div id="results" className="mt-4 scroll-mt-4 rounded-card border border-line bg-paper-2 p-3">
          <p className="text-sm font-semibold text-ink">
            {aiPhoto ? t.aiByPhoto : t.aiUnderstood}
            {aiQuery && <span className="font-normal text-ink/70"> — «{aiQuery}»</span>}
          </p>
          {(aiPhoto === "0" || aiPhoto === "bad" || aiPhoto === "big") && (
            <p className="mt-1 text-sm text-ink/60">{aiPhoto === "0" ? t.aiPhotoFail : t.aiPhotoBad}</p>
          )}
          {aiQuery && one("aiFail") === "1" && (
            <p className="mt-1 text-sm text-ink/60">{t.aiFallback}</p>
          )}
          {chipDefs.length > 0 && (
            <>
              <div className="mt-2 flex flex-wrap gap-2">
                {chipDefs.map((c) => (
                  <Link
                    key={c.keys.join("+")}
                    href={chipHref(c.keys)}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-field border border-line-strong bg-marble px-3 text-sm text-ink hover:bg-stone-100"
                  >
                    {c.label}
                    <span aria-hidden className="text-ink/50">✕</span>
                  </Link>
                ))}
              </div>
              <p className="mt-2 text-xs text-ink/50">{t.aiChipHint}</p>
            </>
          )}
        </div>
      )}

      <p className="mt-4 text-sm text-ink/60">
        {t.catalogFound}: <span className="tnum font-semibold text-ink">{result.total}</span>
        {hasSizeFilter(filters) && (
          <span className="tnum">
            {" "}
            · {filters.lengthCm} × {filters.widthCm} {t.cm}
          </span>
        )}
      </p>
      {result.truncated && (
        <Alert variant="info" className="mt-2">
          {t.catalogTruncated}
        </Alert>
      )}

      {result.items.length === 0 ? (
        <div className="mt-4 rounded-card border border-line bg-paper-2 p-6 text-center">
          <p className="text-sm text-ink/60">{t.catalogEmpty}</p>
        </div>
      ) : (
        <ul className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {result.items.map((item) => (
            <li key={item.code}>
              <StoneTile item={item} t={t}>
                {item.traitMatch !== undefined && item.traitMatch >= 2 && (
                  <p className="text-xs font-semibold text-gold-deep">{t.aiMatch}</p>
                )}
                {/* Нет в наличии → «Оставить заявку» (форма H на карточке). */}
                {viewer !== "staff" && item.availability === "OUT_OF_STOCK" && (
                  <Link
                    href={`/k/${item.code}#zayavka`}
                    className={buttonClass("secondary", "sm", "w-full")}
                  >
                    {viewer === "partner" ? t.volumeRequest : t.leaveRequest}
                  </Link>
                )}
                {viewer === "staff" && caps.canManageCollections && (
                  <Link
                    href={`/podborki/dobavit?code=${encodeURIComponent(item.code)}`}
                    className={buttonClass("secondary", "sm", "w-full")}
                  >
                    В подборку
                  </Link>
                )}
              </StoneTile>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
