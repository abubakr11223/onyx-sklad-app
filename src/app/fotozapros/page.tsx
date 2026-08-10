// TG-B1 / W6-B / W9-A — «Запросы на фото» (TZ §5.3, §1.8, §3, §5.9, §7).
// Server component.
//  • Menejer/egasi (canRequestPhoto): barcha so'rovlar + «Готово» + kimga ketgani.
//  • Sklad (canViewPhotoTasks): o'z navbati. Foto — Telegram.
// W9-A: dispatch is a deliberate broadcast to every linked WAREHOUSE worker;
// page shows WHO received Telegram delivery and which workers are TG-connected.
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { sendMessage } from "@/lib/telegram";
import {
  isDemoWarehouseAccount,
  photoTasksListWhere,
  redispatchPendingPhotoRequests,
  telegramIdMatchesOwner,
} from "@/lib/photo-requests";
import { closePhotoRequest } from "./actions";
import { BULK_CLOSE_DEFAULT_DAYS } from "./bulk-close";
import BulkClosePanel from "./BulkClosePanel";
import { unlinkTelegram } from "@/app/accounts/actions";
import { getCapabilities, getCurrentUser } from "@/lib/session";
import NoAccess from "@/components/NoAccess";
import Card from "@/components/ui/Card";
import Badge, { type BadgeVariant } from "@/components/ui/Badge";
import Alert from "@/components/ui/Alert";
import Button from "@/components/ui/Button";
import { CameraIcon } from "@/components/ui/Icons";
import { formatTashkentDateTime } from "@/lib/datetime";

export const metadata: Metadata = {
  title: "Запросы на фото — Onyx",
};

export const dynamic = "force-dynamic";

const STATUS_RU: Record<string, string> = {
  PENDING: "ожидает",
  DONE: "готово",
  CANCELLED: "отменён",
};

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  PENDING: "warning",
  DONE: "success",
  CANCELLED: "neutral",
};

// BUG-04 — доставка в Telegram (по записям PhotoDispatch). SENT есть → доставлено;
// иначе если есть FAILED → ошибка; ничего → ещё не отправлено (ждёт re-dispatch).
type DeliveryState = "delivered" | "failed" | "waiting";

function deliveryOf(
  dispatches: { status: string }[],
): DeliveryState {
  if (dispatches.some((d) => d.status === "SENT")) return "delivered";
  if (dispatches.some((d) => d.status === "FAILED")) return "failed";
  return "waiting";
}

const DELIVERY_RU: Record<DeliveryState, string> = {
  delivered: "доставлено",
  failed: "ошибка доставки",
  waiting: "не доставлено",
};

const DELIVERY_VARIANT: Record<DeliveryState, BadgeVariant> = {
  delivered: "success",
  failed: "danger",
  waiting: "neutral",
};

function first(
  v: string | string[] | undefined,
): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Граница «старее N дней» для массового закрытия фотозапросов.
 * Async намеренно: часы читаются в момент выборки, а не в теле рендера
 * (см. комментарий на месте вызова).
 */
async function bulkCloseCutoff(): Promise<Date> {
  return new Date(Date.now() - BULK_CLOSE_DEFAULT_DAYS * 24 * 60 * 60 * 1000);
}

