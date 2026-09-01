// ТЗ №15 §8.3 — накладная отгрузки: простой документ к товару.
// «что, сколько, кому, дата» + кто выдал. Страница печатается как есть
// (Ctrl/⌘+P): при печати прячем навигацию и кнопки, остаётся только бумага.
//
// Область видимости — та же, что у списка отгрузок: менеджер видит только свои.
// Иначе ссылка стала бы обходом области, ведь id отгрузки виден в URL.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getCapabilities, currentActorId } from "@/lib/session";
import { formatTashkentDate, formatTashkentDateTime } from "@/lib/datetime";
import { loadShipmentDocument } from "@/lib/shipments";
import NoAccess from "@/components/NoAccess";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Накладная — Onyx" };

export default async function ShipmentDocPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const caps = await getCapabilities();
  if (!caps.canSeeShipments) {
    return (
      <main className="mx-auto max-w-3xl p-4 pb-12 sm:p-8">
        <NoAccess />
      </main>
    );
  }

  const { id } = await params;
  const actorId = await currentActorId();
  const canSeeAll = caps.canConfirmShipment || caps.canSeeAllClients;

  const doc = await loadShipmentDocument(db, {
    shipmentId: id,
    canSeeAll,
    actorId,
  });
  if (!doc) notFound();

  return (
    <main className="mx-auto max-w-3xl p-4 pb-12 sm:p-8">
      {/* Экранная шапка — при печати скрыта. */}
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <Link href="/otgruzki" className="text-sm text-ink/60 underline">
          ← К отгрузкам
        </Link>
        <span className="text-sm text-ink/60">
          Печать: Ctrl/⌘ + P
        </span>
      </div>

      <article className="rounded-card border border-line bg-paper p-5 text-ink print:border-0 print:p-0">
        <header className="mb-4 border-b border-line pb-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h1 className="text-xl font-bold">
              Накладная № {doc.number}
            </h1>
            <p className="text-sm text-ink/60">
              от {formatTashkentDate(doc.createdAt)}
            </p>
          </div>
          <p className="mt-1 text-sm text-ink/70">
            Onyx · склад — {doc.kindLabel}
            {doc.kind === "SAMPLE" && doc.returnDueDate && (
              <> · вернуть до {formatTashkentDate(doc.returnDueDate)}</>
            )}
          </p>
        </header>

        <dl className="mb-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-ink/55">Кому</dt>
            <dd className="font-medium">{doc.clientName ?? "—"}</dd>
          </div>
          {doc.siteName && (
            <div>
              <dt className="text-ink/55">Объект</dt>
              <dd className="font-medium">{doc.siteName}</dd>
            </div>
          )}
          <div>
            <dt className="text-ink/55">Оформил</dt>
            <dd className="font-medium">{doc.managerName}</dd>
          </div>
          <div>
            <dt className="text-ink/55">Выдал со склада</dt>
            <dd className="font-medium">
              {doc.issuedByName ?? "— ещё не выдано —"}
              {doc.issuedAt && (
                <span className="ml-1 font-normal text-ink/55">
                  ({formatTashkentDateTime(doc.issuedAt)})
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-ink/55">Статус</dt>
            <dd className="font-medium">{doc.statusLabel}</dd>
          </div>
        </dl>

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-y border-line text-left text-ink/60">
              <th className="py-2 pr-2 font-medium">Камень</th>
              <th className="py-2 pr-2 font-medium">Что</th>
              <th className="py-2 pr-2 font-medium">Размер, см</th>
              <th className="py-2 pr-2 font-medium">Заказано</th>
              <th className="py-2 font-medium">Отгружено</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l, i) => (
              <tr key={i} className="border-b border-line/60 align-top">
                <td className="py-2 pr-2 font-medium">{l.stoneName}</td>
                <td className="py-2 pr-2">
                  {l.what}
                  {l.locationSnapshot && (
                    <span className="block text-xs text-ink/50">
                      {l.locationSnapshot}
                    </span>
                  )}
                </td>
                <td className="tnum py-2 pr-2">{l.gabarit ?? "—"}</td>
                <td className="tnum py-2 pr-2">{l.qtyOrdered ?? "—"}</td>
                <td className="tnum py-2">{l.qtyShipped ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {doc.note && (
          <p className="mt-3 text-sm text-ink/70">
            <span className="text-ink/50">Комментарий:</span> {doc.note}
          </p>
        )}

        {/* Подписи — бумажная часть; ТЗ §8.4 (электронная подпись/QR) на будущее. */}
        <div className="mt-8 grid gap-6 text-sm sm:grid-cols-2">
          <div>
            <p className="mb-6 text-ink/55">Выдал (склад)</p>
            <div className="border-t border-ink/40 pt-1 text-xs text-ink/50">
              подпись / ФИО
            </div>
          </div>
          <div>
            <p className="mb-6 text-ink/55">Получил</p>
            <div className="border-t border-ink/40 pt-1 text-xs text-ink/50">
              подпись / ФИО
            </div>
          </div>
        </div>
      </article>
    </main>
  );
}
