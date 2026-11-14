// ТЗ №20 I (§10.3) — подборка глазами менеджера: камни, комментарии,
// отметки «Нравится» клиента, ссылка (скопировать / поделиться), закрыть.
// Гейт: canManageCollections; менеджер — только свои (иначе «не найдена»).
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getCapabilities, currentActorId } from "@/lib/session";
import { collectionPath, loadStaffCollection } from "@/lib/collections";
import { formatTashkentDate, formatTashkentDateTime } from "@/lib/datetime";
import { removeCollectionItemAction, setCollectionClosedAction } from "../actions";
import { COLLECTION_ERROR_RU, COLLECTION_OK_RU } from "../messages";
import NoAccess from "@/components/NoAccess";
import ShareButtons from "@/components/public/ShareButtons";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Alert from "@/components/ui/Alert";
import Button, { buttonClass } from "@/components/ui/Button";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Подборка — Onyx" };

export default async function CollectionStaffPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const caps = await getCapabilities();
  if (!caps.canManageCollections) {
    return (
      <main className="max-w-5xl p-4 pb-12 md:p-6 xl:p-8">
        <NoAccess />
      </main>
    );
  }
  const [{ id }, sp, actorId] = await Promise.all([params, searchParams, currentActorId()]);
  const c = await loadStaffCollection(db, { id, caps, actorId });
  if (!c) notFound();
  const path = collectionPath(c.code);
  const likes = c.items.filter((i) => i.likedAt).length;
  const open = !c.closedAt;

  return (
    <main className="max-w-5xl p-4 pb-12 md:p-6 xl:p-8">
      <p className="mb-2 text-sm">
        <Link href="/podborki" className="text-gold-deep underline">
          ← Все подборки
        </Link>
      </p>
      <header className="mb-4">
        <p className="text-xs font-medium text-ink-2">
          Подборка для клиента
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-display font-semibold text-ink">{c.title}</h1>
          <Badge variant={open ? "success" : "neutral"}>{open ? "открыта" : "закрыта"}</Badge>
        </div>
        <p className="mt-1 text-sm text-ink-2">
          {c.clientId ? (
            <>
              Клиент:{" "}
              <Link href={`/klienty/${c.clientId}`} className="font-semibold text-ink underline">
                {c.clientName}
              </Link>{" "}
              ·{" "}
            </>
          ) : null}
          Собрал(а): {c.managerName} · {formatTashkentDate(c.createdAt)}
          {c.closedAt && <> · закрыта {formatTashkentDate(c.closedAt)}</>}
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
        <h2 className="text-base font-semibold text-ink">Ссылка для клиента</h2>
        <p className="mt-1 text-sm text-ink-2">
          Бессрочная, без входа. Клиент видит камни без цен и остатков, ставит «Нравится» и
          оставляет заявку.{" "}
          <Link href={path} className="font-semibold text-gold-deep underline">
            Открыть как клиент
          </Link>
        </p>
        <p className="tnum mt-2 break-all text-sm font-semibold text-ink">{path}</p>
        <div className="mt-3">
          <ShareButtons
            path={path}
            title={c.title}
            t={{ copyLink: "Скопировать ссылку", linkCopied: "Ссылка скопирована", share: "Поделиться" }}
          />
        </div>
      </Card>

      <section className="mb-4">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-ink">
            Камни <span className="tnum">({c.items.length})</span>
          </h2>
          <p className="text-sm text-ink-2">
            Нравится клиенту: <span className="tnum font-semibold text-ink">{likes}</span>
          </p>
        </div>
        {c.items.length === 0 ? (
          <div className="rounded-card border border-line bg-marble p-6 text-center">
            <p className="text-sm text-ink-2">
              Камней пока нет.{" "}
              <Link href="/katalog" className="font-semibold text-gold-deep underline">
                Открыть каталог
              </Link>{" "}
              и нажать «В подборку».
            </p>
          </div>
        ) : (
          <div className="onyx-table-wrap">
            <table className="onyx-table">
              <thead>
                <tr>
                  <th className="py-2 pl-3 font-medium">Камень</th>
                  <th className="py-2 pl-3 font-medium">Код</th>
                  <th className="py-2 pl-3 font-medium">Комментарий</th>
                  <th className="py-2 pl-3 font-medium">Нравится</th>
                  {open && <th className="py-2 px-3 font-medium"><span className="sr-only">Действия</span></th>}
                </tr>
              </thead>
              <tbody>
                {c.items.map((i) => (
                  <tr key={i.id} className="align-top">
                    <td className="py-2 pl-3">
                      <Link href={`/k/${i.stoneCode}`} className="font-semibold text-ink underline decoration-gold/50">
                        {i.stoneName}
                      </Link>
                      <span className="block text-xs text-ink-2">
                        {[i.rockType, i.color].filter(Boolean).join(" · ")}
                      </span>
                    </td>
                    <td className="tnum py-2 pl-3 tracking-wide">{i.stoneCode}</td>
                    <td className="py-2 pl-3 text-ink-2">{i.comment ?? "—"}</td>
                    <td className="py-2 pl-3">
                      {i.likedAt ? (
                        <Badge variant="success">
                          да · <span className="tnum">{formatTashkentDateTime(i.likedAt)}</span>
                        </Badge>
                      ) : (
                        <span className="text-ink-2">—</span>
                      )}
                    </td>
                    {open && (
                      <td className="py-2 px-3">
                        <form action={removeCollectionItemAction}>
                          <input type="hidden" name="collectionId" value={c.id} />
                          <input type="hidden" name="itemId" value={i.id} />
                          <ConfirmSubmitButton
                            message={`Убрать «${i.stoneName}» из подборки?`}
                            variant="ghost"
                          >
                            Убрать
                          </ConfirmSubmitButton>
                        </form>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Card>
        <h2 className="text-base font-semibold text-ink">
          {open ? "Закрыть подборку" : "Подборка закрыта"}
        </h2>
        <p className="mt-1 text-sm text-ink-2">
          {open
            ? "Клиент по ссылке увидит «Подборка закрыта, свяжитесь с менеджером». Открыть снова можно в любой момент."
            : "Клиент видит «Подборка закрыта, свяжитесь с менеджером». Можно открыть снова — ссылка та же."}
        </p>
        <form action={setCollectionClosedAction} className="mt-3">
          <input type="hidden" name="collectionId" value={c.id} />
          <input type="hidden" name="closed" value={open ? "1" : "0"} />
          {open ? (
            <ConfirmSubmitButton message={`Закрыть подборку «${c.title}»?`} variant="danger" size="md">
              Закрыть подборку
            </ConfirmSubmitButton>
          ) : (
            <Button type="submit" variant="secondary">
              Открыть снова
            </Button>
          )}
        </form>
        {open && (
          <p className="mt-3 text-sm">
            <Link href="/katalog" className={buttonClass("ghost", "sm")}>
              Добавить камни из каталога
            </Link>
          </p>
        )}
      </Card>
    </main>
  );
}
