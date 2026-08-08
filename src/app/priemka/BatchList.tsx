// ТЗ №14 §3 — «Ранее принятые партии» на /priemka (server component list).
// Поиск по виду / поставщику / дате; «Редактировать» → /priemka/edit/[id].

import Link from "next/link";
import { formatTashkentDate } from "@/lib/datetime";
import { formatGabarit } from "@/lib/dimensions";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button, { buttonClass } from "@/components/ui/Button";
import Field from "@/components/ui/Field";

export type BatchListItem = {
  id: string;
  stoneName: string;
  arrivedAt: Date;
  slabsTotal: number | null;
  areaTotalM2: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  thicknessMm: number | null;
  supplierNote: string | null;
  patternCount: number;
};

const m2Fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

export default function BatchList({
  batches,
  q,
}: {
  batches: BatchListItem[];
  q: string;
}) {
  return (
    <Card className="mt-10">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">
            Ранее принятые партии
          </h2>
          <p className="mt-1 text-sm text-ink/60">
            Исправить количество, размеры, узоры или локацию после приёмки.
          </p>
        </div>
        <Badge variant="neutral">{batches.length} в списке</Badge>
      </div>

      <form method="get" action="/priemka" className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <Field
            id="q"
            name="q"
            label="Поиск"
            defaultValue={q}
            placeholder="вид, поставщик, дата…"
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="secondary">
            Найти
          </Button>
          {q ? (
            <Link href="/priemka" className={buttonClass("ghost", "md")}>
              Сброс
            </Link>
          ) : null}
        </div>
      </form>

      {batches.length === 0 ? (
        <p className="text-sm text-ink/55">
          {q
            ? "Ничего не найдено — измените запрос."
            : "Пока нет принятых партий."}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {batches.map((b) => {
            const qty = [
              b.slabsTotal !== null && `${b.slabsTotal} плит`,
              b.areaTotalM2 !== null &&
                `${m2Fmt.format(b.areaTotalM2)} м²`,
            ]
              .filter(Boolean)
              .join(" / ");
            const gab = formatGabarit(b.lengthMm, b.widthMm, b.thicknessMm);
            return (
              <li
                key={b.id}
                className="flex flex-col gap-2 rounded-card border border-ink/10 bg-paper p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{b.stoneName}</p>
                  <p className="mt-0.5 text-sm text-ink/65">
                    {formatTashkentDate(b.arrivedAt)}
                    {qty ? ` · ${qty}` : ""}
                    {gab !== "—" ? ` · ${gab}` : ""}
                    {b.patternCount > 0
                      ? ` · узоров: ${b.patternCount}`
                      : ""}
                  </p>
                  {b.supplierNote && (
                    <p className="mt-0.5 truncate text-xs text-ink/50">
                      {b.supplierNote}
                    </p>
                  )}
                </div>
                <Link
                  href={`/priemka/edit/${b.id}`}
                  className={buttonClass("secondary", "sm")}
                >
                  Редактировать
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
