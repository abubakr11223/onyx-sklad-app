// §5.5b — «Бой по фото» (TZ §5.5 / §6.4 case A photo branch): server component.
// Bot yuborgan havoladagi `d` draft'ini (AI polygon + Telegram file_id) QATTIQ
// dekodlaydi, chertyojni raqamlangan tomonlar bilan ko'rsatadi va skladchidan
// har tomonning REAL o'lchamini so'raydi. Saqlash — ./actions.submitSingan.
// Web-UI tili — RUSCHA (bot caption o'zbek/rus).
// W10-A: without `?d=` this is an instruction landing (reachable from /razbit),
// not a dead end — AI still starts only in Telegram (product decision).

import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getCapabilities } from "@/lib/session";
import { formatTashkentDate } from "@/lib/datetime";
import NoAccess from "@/components/NoAccess";
import { decodeShapeDraft } from "@/lib/singan";
import { renderChertyoj } from "@/lib/chertyoj";
import SinganForm, { type SinganBatchOption } from "./SinganForm";
import { sortBlockOptions, sortLandmarks } from "@/lib/warehouse-grid";
import { buttonClass } from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Alert from "@/components/ui/Alert";

export const metadata: Metadata = {
  title: "Бой по фото — Onyx",
};

// Partiya ro'yxati joriy DB holatini aks ettirsin.
export const dynamic = "force-dynamic";

const m2Fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Единая шапка страницы: gold-deep надзаголовок + serif-заголовок. */
function PageHeader({ subtitle }: { subtitle?: string }) {
  return (
    <header className="mb-6">
      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold-deep">
        Onyx · склад
      </p>
      <h1 className="mt-2 font-serif text-display font-bold tracking-tight text-ink">
        Бой по фото
      </h1>
      {subtitle && <p className="mt-2 text-base text-ink/60">{subtitle}</p>}
    </header>
  );
}

