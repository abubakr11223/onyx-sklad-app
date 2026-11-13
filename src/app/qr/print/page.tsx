// ТЗ №20 G (§8.3) — печать QR-этикеток.
//
// /qr/print?codes=ONX-..,ONX-..&format=label|a4  (или повторяющийся ?code=)
//   • label — одна этикетка 60×40 мм на страницу (термопринтер);
//   • a4    — лист A4 на 12 этикеток (3 × 4).
// Печать — через браузер (⌘/Ctrl+P или кнопка «Печать»): при печати прячем
// навигацию и панель управления, на бумаге остаются только этикетки.
// QR — inline-SVG с сервера (lib/qr.ts), без внешних сервисов.
//
// Доступ (§15): весь персонал — canPrintQr. Партнёр — нет.
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getCapabilities } from "@/lib/session";
import {
  QR_A4_PER_SHEET,
  loadQrLabels,
  parseQrPrintParams,
  publicBaseUrl,
  qrPrintHref,
  qrSvg,
  stoneCodeUrl,
  type QrLabel,
} from "@/lib/qr";
import { buttonClass } from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import NoAccess from "@/components/NoAccess";
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Печать QR — Onyx" };

const LOGO_SRC = "/logo/onyx-sphere.jpg";

// Бумага всегда белая, текст чёрный — это не экранная тема, а этикетка.
// Размеры в мм: QR не меньше 30 мм (§8.3, «не меньше 3×3 см»).
const LABEL_CSS = `
.qr-sheet { display: flex; flex-wrap: wrap; gap: 4mm; }
.qr-label {
  box-sizing: border-box; background: #fff; color: #000;
  display: flex; overflow: hidden; break-inside: avoid;
  font-family: var(--font-sans), sans-serif;
}
.qr-label--single { width: 60mm; height: 40mm; padding: 2mm; gap: 2mm; align-items: center; }
.qr-label--single .qr-code { width: 32mm; height: 32mm; flex: none; }
.qr-label--single .qr-text { font-size: 2.3mm; }
.qr-label--a4 { width: 64mm; height: 68mm; padding: 3mm; flex-direction: column; align-items: center; gap: 1.5mm; }
.qr-label--a4 .qr-code { width: 36mm; height: 36mm; flex: none; }
.qr-label--a4 .qr-text { font-size: 2.8mm; text-align: center; align-items: center; }
.qr-code svg { width: 100%; height: 100%; display: block; }
.qr-text { display: flex; flex-direction: column; gap: 0.4mm; min-width: 0; line-height: 1.15; }
.qr-name { font-weight: 700; font-size: 1.15em; overflow-wrap: anywhere; }
.qr-muted { opacity: 0.8; overflow-wrap: anywhere; }
.qr-codeline { font-weight: 700; letter-spacing: 0.04em; font-variant-numeric: tabular-nums; margin-top: 0.6mm; }
.qr-brand { display: flex; align-items: center; gap: 1mm; font-weight: 700; letter-spacing: 0.12em; font-size: 0.9em; }
.qr-brand img { width: 4.5mm; height: 4.5mm; border-radius: 50%; }
@media screen {
  .qr-label { border: 1px dashed var(--color-line); border-radius: 2mm; }
}
@media print {
  body > aside, body > nav { display: none !important; }
  body > div { padding: 0 !important; min-height: 0 !important; }
  .qr-sheet { gap: 0; }
}
`;

