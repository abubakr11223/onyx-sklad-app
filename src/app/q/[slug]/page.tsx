// §6.7 — QR шоу-рум. ПУБЛИЧНАЯ карточка вида камня по qrSlug: клиент сканирует
// QR на образце и видит вид, фото и интерьеры — БЕЗ складских остатков, локаций
// и цен. Тот же URL: сотрудник (canSeeExactRemainder) получает ссылку на
// полную складскую карточку /kamen/[id].
//
// W7-D: пустой «фото готовится» — худший first impression. Если AI-интерьеров
// нет, показываем реальные SAMPLE/SLAB (уже в allowlist /api/photo); identity
// (порода/цвет/описание) всегда на виду; честный CTA «спросите менеджера».
//
// ⚠️ Маршрут ВНЕ login-gate (middleware matcher исключает /q).
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getCapabilities } from "@/lib/session";
import {
  QR_PUBLIC_PHOTO_KINDS,
  buildQrPublicView,
  buildQrStaffExtras,
  orderShowroomPhotos,
  photoKindLabelRu,
} from "@/lib/qr-showroom";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";

export const dynamic = "force-dynamic";

type Params = { slug: string };

/** properties (Json) → пары ключ/значение (клиент-безопасно). */
function propertyRows(properties: unknown): Array<[string, string]> {
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    return [];
  }
  return Object.entries(properties as Record<string, unknown>).map(([k, v]) => [
    k,
    v === null || v === undefined ? "—" : String(v),
  ]);
}

async function loadStone(slug: string) {
  const st = await db.stoneType.findFirst({
    where: { qrSlug: slug, isArchived: false },
    select: {
      id: true,
      name: true,
      rockType: true,
      color: true,
      description: true,
      textureFileUrl: true,
      properties: true,
      photos: {
        // Только product imagery: INTERIOR_AI + SAMPLE + SLAB (не DRAWING/PIECE).
        where: { kind: { in: [...QR_PUBLIC_PHOTO_KINDS] } },
        orderBy: { createdAt: "desc" },
        take: 12,
        select: { id: true, kind: true, createdAt: true },
      },
      // Нейтральный признак наличия (без чисел): есть ли что-то доступное.
      slabs: { where: { status: "AVAILABLE" }, select: { id: true }, take: 1 },
      pieces: { where: { status: "AVAILABLE" }, select: { id: true }, take: 1 },
      batches: {
        select: {
          slabsTotal: true,
          slabsSoldDirect: true,
          areaTotalM2: true,
          areaSoldDirectM2: true,
        },
      },
    },
  });
  return st;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const st = await loadStone(slug);
  return { title: st ? `${st.name} — Onyx` : "Камень не найден — Onyx" };
}

