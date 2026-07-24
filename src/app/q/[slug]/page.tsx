// §6.7 — QR шоу-рум. ПУБЛИЧНАЯ карточка вида камня по qrSlug: клиент сканирует
// QR на образце и видит вид, фото и (в будущем) интерьеры — БЕЗ складских
// остатков, локаций и цен. Тот же URL, но сотрудник (canSeeExactRemainder)
// дополнительно получает ссылку на полную складскую карточку /kamen/[id].
//
// ⚠️ Маршрут ВНЕ login-gate (middleware matcher исключает /q) — клиент не
// залогинен. Поэтому здесь показываем только клиент-безопасные данные; точные
// остатки живут на /kamen/[id] под ролевым гейтом.
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getCapabilities } from "@/lib/session";
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
        where: { kind: { in: ["SAMPLE", "SLAB", "INTERIOR_AI"] } },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: { id: true, kind: true },
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
          Возможно, образец снят с каталога или ссылка устарела.
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

  return (
    <main className="mx-auto max-w-2xl p-4 pb-12 sm:p-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold-deep">
          Onyx · натуральный камень
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="font-serif text-display font-bold tracking-tight text-ink">
            {st.name}
          </h1>
          <Badge variant={hasStock ? "success" : "neutral"}>
            {hasStock ? "в наличии" : "под заказ"}
          </Badge>
        </div>
        <p className="mt-1 text-base text-ink/70">
          {st.rockType}
          {st.color && <> · {st.color}</>}
        </p>
      </header>

      {/* Фото и интерьеры (INTERIOR_AI — когда появятся, отрисуются здесь же). */}
      {st.photos.length > 0 ? (
        <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {st.photos.map((p) => (
            <a
              key={p.id}
              href={`/api/photo/${p.id}`}
              target="_blank"
              rel="noreferrer"
              className="block"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/photo/${p.id}`}
                alt={st.name}
                loading="lazy"
                className="aspect-square w-full rounded-card object-cover"
              />
            </a>
          ))}
        </div>
      ) : (
        <div className="mt-6 flex aspect-video w-full items-center justify-center rounded-card bg-ink/[0.04] text-sm text-ink/40">
          фото готовится
        </div>
      )}

      {(st.description || propRows.length > 0) && (
        <Card className="mt-6">
          {st.description && (
            <p className="text-base leading-relaxed text-ink/80">
              {st.description}
            </p>
          )}
          {propRows.length > 0 && (
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              {propRows.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-ink/50">{k}</dt>
                  <dd className="text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </Card>
      )}

      {st.textureFileUrl && (
        <a
          href={st.textureFileUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-block text-sm font-medium text-gold-deep underline"
        >
          Скачать текстуру
        </a>
      )}

      {/* Сотрудник по тому же QR получает полную складскую карточку. */}
      {isStaff && (
        <Card className="mt-6 border-gold/40">
          <p className="text-sm text-ink/70">
            Вы вошли как сотрудник — доступны остатки, локации и цены.
          </p>
          <Link
            href={`/kamen/${st.id}`}
            className="mt-2 inline-block font-semibold text-gold-deep underline"
          >
            Открыть складскую карточку →
          </Link>
        </Card>
      )}
    </main>
  );
}