const PRINT_LABEL_CSS = `@media print {
  @page { size: 60mm 40mm; margin: 0; }
  .qr-label--single { break-after: page; page-break-after: always; }
}`;
const PRINT_A4_CSS = `@media print {
  @page { size: A4; margin: 8mm; }
  .qr-sheet { display: grid; grid-template-columns: repeat(3, 64mm); grid-auto-rows: 68mm; gap: 1mm 1mm; }
  .qr-page-break { break-after: page; page-break-after: always; }
}`;

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function QrPrintPage({ searchParams }: Props) {
  const caps = await getCapabilities();
  if (!caps.canPrintQr) {
    return (
      <main className="mx-auto max-w-5xl p-4 pb-12 sm:p-8">
        <NoAccess />
      </main>
    );
  }

  const params = parseQrPrintParams(await searchParams);
  const labels = await loadQrLabels(db, params.codes);
  const base = publicBaseUrl();
  const svgs = await Promise.all(labels.map((l) => qrSvg(stoneCodeUrl(l.code, base))));
  const missing = params.codes.length - labels.length;
  const single = params.format === "label";

  // A4: по 12 на лист — каждый лист отдельной сеткой, чтобы разрыв страницы
  // приходился ровно между листами.
  const sheets: number[][] = [];
  if (!single) {
    for (let i = 0; i < labels.length; i += QR_A4_PER_SHEET) {
      sheets.push(
        labels.slice(i, i + QR_A4_PER_SHEET).map((_, j) => i + j),
      );
    }
  }

  return (
    <main className="mx-auto max-w-5xl p-4 pb-12 sm:p-8 print:m-0 print:max-w-none print:p-0">
      <style>{LABEL_CSS + (single ? PRINT_LABEL_CSS : PRINT_A4_CSS)}</style>

      <div className="mb-6 print:hidden">
        <p className="text-xs font-medium text-ink-2">
          QR-этикетки
        </p>
        <h1 className="mt-1 text-display font-semibold text-ink">
          Печать QR
        </h1>
        <p className="mt-2 text-sm text-ink-2">
          {labels.length > 0
            ? `Этикеток: ${labels.length}. QR открывает карточку камня.`
            : "Нет этикеток для печати."}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <PrintButton />
          <Link
            href={qrPrintHref(params.codes, "label")}
            aria-current={single ? "page" : undefined}
            className={buttonClass(single ? "secondary" : "ghost", "sm", single ? "border-gold text-gold-deep" : "")}
          >
            Этикетка 60×40 мм
          </Link>
          <Link
            href={qrPrintHref(params.codes, "a4")}
            aria-current={!single ? "page" : undefined}
            className={buttonClass(!single ? "secondary" : "ghost", "sm", !single ? "border-gold text-gold-deep" : "")}
          >
            Лист A4 · 12 шт.
          </Link>
        </div>

        {(missing > 0 || params.invalid > 0 || params.truncated > 0) && (
          <div className="mt-4">
            <Alert variant="warning">
              {[
                missing > 0 ? `Не найдено кодов: ${missing}.` : null,
                params.invalid > 0 ? `Не похожи на код ONX: ${params.invalid}.` : null,
                params.truncated > 0
                  ? `Сверх лимита отброшено: ${params.truncated} — напечатайте их отдельно.`
                  : null,
              ]
                .filter(Boolean)
                .join(" ")}
            </Alert>
          </div>
        )}
        {params.codes.length === 0 && (
          <p className="mt-4 text-sm text-ink-2">
            Откройте печать кнопкой «QR» в карточке камня, в «Шоу-руме» или
            отметьте камни в «Поиске».
          </p>
        )}
      </div>

      {single ? (
        <div className="qr-sheet">
          {labels.map((l, i) => (
            <QrLabelView key={l.code} label={l} svg={svgs[i]} variant="single" />
          ))}
        </div>
      ) : (
        sheets.map((idx, s) => (
          <div
            key={s}
            className={`qr-sheet ${s < sheets.length - 1 ? "qr-page-break mb-6 print:mb-0" : ""}`}
          >
            {idx.map((i) => (
              <QrLabelView key={labels[i].code} label={labels[i]} svg={svgs[i]} variant="a4" />
            ))}
          </div>
        ))
      )}
    </main>
  );
}

function QrLabelView({
  label,
  svg,
  variant,
}: {
  label: QrLabel;
  svg: string;
  variant: "single" | "a4";
}) {
  return (
    <section className={`qr-label qr-label--${variant}`} aria-label={`Этикетка ${label.code}`}>
      {/* SVG собран библиотекой qrcode из нашей же ссылки — не пользовательский HTML. */}
      <div className="qr-code" dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="qr-text">
        <span className="qr-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO_SRC} alt="" />
          ONYX
        </span>
        <span className="qr-name">{label.name}</span>
        {label.rockColor && <span className="qr-muted">{label.rockColor}</span>}
        {label.detail && <span className="qr-muted">{label.detail}</span>}
        {label.size && <span>{label.size}</span>}
        {label.thickness && <span>толщина {label.thickness}</span>}
        <span className="qr-codeline">{label.code}</span>
      </div>
    </section>
  );
}
