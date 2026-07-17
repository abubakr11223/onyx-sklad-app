// TG-B1 — «Запросы на фото»: список фотозапросов для менеджера (TZ §5.3, §1.8).
// Server component. Сами фото приходят в TG-B2 — здесь пока только статус.
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getCapabilities } from "@/lib/session";
import NoAccess from "@/components/NoAccess";
import Card from "@/components/ui/Card";
import Badge, { type BadgeVariant } from "@/components/ui/Badge";
import Alert from "@/components/ui/Alert";
import { CameraIcon } from "@/components/ui/Icons";

export const metadata: Metadata = {
  title: "Запросы на фото — Onyx",
};

export const dynamic = "force-dynamic";

const dateFmt = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "short",
  timeStyle: "short",
});

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

export default async function FotozaprosPage() {
  // R2 — rol gate: фотозапросы у OWNER/MANAGER (canRequestPhoto). Складчик — <NoAccess/>.
  const caps = await getCapabilities();
  if (!caps.canRequestPhoto) {
    return (
      <main className="mx-auto max-w-3xl p-4 sm:p-8">
        <NoAccess />
      </main>
    );
  }

  const requests = await db.photoRequest.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      batch: { include: { stoneType: true } },
      batchLocation: true,
      assignee: true,
      photos: { select: { id: true }, orderBy: { createdAt: "asc" } },
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
          Запросы на фото
        </h1>
        <p className="mt-2 text-base text-ink/60">
          Задачи складчикам сфотографировать камень. Фото приходят в Telegram.
        </p>
      </header>

      {requests.length === 0 ? (
        <Alert variant="info">Пока нет запросов на фото.</Alert>
      ) : (
        <ul className="space-y-3">
          {requests.map((r) => {
            const stoneName = r.batch.stoneType?.name ?? "камень";
            const loc = r.batchLocation
              ? `Блок ${r.batchLocation.block}, ориентир ${r.batchLocation.landmark}`
              : "локация не указана";
            return (
              <li key={r.id}>
                <Card>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <h3 className="text-base font-bold text-ink">{stoneName}</h3>
                    <Badge variant={STATUS_VARIANT[r.status] ?? "neutral"}>
                      {STATUS_RU[r.status] ?? r.status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-ink/70">{loc}</p>
                  {r.comment && (
                    <p className="mt-1 text-sm text-ink/70">
                      Комментарий: {r.comment}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-ink/50">
                    {dateFmt.format(r.createdAt)}
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
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
