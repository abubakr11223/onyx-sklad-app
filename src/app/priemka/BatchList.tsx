// ТЗ №14 §3 — «Ранее принятые партии» на /priemka (server component list).
// Поиск по виду / поставщику / дате; «Редактировать» → /priemka/edit/[id].

import Link from "next/link";
import { formatTashkentDate } from "@/lib/datetime";
import { formatGabarit } from "@/lib/dimensions";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
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
    <Card className="mt-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">
            Ранее принятые партии
          </h2>
          <p className="mt-1 text-sm text-ink-2">
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
        <EmptyState
          bare
          title={q ? "Ничего не найдено — измените запрос." : "Пока нет принятых партий."}
        />
      ) : (
        <>
          {/* ≥768px — плотная таблица (ТЗ №20 §8); телефон — карточки (§9). */}
          <div className="onyx-table-wrap hidden md:block">
            <table className="onyx-table">
              <thead>
                <tr>
                  <th className="py-2 pl-3 pr-2">Камень</th>
                  <th className="py-2 pr-2">Дата</th>
                  <th className="py-2 pr-2 text-right">Количество</th>
                  <th className="py-2 pr-2">Габарит, см</th>
                  <th className="py-2 pr-2 text-right">Узоров</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => {
                  const qty = [
                    b.slabsTotal !== null && `${b.slabsTotal} плит`,
                    b.areaTotalM2 !== null && `${m2Fmt.format(b.areaTotalM2)} м²`,
                  ]
                    .filter(Boolean)
                    .join(" / ");
                  const gab = formatGabarit(b.lengthMm, b.widthMm, b.thicknessMm);
                  return (
                    <tr key={b.id} className="align-middle">
                      <td className="py-2 pl-3 pr-2">
                        <p className="font-medium text-ink">{b.stoneName}</p>
                        {b.supplierNote && (
                          <p className="max-w-xs truncate text-xs text-ink-2">{b.supplierNote}</p>
                        )}
                      </td>
                      <td className="py-2 pr-2 text-ink-2">{formatTashkentDate(b.arrivedAt)}</td>
                      <td className="py-2 pr-2 text-right">{qty || "—"}</td>
                      <td className="py-2 pr-2 font-mono">{gab}</td>
                      <td className="py-2 pr-2 text-right">{b.patternCount > 0 ? b.patternCount : "—"}</td>
                      <td className="py-2 pr-3 text-right">
                        <Link
                          href={`/priemka/edit/${b.id}`}
                          className="text-sm text-honey-ink hover:underline"
                        >
                          Редактировать
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        <ul className="flex flex-col gap-3 md:hidden">
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
                className="flex flex-col gap-2 rounded-card border border-line bg-marble p-3"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{b.stoneName}</p>
                  <p className="mt-0.5 text-sm text-ink-2">
                    {formatTashkentDate(b.arrivedAt)}
                    {qty ? ` · ${qty}` : ""}
                    {gab !== "—" ? <span className="font-mono">{` · ${gab}`}</span> : ""}
                    {b.patternCount > 0
                      ? ` · узоров: ${b.patternCount}`
                      : ""}
                  </p>
                  {b.supplierNote && (
                    <p className="mt-0.5 truncate text-xs text-ink-3">
                      {b.supplierNote}
                    </p>
                  )}
                </div>
                <Link
                  href={`/priemka/edit/${b.id}`}
                  className={buttonClass("secondary", "sm", "w-full")}
                >
                  Редактировать
                </Link>
              </li>
            );
          })}
        </ul>
        </>
      )}
    </Card>
  );
}
