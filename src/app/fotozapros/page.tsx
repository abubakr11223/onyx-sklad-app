// TG-B1 — «Запросы на фото»: список фотозапросов для менеджера (TZ §5.3, §1.8).
// Server component. Сами фото приходят в TG-B2 — здесь пока только статус.
import type { Metadata } from "next";
import { db } from "@/lib/db";

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

const STATUS_CLASS: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  DONE: "bg-green-100 text-green-800",
  CANCELLED: "bg-gray-200 text-gray-600",
};

export default async function FotozaprosPage() {
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
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
        Запросы на фото
      </h1>
      <p className="mt-1 text-sm text-gray-500">
        Задачи складчикам сфотографировать камень. Фото приходят в Telegram.
      </p>

      {requests.length === 0 ? (
        <p className="mt-6 text-gray-500">Пока нет запросов на фото.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {requests.map((r) => {
            const stoneName = r.batch.stoneType?.name ?? "камень";
            const loc = r.batchLocation
              ? `Блок ${r.batchLocation.block}, ориентир ${r.batchLocation.landmark}`
              : "локация не указана";
            return (
              <li
                key={r.id}
                className="rounded-xl border border-gray-200 p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <h3 className="text-base font-bold">{stoneName}</h3>
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                      STATUS_CLASS[r.status] ?? "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {STATUS_RU[r.status] ?? r.status}
                  </span>
                </div>
                <p className="mt-1 text-sm text-gray-700">{loc}</p>
                {r.comment && (
                  <p className="mt-1 text-sm text-gray-600">
                    Комментарий: {r.comment}
                  </p>
                )}
                <p className="mt-1 text-xs text-gray-400">
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
                        className="h-20 w-20 rounded border object-cover"
                        alt="фото"
                        loading="lazy"
                      />
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
