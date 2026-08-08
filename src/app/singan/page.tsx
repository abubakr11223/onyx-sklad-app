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
import { submitSingan } from "./actions";
import { BREAK_CAUSES } from "@/lib/breaking";
import Button, { buttonClass } from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field, { inputClass } from "@/components/ui/Field";
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
  const stoneId = first(sp.stone);
  const causeLabel = first(sp.cause);
  const err = first(sp.err);

  // ── Muvaffaqiyat holati: forma o'rniga yakuniy panel ──
  if (ok) {
    return (
      <main className="mx-auto max-w-xl p-4 pb-12">
        <PageHeader />
        <Alert variant="success" title="Кусок записан">
          <p className="text-ink/70">Чертёж и фото сохранены в карточке камня.</p>
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
  // shuning uchun dangerouslySetInnerHTML bu yerda xavfsiz.
  const svg = renderChertyoj(draft.vertices);
  const sideNumbers = draft.vertices.map((_, i) => i + 1);

  const batchRows = await db.batch.findMany({
    orderBy: [{ stoneType: { name: "asc" } }, { arrivedAt: "desc" }],
    select: {
      id: true,
      arrivedAt: true,
      slabsTotal: true,
      areaTotalM2: true,
      stoneType: { select: { name: true } },
    },
  });

  return (
    <main className="mx-auto max-w-xl p-4 pb-12">
      <PageHeader subtitle="AI распознал форму куска. Измерьте каждую сторону рулеткой и введите размеры в см — номера сторон совпадают с чертежом." />

      {err && (
        <Alert variant="danger" className="mb-6">
          {err}
        </Alert>
      )}

      <div className="mb-6 flex justify-center rounded-card border border-ink/10 bg-paper-2/60 p-4">
        {/* SVG — bizning renderChertyoj mahsuloti (validatsiya + ekranlash).
            Ko'rsatish usuli O'ZGARMADI: inline-SVG dangerouslySetInnerHTML orqali. */}
        <div dangerouslySetInnerHTML={{ __html: svg }} />
      </div>

      <form action={submitSingan} className="flex flex-col gap-6">
        <input type="hidden" name="d" value={first(sp.d) ?? ""} />

        {/* ── Стороны ── */}
        <Card>
          <h2 className="mb-3 text-lg font-semibold text-ink">
            Стороны, см ({draft.vertices.length})
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {sideNumbers.map((n) => (
              <Field
                key={n}
                id={`side_${n}`}
                name={`side_${n}`}
                inputMode="numeric"
                label={`Сторона ${n}`}
                placeholder="напр. 118"
                required
              />
            ))}
          </div>
        </Card>

        {/* ── Габариты и площадь ── */}
        <Card>
          <h2 className="mb-3 text-lg font-semibold text-ink">Габариты и площадь</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field
              id="boundingLengthMm"
              name="boundingLengthMm"
              inputMode="numeric"
              label="Длина, см"
              required
            />
            <Field
              id="boundingWidthMm"
              name="boundingWidthMm"
              inputMode="numeric"
              label="Ширина, см"
              required
            />
            <Field
              id="thicknessMm"
              name="thicknessMm"
              inputMode="numeric"
              label="Толщина, см"
              placeholder="необязательно"
            />
            <Field
              id="areaM2"
              name="areaM2"
              inputMode="decimal"
              label="Площадь, м²"
              placeholder="необязательно"
            />
          </div>
        </Card>

        {/* ── Партия и место ── */}
        <Card>
          <h2 className="mb-3 text-lg font-semibold text-ink">Партия и место</h2>
          <div className="flex flex-col gap-4">
            <Field id="kind" label="Тип">
              <select
                id="kind"
                name="kind"
                defaultValue="BROKEN"
                className={inputClass}
              >
                <option value="BROKEN">Бой</option>
                <option value="OFFCUT">Остаток</option>
              </select>
            </Field>
            <Field id="batchId" label="Партия (камень)">
              <select id="batchId" name="batchId" required className={inputClass}>
                <option value="">— выберите партию —</option>
                {batchRows.map((b) => {
                  const qty = [
                    b.slabsTotal !== null && `${b.slabsTotal} плит`,
                    b.areaTotalM2 !== null &&
                      `${m2Fmt.format(Number(b.areaTotalM2))} м²`,
                  ]
                    .filter(Boolean)
                    .join(" / ");
                  return (
                    <option key={b.id} value={b.id}>
                      {b.stoneType.name} — {formatTashkentDate(b.arrivedAt)}
                      {qty && ` (${qty})`}
                    </option>
                  );
                })}
              </select>
            </Field>
            <p className="rounded-field border border-ink/10 bg-paper-2 px-3 py-2 text-sm text-ink/70">
              Кусок списывает <strong>1 плиту</strong> из свободного остатка
              партии (учёт §3).
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field
                id="block"
                name="block"
                label="Блок"
                placeholder="напр. А"
                required
              />
              <Field
                id="landmark"
                name="landmark"
                label="Ориентир"
                placeholder="напр. 2"
                required
              />
            </div>
            {/* TZ §5.6 — same cause list as /razbit (both paths → AuditLog). */}
            <Field id="breakCause" label="Причина">
              <select
                id="breakCause"
                name="breakCause"
                required
                defaultValue=""
                className={inputClass}
              >
                <option value="" disabled>
                  — выберите —
                </option>
                {BREAK_CAUSES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.labelRu}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              id="breakCauseNote"
              name="breakCauseNote"
              label="Пояснение (если «Другое»)"
              placeholder="необязательно, до 80 символов"
            />
          </div>
        </Card>

        {/* Липкая нижняя панель отправки — CTA под большим пальцем на мобиле;
            на десктопе (md:) возвращается в обычный поток. Реальный submit
            серверного экшена (без JS) сохраняется. */}
        <div
          className="sticky bottom-0 z-10 -mx-4 border-t border-ink/10 bg-paper/90 px-4 py-3 backdrop-blur
                     md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:py-0 md:backdrop-blur-none"
        >
          <Button type="submit" className="min-h-14 w-full text-lg font-bold">
            Сохранить
          </Button>
        </div>
      </form>
    </main>
  );
}
