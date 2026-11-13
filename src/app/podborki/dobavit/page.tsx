// ТЗ №20 I (§10.3) — «В подборку»: камень (по коду ONX-…) → своя открытая
// подборка или новая (название, клиент из справочника — необязательно) +
// комментарий к камню. Сюда ведут кнопки «В подборку» на карточке /k
// (вид сотрудника) и в каталоге. Гейт: canManageCollections.
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getCapabilities, currentActorId } from "@/lib/session";
import { findByCode, STONE_CODE_KIND_RU } from "@/lib/stone-code";
import { clientListScope } from "@/lib/clients";
import {
  COLLECTION_COMMENT_MAX,
  COLLECTION_TITLE_MAX,
  listCollections,
} from "@/lib/collections";
import { addToCollectionAction } from "../actions";
import { COLLECTION_ERROR_RU } from "../messages";
import NoAccess from "@/components/NoAccess";
import Card from "@/components/ui/Card";
import Alert from "@/components/ui/Alert";
import Button, { buttonClass } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "В подборку — Onyx" };

export default async function AddToCollectionPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; err?: string }>;
}) {
  const caps = await getCapabilities();
  if (!caps.canManageCollections) {
    return (
      <main className="mx-auto max-w-[760px] p-4 pb-12 md:p-6 xl:p-8">
        <NoAccess />
      </main>
    );
  }
  const [sp, actorId] = await Promise.all([searchParams, currentActorId()]);
  const hit = await findByCode(db, sp.code ?? "");
  if (!hit) {
    return (
      <main className="mx-auto max-w-[760px] p-4 pb-12 md:p-6 xl:p-8">
        <Alert variant="danger">Камень с таким кодом не найден.</Alert>
        <Link href="/katalog" className={buttonClass("secondary", "md", "mt-4")}>
          Открыть каталог
        </Link>
      </main>
    );
  }
  const [stone, open, clients] = await Promise.all([
    db.stoneType.findUnique({
      where: { id: hit.stoneTypeId },
      select: { name: true, rockType: true, color: true },
    }),
    listCollections(db, { caps, actorId, onlyOpen: true, take: 50 }),
    db.client.findMany({
      where: clientListScope({ canSeeAllClients: caps.canSeeAllClients, actorId }),
      orderBy: [{ name: "asc" }],
      take: 500,
      select: { id: true, name: true, phone: true },
    }),
  ]);
  const kind = hit.kind !== "STONE_TYPE" ? STONE_CODE_KIND_RU[hit.kind] : null;

  return (
    <main className="mx-auto max-w-[760px] p-4 pb-12 md:p-6 xl:p-8">
      <header className="mb-4">
        <p className="text-xs font-medium text-ink-2">
          В подборку
        </p>
        <h1 className="mt-1 text-display font-semibold text-ink">
          {stone?.name ?? "Камень"}
        </h1>
        <p className="mt-1 text-sm text-ink-2">
          {[kind, stone?.rockType, stone?.color].filter(Boolean).join(" · ")} ·{" "}
          <span className="tnum tracking-wide">{hit.code}</span> ·{" "}
          <Link href={`/k/${hit.code}`} className="text-gold-deep underline">
            карточка
          </Link>
        </p>
      </header>

      {sp.err && (
        <Alert variant="danger" className="mb-4">
          {COLLECTION_ERROR_RU[sp.err] ?? "Не удалось добавить камень."}
        </Alert>
      )}

      <form action={addToCollectionAction} className="flex flex-col gap-4">
        <input type="hidden" name="code" value={hit.code} />
        <Card>
          <fieldset>
            <legend className="text-base font-semibold text-ink">Подборка</legend>
            <div className="mt-3 flex flex-col gap-2">
              {open.map((c, i) => (
                <label
                  key={c.id}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-field border border-line bg-paper px-3 py-2 text-sm has-[:checked]:border-gold"
                >
                  <input
                    type="radio"
                    name="collectionId"
                    value={c.id}
                    defaultChecked={i === 0}
                    className="h-5 w-5 accent-[var(--color-gold)]"
                  />
                  <span>
                    <span className="font-semibold text-ink">{c.title}</span>
                    <span className="block text-ink-2">
                      {[c.clientName, `камней: ${c.items}`].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </label>
              ))}
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-field border border-line bg-paper px-3 py-2 text-sm has-[:checked]:border-gold">
                <input
                  type="radio"
                  name="collectionId"
                  value="__new__"
                  defaultChecked={open.length === 0}
                  className="h-5 w-5 accent-[var(--color-gold)]"
                />
                <span className="font-semibold text-ink">Новая подборка</span>
              </label>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
                Название новой подборки
                <input
                  name="title"
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
            </div>
            <p className="mt-1 text-sm text-ink-2">
              Название и клиент нужны только для новой подборки.
            </p>
          </fieldset>
        </Card>
        <Card>
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
            Комментарий к камню (клиент увидит)
            <textarea
              name="comment"
              rows={3}
              maxLength={COLLECTION_COMMENT_MAX}
              placeholder="Подойдёт на столешницу: плита 280 × 160, тёплый тон"
              className={inputClass + " py-2"}
            />
          </label>
        </Card>
        <Button type="submit" className="w-full sm:w-auto">
          Добавить в подборку
        </Button>
      </form>
    </main>
  );
}
