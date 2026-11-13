// ТЗ №20 L (§13.2) — «Мои заявки» партнёра: свои заявки на объём и статус
// (Новая / Менеджер связался / Закрыта). Интересы (просмотры, скачивания)
// партнёру не показываются — это сигнал для менеджера.
// Только PARTNER (requestsRouteToManager); остальным — «Нет доступа».
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getCapabilities, getCurrentUser } from "@/lib/session";
import { loadMyLeads } from "@/lib/partners";
import { LEAD_STATUS_RU } from "@/lib/leads";
import { formatTashkentDate } from "@/lib/datetime";
import NoAccess from "@/components/NoAccess";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Мои заявки — Onyx" };

const STATUS_VARIANT = {
  NEW: "warning",
  CONTACTED: "neutral",
  CLOSED: "success",
} as const;

export default async function MyLeadsPage() {
  const [caps, me] = await Promise.all([getCapabilities(), getCurrentUser()]);
  if (!caps.requestsRouteToManager || !me) {
    return (
      <main className="mx-auto max-w-5xl p-4 pb-12 md:p-6 xl:p-8">
        <NoAccess />
      </main>
    );
  }
  const leads = await loadMyLeads(db, me.id);

  return (
    <main className="mx-auto max-w-5xl p-4 pb-12 md:p-6 xl:p-8">
      <header className="mb-6">
        <h1 className="text-display font-semibold text-ink">Мои заявки</h1>
        <p className="mt-1 text-sm text-ink-2">
          Заявки на объём, которые вы оставили в карточке камня. Менеджер свяжется с вами;
          статус меняется здесь.
        </p>
      </header>

      {leads.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-2">
            Заявок пока нет. Откройте камень в каталоге и нажмите «Заявка на объём».
          </p>
          <Link href="/katalog" className={buttonClass("secondary", "md", "mt-3")}>
            Открыть каталог
          </Link>
        </Card>
      ) : (
        <ul className="space-y-3">
          {leads.map((l) => (
            <li key={l.id}>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">
                      {l.stoneCode ? (
                        <Link href={`/k/${l.stoneCode}`} className="text-gold-deep hover:underline">
                          {l.stoneName ?? l.stoneCode}
                        </Link>
                      ) : (
                        (l.stoneName ?? "Камень не указан")
                      )}
                    </p>
                    <p className="text-sm text-ink-2">от {formatTashkentDate(l.createdAt)}</p>
                  </div>
                  <Badge variant={STATUS_VARIANT[l.status]}>{LEAD_STATUS_RU[l.status]}</Badge>
                </div>
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-ink-2">Объём</dt>
                  <dd className="tnum text-ink">{l.volume}</dd>
                  {l.siteText && (
                    <>
                      <dt className="text-ink-2">Объект</dt>
                      <dd className="text-ink">{l.siteText}</dd>
                    </>
                  )}
                  {l.due && (
                    <>
                      <dt className="text-ink-2">Срок</dt>
                      <dd className="tnum text-ink">{l.due}</dd>
                    </>
                  )}
                  {l.managerName && (
                    <>
                      <dt className="text-ink-2">Менеджер</dt>
                      <dd className="text-ink">{l.managerName}</dd>
                    </>
                  )}
                  {l.note && (
                    <>
                      <dt className="text-ink-2">Комментарий</dt>
                      <dd className="text-ink">{l.note}</dd>
                    </>
                  )}
                </dl>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