export default async function QrStonePage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const [st, caps] = await Promise.all([loadStone(slug), getCapabilities()]);

  if (!st) {
    return (
      <main className="mx-auto max-w-2xl p-4 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold-deep">
          Onyx
        </p>
        <h1 className="mt-2 font-serif text-display font-bold tracking-tight text-ink">
          Камень не найден
        </h1>
        <p className="mt-2 text-base text-ink/70">
          Возможно, образец снят с каталога или ссылка устарела. Спросите
          менеджера в шоу-руме — подберут похожий камень.
        </p>
      </main>
    );
  }

  // Нейтральное «в наличии»: любой доступный юнит или партия с остатком
  // (приблизительно — для клиента важен факт, а не точное число).
  const hasStock =
    st.slabs.length > 0 ||
    st.pieces.length > 0 ||
    st.batches.some(
      (b) =>
        (b.slabsTotal ?? 0) - b.slabsSoldDirect > 0 ||
        Number(b.areaTotalM2 ?? 0) - Number(b.areaSoldDirectM2) > 0,
    );

  const propRows = propertyRows(st.properties);
  const isStaff = caps.canSeeExactRemainder;
  const orderedPhotos = orderShowroomPhotos(st.photos);
  const view = buildQrPublicView({
    name: st.name,
    rockType: st.rockType,
    color: st.color,
    description: st.description,
    properties: propRows,
    hasStock,
    textureFileUrl: st.textureFileUrl,
    photos: orderedPhotos,
  });
  const staff = buildQrStaffExtras(isStaff, st.id);

  // Public contact: optional Telegram bot (same env as login CTA). No secrets.
  const botUser =
    process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME?.replace(/^@/, "").trim() ||
    process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "").trim() ||
    "";

  const monogram = (st.rockType || st.name).trim().charAt(0).toUpperCase() || "·";

  return (
    <main className="mx-auto max-w-2xl p-4 pb-12 sm:p-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold-deep">
          Onyx · натуральный камень
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="font-serif text-display font-bold tracking-tight text-ink">
            {view.name}
          </h1>
          <Badge variant={hasStock ? "success" : "neutral"}>
            {view.stockLabel}
          </Badge>
        </div>
        {/* Identity always prominent — even when photos/description are thin. */}
        <p className="mt-2 text-lg font-medium text-ink">
          {view.rockType}
          {view.color && (
            <>
              {" "}
              <span className="text-ink/40">·</span> {view.color}
            </>
          )}
        </p>
      </header>

      {/* Media: ordered INTERIOR_AI → SAMPLE → SLAB (warehouse fallback). */}
      {orderedPhotos.length > 0 ? (
        <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {orderedPhotos.map((p, i) => (
            <a
              key={p.id}
              href={`/api/photo/${p.id}`}
              target="_blank"
              rel="noreferrer"
              className={
                i === 0
                  ? "relative col-span-2 block sm:col-span-3"
                  : "relative block"
              }
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/photo/${p.id}`}
                alt={`${st.name} — ${photoKindLabelRu(p.kind)}`}
                loading={i === 0 ? "eager" : "lazy"}
                className={
                  i === 0
                    ? "aspect-[16/10] w-full rounded-card object-cover"
                    : "aspect-square w-full rounded-card object-cover"
                }
              />
              <span className="absolute bottom-2 left-2 rounded-full bg-ink/70 px-2 py-0.5 text-xs font-medium text-paper">
                {photoKindLabelRu(p.kind)}
              </span>
            </a>
          ))}
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-card border border-line bg-paper-2">
          <div className="flex aspect-[16/10] w-full flex-col items-center justify-center gap-3 bg-gold/10 px-4">
            <span
              aria-hidden
              className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gold/20 font-serif text-3xl font-bold text-gold-deep"
            >
              {monogram}
            </span>
            <p className="text-center text-sm font-medium text-ink/70">
              Фото и интерьеры ещё готовятся
            </p>
            <p className="max-w-sm text-center text-sm text-ink/55">
              Камень в каталоге есть
              {view.color ? ` — ${view.rockType}, ${view.color}` : ` — ${view.rockType}`}.
              Попросите менеджера в шоу-руме показать образец вживую
              {view.stockLabel === "в наличии" ? " — он в наличии на складе" : ""}.
            </p>
          </div>
        </div>
      )}

      {view.mediaMode === "warehouse_photos_only" && (
        <p className="mt-2 text-xs text-ink/50">
          Показаны фото со склада. Виды в интерьере появятся, когда менеджер
          сгенерирует их для этого камня.
        </p>
      )}

      {/* Always show identity card — not only when description/properties exist. */}
      <Card className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/50">
          О камне
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-ink/50">Порода</dt>
          <dd className="font-medium text-ink">{view.rockType}</dd>
          {view.color && (
            <>
              <dt className="text-ink/50">Цвет</dt>
              <dd className="font-medium text-ink">{view.color}</dd>
            </>
          )}
          <dt className="text-ink/50">Наличие</dt>
          <dd className="font-medium text-ink">{view.stockLabel}</dd>
        </dl>
        {view.description ? (
          <p className="mt-4 text-base leading-relaxed text-ink/80">
            {view.description}
          </p>
        ) : (
          <p className="mt-4 text-sm text-ink/50">
            Подробное описание появится позже. Менеджер расскажет о фактуре и
            толщинах на месте.
          </p>
        )}
        {view.properties.length > 0 && (
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-line pt-3 text-sm">
            {view.properties.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-ink/50">{k}</dt>
                <dd className="text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </Card>

      {view.textureFileUrl && (
        <a
          href={view.textureFileUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-block text-sm font-medium text-gold-deep underline"
        >
          Скачать текстуру
        </a>
      )}

      {/* Honest next step when visuals are thin — not a dead end. */}
      {(view.mediaMode === "no_photos" || !view.description) && (
        <Card className="mt-6 border-gold/30 bg-gold/5">
          <h2 className="text-base font-semibold text-ink">
            Хотите увидеть камень вживую?
          </h2>
          <p className="mt-1 text-sm text-ink/70">
            Подойдите к менеджеру в шоу-руме с названием{" "}
            <span className="font-medium text-ink">«{view.name}»</span> — покажут
            образец, наличие и цену.
          </p>
          {botUser && (
            <a
              href={`https://t.me/${botUser}`}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-sm font-semibold text-gold-deep underline"
            >
              Написать в Telegram →
            </a>
          )}
        </Card>
      )}

      {/* Сотрудник по тому же QR — полная складская карточка (остатки/цены). */}
      {staff && (
        <Card className="mt-6 border-gold/40">
          <p className="text-sm text-ink/70">
            Вы вошли как сотрудник — доступны остатки, локации и цены.
          </p>
          <Link
            href={staff.fullCardHref}
            className="mt-2 inline-block font-semibold text-gold-deep underline"
          >
            Открыть складскую карточку →
          </Link>
        </Card>
      )}
    </main>
  );
}
