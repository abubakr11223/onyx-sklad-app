// ТЗ №20 I (§10.3) — «Мои подборки»: подборки камней для клиентов.
//
// Гейт: canManageCollections (OWNER / MANAGER), остальные → <NoAccess/>.
// Скоуп (§15): владелец — все подборки, менеджер — свои. Новая подборка —
// здесь (пустая) или кнопкой «В подборку» на карточке / в каталоге.
import type { Metadata } from "next";
import Link from "next/link";
import Tabs from "@/components/ui/Tabs";
import EmptyState from "@/components/ui/EmptyState";
import { db } from "@/lib/db";
import { getCapabilities, currentActorId } from "@/lib/session";
import { clientListScope } from "@/lib/clients";
import { collectionPath, listCollections, COLLECTION_TITLE_MAX } from "@/lib/collections";
import { formatTashkentDate } from "@/lib/datetime";
import { createCollectionAction } from "./actions";
import { COLLECTION_ERROR_RU, COLLECTION_OK_RU } from "./messages";
import NoAccess from "@/components/NoAccess";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Alert from "@/components/ui/Alert";
import Button, { buttonClass } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Подборки — Onyx" };

export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string; status?: string }>;
}) {
  const caps = await getCapabilities();
  if (!caps.canManageCollections) {
    return (
      <main className="mx-auto max-w-6xl p-4 pb-12 md:p-6 xl:p-8">
        <NoAccess />
      </main>
    );
  }
  const sp = await searchParams;
  const actorId = await currentActorId();
  const onlyOpen = sp.status !== "all";
  const [rows, clients] = await Promise.all([
    listCollections(db, { caps, actorId, onlyOpen }),
    db.client.findMany({
      where: clientListScope({ canSeeAllClients: caps.canSeeAllClients, actorId }),
      orderBy: [{ name: "asc" }],
      take: 500,
      select: { id: true, name: true, phone: true },
    }),
  ]);

  return (
    <main className="mx-auto max-w-6xl p-4 pb-12 md:p-6 xl:p-8">
      <header className="mb-4">
        <h1 className="text-display font-semibold text-ink">
          {caps.canSeeAllCollections ? "Подборки" : "Мои подборки"}
        </h1>
        <p className="mt-1 text-sm text-ink-2">
          Подборка — ссылка для клиента с камнями: он ставит «Нравится» и оставляет заявку.
          Камни добавляются кнопкой «В подборку» в{" "}
          <Link href="/katalog" className="font-semibold text-gold-deep underline">
            каталоге
          </Link>{" "}
          и на карточке камня.
        </p>
      </header>

      {sp.ok && COLLECTION_OK_RU[sp.ok] && (
        <Alert variant="success" className="mb-4">
          {COLLECTION_OK_RU[sp.ok]}
        </Alert>
      )}
      {sp.err && (
        <Alert variant="danger" className="mb-4">
          {COLLECTION_ERROR_RU[sp.err] ?? "Не удалось выполнить действие."}
        </Alert>
      )}

      <Card className="mb-4">
        <h2 className="text-base font-semibold text-ink">Новая подборка</h2>
        <form action={createCollectionAction} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
            Название <span className="sr-only">(обязательно)</span>
            <input
              name="title"
              required
              maxLength={COLLECTION_TITLE_MAX}
              placeholder="Кухня для Азиза"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
            Клиент (необязательно)
            <select name="clientId" defaultValue="" className={inputClass}>
              <option value="">— без клиента —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.phone}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit">Создать подборку</Button>
        </form>
      </Card>

      <Tabs
        className="mb-3"
        items={[
          { href: "/podborki", label: "Открытые", active: onlyOpen },
          { href: "/podborki?status=all", label: "Все, включая закрытые", active: !onlyOpen },
        ]}
      />

      {rows.length === 0 ? (
        <EmptyState title="Подборок пока нет.">
          Создайте первую выше или нажмите «В подборку» в каталоге.
        </EmptyState>
      ) : (
        <div className="onyx-table-wrap">
          <table className="onyx-table">
            <thead>
              <tr>
                <th className="py-2 pl-3 font-medium">Подборка</th>
                <th className="py-2 pl-3 font-medium">Клиент</th>
                {caps.canSeeAllCollections && <th className="py-2 pl-3 font-medium">Менеджер</th>}
                <th className="py-2 pl-3 text-right font-medium">Камней</th>
                <th className="py-2 pl-3 text-right font-medium">Нравится</th>
                <th className="py-2 pl-3 font-medium">Создана</th>
                <th className="py-2 px-3 font-medium">Ссылка</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="py-2 pl-3">
                    <Link href={`/podborki/${r.id}`} className="font-semibold text-ink underline decoration-gold/50 hover:text-gold-deep">
                      {r.title}
                    </Link>
                    {r.closedAt && (
                      <Badge className="ml-2" variant="neutral">
                        закрыта
                      </Badge>
                    )}
                  </td>
                  <td className="py-2 pl-3 text-ink-2">
                    {r.clientId ? (
                      <Link href={`/klienty/${r.clientId}`} className="underline">
                        {r.clientName}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  {caps.canSeeAllCollections && <td className="py-2 pl-3 text-ink-2">{r.managerName}</td>}
                  <td className="tnum py-2 pl-3 text-right">{r.items}</td>
                  <td className="tnum py-2 pl-3 text-right">{r.likes}</td>
                  <td className="tnum py-2 pl-3 text-ink-2">{formatTashkentDate(r.createdAt)}</td>
                  <td className="py-2 px-3">
                    <Link href={collectionPath(r.code)} className={buttonClass("ghost", "sm")}>
                      Открыть
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