export default async function SinganPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // R2 — rol gate: бой записывает склад (canManageWarehouse: OWNER/WAREHOUSE).
  const caps = await getCapabilities();
  if (!caps.canManageWarehouse) {
    return (
      <main className="mx-auto max-w-xl p-4 pb-12">
        <NoAccess />
      </main>
    );
  }

  const sp = await searchParams;
  const ok = first(sp.ok) === "1";
  const photoWarn = first(sp.photoWarn) === "1";
  const stoneId = first(sp.stone);
  const causeLabel = first(sp.cause);

  // ── Yakuniy panel: sof muvaffaqiyat yoki piece OK + photo yo'q (photoWarn) ──
  if (ok) {
    return (
      <main className="mx-auto max-w-xl p-4 pb-12">
        <PageHeader />
        <Alert
          variant={photoWarn ? "warning" : "success"}
          title={
            photoWarn
              ? "Кусок записан — фото не сохранено"
              : "Кусок записан"
          }
        >
          {photoWarn ? (
            <p className="text-ink/70">
              Кусок в остатке есть (чертёж сохранён), но фото из Telegram не
              прикрепилось. Откройте карточку камня и добавьте фото вручную,
              либо повторите из бота.
            </p>
          ) : (
            <p className="text-ink/70">
              Чертёж и фото сохранены в карточке камня.
            </p>
          )}
          {causeLabel && (
            <p className="mt-1 text-sm text-ink/70">
              Причина: <span className="font-medium text-ink">{causeLabel}</span>
            </p>
          )}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            {stoneId && (
              <Link
                href={`/kamen/${stoneId}`}
                className={buttonClass("primary", "md")}
              >
                Открыть карточку камня
              </Link>
            )}
            <Link href="/razbit" className={buttonClass("secondary", "md")}>
              Ещё бой / распил (/razbit)
            </Link>
          </div>
        </Alert>
      </main>
    );
  }

  // ── Draft: foydalanuvchi nazoratidagi URL ma'lumoti — QATTIQ dekodlash ──
  // Without `d` (or broken d): honest landing — explain Telegram entry, link to
  // manual /razbit. Cannot start AI drawing on the web (product decision).
  const draft = decodeShapeDraft(first(sp.d));
  if (!draft) {
    const hadD = Boolean(first(sp.d));
    return (
      <main className="mx-auto max-w-xl p-4 pb-12">
        <PageHeader subtitle="Чертёж ИИ и ввод размеров по фото" />
        <Alert
          variant={hadD ? "warning" : "info"}
          title={
            hadD
              ? "Ссылка повреждена или устарела"
              : "Сначала фото в Telegram-боте"
          }
          className="mb-6"
        >
          <p className="text-ink/70">
            {hadD
              ? "Откройте свежую ссылку из бота или начните заново:"
              : "Эта страница открывается по ссылке из бота после распознавания формы. Так задумано: фото и ИИ — в Telegram, размеры — здесь."}
          </p>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-ink/80">
            <li>Откройте Telegram-бот Onyx (тот же, что для фотозапросов).</li>
            <li>
              Отправьте <strong>фото</strong> куска; в подписи напишите{" "}
              <strong>«бой»</strong> или <strong>«singan»</strong>.
            </li>
            <li>
              Бот ответит ссылкой — по ней откроется чертёж и поля для сторон.
            </li>
          </ol>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Link href="/razbit" className={buttonClass("primary", "md")}>
              Ввести бой вручную (/razbit)
            </Link>
            <Link href="/razbit" className={buttonClass("secondary", "md")}>
              Распил плиты — тоже /razbit
            </Link>
          </div>
        </Alert>
        <Card>
          <p className="text-sm text-ink/60">
            Команда бота <code className="text-ink">/singan</code> без фото
            пришлёт ту же инструкцию. После сохранения куска его можно открыть
            в карточке камня (поиск → вид).
          </p>
        </Card>
      </main>
    );
  }

  // AI-chertyoj: tomonlar 1..N raqamlangan. SVG'ni BIZ validatsiyadan o'tgan
  // polygon'dan renderChertyoj bilan yasadik (yozuvlar escapeXml qilinadi) —
  // shuning uchun dangerouslySetInnerHTML bu yerda xavfsiz (SinganForm ichida).
  const svg = renderChertyoj(draft.vertices);

  const [batchRows, gridBlocks] = await Promise.all([
    db.batch.findMany({
      orderBy: [{ stoneType: { name: "asc" } }, { arrivedAt: "desc" }],
      select: {
        id: true,
        arrivedAt: true,
        slabsTotal: true,
        areaTotalM2: true,
        stoneType: { select: { name: true } },
      },
    }),
    // ТЗ №17 §6 — блок выбирается из карты склада (как в приёмке и /razbit).
    db.warehouseBlock.findMany({
      select: { letter: true, landmarks: { select: { number: true } } },
    }),
  ]);

  const batches: SinganBatchOption[] = batchRows.map((b) => {
    const qty = [
      b.slabsTotal !== null && `${b.slabsTotal} плит`,
      b.areaTotalM2 !== null && `${m2Fmt.format(Number(b.areaTotalM2))} м²`,
    ]
      .filter(Boolean)
      .join(" / ");
    return {
      id: b.id,
      label:
        `${b.stoneType.name} — ${formatTashkentDate(b.arrivedAt)}` +
        (qty ? ` (${qty})` : ""),
    };
  });

  // ТЗ №18 §6 — тот же порядок блоков, что на карте склада и в приёмке.
  const blocks = sortBlockOptions(
    gridBlocks.map((b) => ({
      letter: b.letter,
      landmarks: sortLandmarks(b.landmarks.map((l) => l.number)),
    })),
  );

  return (
    <main className="mx-auto max-w-xl p-4 pb-12">
      <PageHeader subtitle="AI распознал форму куска. Измерьте каждую сторону рулеткой и введите размеры в см — номера сторон совпадают с чертежом." />

      {/* W3-T2 — ошибки больше не редиректят на ?err= (введённое стиралось):
          форма клиентская, ошибки показываются на полях, значения остаются. */}
      <SinganForm
        d={first(sp.d) ?? ""}
        svg={svg}
        sideCount={draft.vertices.length}
        batches={batches}
        blocks={blocks}
      />
    </main>
  );
}
