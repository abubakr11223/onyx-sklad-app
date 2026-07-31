// TG-B1 / W6-B — «Запросы на фото» (TZ §5.3, §1.8, §3, §5.9, §7).
// Server component.
//  • Menejer/egasi (canRequestPhoto): barcha so'rovlar + «Готово» yopish.
//  • Sklad (canViewPhotoTasks, canRequestPhoto=false): o'z navbati/biriktirilgan
//    PENDING vazifalar (READ). Foto yuborish — Telegram (§5.3); CREATE yo'q.
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { sendMessage } from "@/lib/telegram";
import {
  photoTasksListWhere,
  redispatchPendingPhotoRequests,
} from "@/lib/photo-requests";
import { closePhotoRequest } from "./actions";
import { getCapabilities, getCurrentUser } from "@/lib/session";
import NoAccess from "@/components/NoAccess";
import Card from "@/components/ui/Card";
import Badge, { type BadgeVariant } from "@/components/ui/Badge";
import Alert from "@/components/ui/Alert";
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

export default async function FotozaprosPage() {
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
  const listWhere = photoTasksListWhere({
    canRequestPhoto: canManageRequests,
    actorId: actor?.id ?? null,
  });

  // BUG-04 — lazy sweep: faqat menejer/egasi sahifasida (dispatch nazorati).
  // Sklad faqat o'qiydi; sweep ular uchun majburiy emas.
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

  const requests = await db.photoRequest.findMany({
    where: listWhere,
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      batch: { include: { stoneType: true } },
      batchLocation: true,
      assignee: true,
      photos: { select: { id: true }, orderBy: { createdAt: "asc" } },
      // BUG-04: статус доставки в Telegram (per-складчик записи).
      dispatches: { select: { status: true } },
    },
  });

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
            ? "Задачи складчикам сфотографировать камень. Фото приходят в Telegram."
            : "Ваши открытые задачи. Сфотографируйте камень и отправьте фото в Telegram-бот — на сайте загрузка не нужна (§5.3)."}
        </p>
      </header>

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
            // BUG-04: статус доставки показываем только для активных (PENDING)
            // запросов — по завершённым/отменённым он уже не важен.
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
                  {/* §6.1 — «Готово» faqat menejer (canRequestPhoto). Sklad yopmaydi. */}
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