export default async function FotozaprosPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  // READ: canViewPhotoTasks (OWNER/MANAGER/WAREHOUSE). CREATE/close: canRequestPhoto.
  const [caps, actor] = await Promise.all([
    getCapabilities(),
    getCurrentUser(),
  ]);
  if (!caps.canViewPhotoTasks) {
    return (
      <main className="mx-auto max-w-3xl p-4 sm:p-8">
        <NoAccess />
      </main>
    );
  }

  const canManageRequests = caps.canRequestPhoto;
  const isOwner = actor?.role === "OWNER";
  const listWhere = photoTasksListWhere({
    canRequestPhoto: canManageRequests,
    actorId: actor?.id ?? null,
  });

  const spRaw = searchParams ? await searchParams : {};
  const sp = {
    tgUnlink: first(spRaw.tgUnlink),
    tgErr: first(spRaw.tgErr),
    closed: first(spRaw.closed),
    closeErr: first(spRaw.closeErr),
    n: first(spRaw.n),
    scope: first(spRaw.scope),
  };

  // BUG-04 — lazy sweep: faqat menejer/egasi sahifasida (dispatch nazorati).
  // W11-A: redispatch also skips demo warehouse chats.
  // Must finish before reading requests/dispatches (sweep mutates dispatch rows).
  if (canManageRequests) {
    try {
      await redispatchPendingPhotoRequests({ db, sendMessage });
    } catch (e) {
      console.warn(
        "[fotozapros] re-dispatch sweep xatosi (sahifa ochilaveradi):",
        e,
      );
    }
  }

  // Часы читаем ВНУТРИ запроса, а не в теле рендера: это async Server Component,
  // но правило react-hooks/purity (справедливо для клиентских компонентов) видит
  // здесь нечистый вызов. Вынос в await-функцию убирает и предупреждение, и сам
  // повод для него — «сейчас» фиксируется в момент выборки, а не выше по коду.
  const olderCutoff = await bulkCloseCutoff();

  // After sweep: warehouse panel + request list + bulk counts are independent —
  // parallelize (region RTT multiplies sequential cost).
  const [warehouseUsers, ownerTelegramRows, requests, pendingAll, pendingOlder] =
    await Promise.all([
      canManageRequests
        ? db.user.findMany({
            where: { role: "WAREHOUSE" },
            orderBy: { name: "asc" },
            take: 100,
            select: {
              id: true,
              name: true,
              phone: true,
              telegramId: true,
              isActive: true,
            },
          })
        : Promise.resolve(
            [] as Array<{
              id: string;
              name: string;
              phone: string | null;
              telegramId: string | null;
              isActive: boolean;
            }>,
          ),
      canManageRequests
        ? db.user.findMany({
            where: { role: "OWNER", telegramId: { not: null } },
            select: { telegramId: true },
            take: 10,
          })
        : Promise.resolve([] as Array<{ telegramId: string | null }>),
      db.photoRequest.findMany({
        where: listWhere,
        orderBy: { createdAt: "desc" },
        take: 50,
        include: {
          batch: { include: { stoneType: true } },
          batchLocation: true,
          assignee: true,
          photos: { select: { id: true }, orderBy: { createdAt: "asc" } },
          dispatches: {
            select: {
              status: true,
              chatId: true,
              attempts: true,
              lastError: true,
            },
            orderBy: { createdAt: "asc" },
            take: 50,
          },
        },
      }),
      canManageRequests
        ? db.photoRequest.count({ where: { status: "PENDING" } })
        : Promise.resolve(0),
      canManageRequests
        ? db.photoRequest.count({
            where: { status: "PENDING", createdAt: { lt: olderCutoff } },
          })
        : Promise.resolve(0),
    ]);

  const ownerTelegramIds = ownerTelegramRows.map((u) => u.telegramId);

  const linkedWorkers = warehouseUsers.filter(
    (u) => u.isActive && u.telegramId,
  );
  const realLinked = linkedWorkers.filter((u) => !isDemoWarehouseAccount(u));
  const unlinkedActive = warehouseUsers.filter(
    (u) => u.isActive && !u.telegramId,
  );
  const demoLinked = linkedWorkers.filter((u) => isDemoWarehouseAccount(u));
  const ownerChatOnWarehouse = linkedWorkers.filter((u) =>
    telegramIdMatchesOwner(u.telegramId, ownerTelegramIds),
  );

  // Map telegram chatId → warehouse user for display names.
  const tgToWorker = new Map(
    warehouseUsers
      .filter((u) => u.telegramId)
      .map((u) => [u.telegramId as string, u]),
  );

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-8">
      <header className="mb-6">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.28em] text-gold-deep">
          <CameraIcon className="h-4 w-4" />
          Onyx · фото
        </p>
        <h1 className="mt-2 font-serif text-display font-bold tracking-tight text-ink">
          {canManageRequests ? "Запросы на фото" : "Задачи на фото"}
        </h1>
        <p className="mt-2 text-base text-ink/60">
          {canManageRequests
            ? "Задачи уходят всем активным складчикам с привязанным Telegram (общая очередь). Фото приходят в бот."
            : "Ваши открытые задачи. Сфотографируйте камень и отправьте фото в Telegram-бот — на сайте загрузка не нужна (§5.3)."}
        </p>
      </header>

      {sp.closed === "ok" && (
        <Alert variant="success" className="mb-4">
          Запрос закрыт.
        </Alert>
      )}
      {sp.closed === "bulk" && (
        <Alert variant="success" className="mb-4">
          Закрыто запросов:{" "}
          <strong className="tnum">{sp.n ?? "0"}</strong>
          {sp.scope === "older"
            ? ` (старше ${BULK_CLOSE_DEFAULT_DAYS} дн.)`
            : sp.scope === "all"
              ? " (все открытые)"
              : ""}
          . Статус «готово», записи не удалялись.
        </Alert>
      )}
      {sp.closeErr && (
        <Alert variant="danger" className="mb-4">
          {sp.closeErr}
        </Alert>
      )}

      {canManageRequests && pendingAll > 0 && (
        <BulkClosePanel
          pendingAll={pendingAll}
          pendingOlder={pendingOlder}
          defaultDays={BULK_CLOSE_DEFAULT_DAYS}
        />
      )}

      {canManageRequests && (
        <Card className="mb-6">
          <h2 className="text-base font-bold text-ink">
            Складчики и Telegram
          </h2>
          <p className="mt-1 text-sm text-ink/60">
            Фотозапрос уходит каждому <strong>активному реальному</strong>{" "}
            складчику с Telegram ID. Демо-аккаунты в рассылку{" "}
            <strong>не входят</strong> (W11-A) — даже если у них ваш личный ID.
          </p>
          {sp.tgUnlink === "ok" && (
            <Alert variant="success" className="mt-3">
              Telegram отвязан. Новые задачи этому чату не уйдут.
            </Alert>
          )}
          {sp.tgErr && (
            <Alert variant="danger" className="mt-3">
              Не удалось отвязать Telegram ({sp.tgErr}).
            </Alert>
          )}
          {realLinked.length === 0 ? (
            <Alert variant="danger" className="mt-3">
              Нет <strong>реальных</strong> складчиков с Telegram. Запросы{" "}
              <strong>никуда не доставляются</strong>
              {demoLinked.length > 0
                ? " (демо-аккаунт в списке есть, но рассылка на него отключена)"
                : ""}
              . Создайте складчика с телефоном в{" "}
              <Link href="/accounts" className="font-semibold underline">
                Сотрудники
              </Link>
              , пусть он /start в боте и поделится контактом.
            </Alert>
          ) : null}
          <ul className="mt-3 space-y-2">
            {warehouseUsers.map((u) => {
              const demo = isDemoWarehouseAccount(u);
              const linked = Boolean(u.telegramId);
              const isOwnerChat = telegramIdMatchesOwner(
                u.telegramId,
                ownerTelegramIds,
              );
              return (
                <li
                  key={u.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-field border border-ink/10 bg-ink/[0.02] px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <span className="font-medium text-ink">
                      {u.name}
                      {demo && (
                        <span className="ml-1.5 font-semibold text-warning">
                          · демо
                        </span>
                      )}
                      {!u.isActive && (
                        <span className="ml-1.5 text-ink/40">· неактивен</span>
                      )}
                    </span>
                    <p className="tnum text-ink/60">
                      {linked ? (
                        <>
                          TG: {u.telegramId}
                          {isOwnerChat && (
                            <span className="ml-1 font-semibold text-danger">
                              = ваш личный Telegram
                            </span>
                          )}
                          {demo && linked && (
                            <span className="ml-1 text-warning">
                              · не получает задачи
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-warning">Telegram не привязан</span>
                      )}
                    </p>
                  </div>
                  {isOwner && linked && u.isActive && (
                    <form action={unlinkTelegram}>
                      <input type="hidden" name="userId" value={u.id} />
                      <input type="hidden" name="next" value="/fotozapros" />
                      <Button type="submit" variant="danger" size="sm">
                        Отвязать
                      </Button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
          {(demoLinked.length > 0 || ownerChatOnWarehouse.length > 0) && (
            <Alert variant="danger" className="mt-3">
              {ownerChatOnWarehouse.length > 0 ? (
                <>
                  Складчик с <strong>вашим</strong> Telegram ID. Нажмите
                  «Отвязать» (владелец) или сделайте то же в «Сотрудники».
                </>
              ) : (
                <>
                  Демо-складчик с Telegram ID (часто личный чат владельца после
                  seed). Рассылка на демо отключена; отвяжите ID и привяжите
                  реального складчика.
                </>
              )}
            </Alert>
          )}
          {unlinkedActive.length > 0 && (
            <p className="mt-2 text-xs text-ink/50">
              Без Telegram ({unlinkedActive.length}):{" "}
              {unlinkedActive.map((u) => u.name).join(", ")} — им задачи не
              приходят. Нужен телефон в карточке + /start в боте.
            </p>
          )}
        </Card>
      )}

      {requests.length === 0 ? (
        <Alert variant="info">
          {canManageRequests
            ? "Пока нет запросов на фото."
            : "Нет открытых задач на фото."}
        </Alert>
      ) : (
        <ul className="space-y-3">
          {requests.map((r) => {
            const stoneName = r.batch.stoneType?.name ?? "камень";
            const loc = r.batchLocation
              ? `Блок ${r.batchLocation.block}, ориентир ${r.batchLocation.landmark}`
              : "локация не указана";
            const delivery = deliveryOf(r.dispatches);
            return (
              <li key={r.id}>
                <Card>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <h3 className="text-base font-bold text-ink">{stoneName}</h3>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {r.status === "PENDING" && canManageRequests && (
                        <Badge variant={DELIVERY_VARIANT[delivery]}>
                          {DELIVERY_RU[delivery]}
                        </Badge>
                      )}
                      <Badge variant={STATUS_VARIANT[r.status] ?? "neutral"}>
                        {STATUS_RU[r.status] ?? r.status}
                      </Badge>
                    </div>
                  </div>
                  <p className="mt-1 text-sm text-ink/70">{loc}</p>
                  {r.comment && (
                    <p className="mt-1 text-sm text-ink/70">
                      Комментарий: {r.comment}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-ink/50">
                    {formatTashkentDateTime(r.createdAt)}
                    {r.assignee ? ` · ${r.assignee.name}` : " · общая очередь"}
                  </p>

                  {/* W9-A: who was targeted in Telegram (by chatId → user). */}
                  {canManageRequests && r.dispatches.length > 0 && (
                    <div className="mt-2 rounded-field border border-ink/10 bg-paper px-3 py-2 text-sm">
                      <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">
                        Кому ушло в Telegram
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {r.dispatches.map((d) => {
                          const worker = tgToWorker.get(d.chatId);
                          const label = worker?.name ?? `TG ${d.chatId}`;
                          const demo = worker
                            ? isDemoWarehouseAccount(worker)
                            : false;
                          const st =
                            d.status === "SENT"
                              ? "доставлено"
                              : d.status === "FAILED"
                                ? "ошибка"
                                : d.status;
                          return (
                            <li key={`${r.id}-${d.chatId}`} className="text-ink/80">
                              <span className="font-medium">{label}</span>
                              {demo && (
                                <span className="text-warning"> · демо</span>
                              )}
                              <span className="text-ink/50">
                                {" "}
                                · {st}
                                {d.lastError ? ` (${d.lastError})` : ""}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                  {canManageRequests &&
                    r.status === "PENDING" &&
                    r.dispatches.length === 0 && (
                      <Alert variant="warning" className="mt-2">
                        Нет записей доставки — складчики с Telegram не найдены
                        или отправка не выполнялась.
                      </Alert>
                    )}

                  {r.photos.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {r.photos.map((photo) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={photo.id}
                          src={`/api/photo/${photo.id}`}
                          className="h-20 w-20 rounded-field border border-ink/10 object-cover"
                          alt="фото"
                          loading="lazy"
                        />
                      ))}
                    </div>
                  )}
                  {canManageRequests && r.status === "PENDING" && (
                    <form action={closePhotoRequest} className="mt-3">
                      <input type="hidden" name="id" value={r.id} />
                      <button
                        type="submit"
                        className="rounded-field border border-ink/15 bg-ink/[0.03] px-3 py-1.5 text-sm font-semibold text-ink transition hover:bg-ink/[0.06]"
                      >
                        Готово
                      </button>
                    </form>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
