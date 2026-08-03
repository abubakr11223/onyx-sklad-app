// Client panel: bulk close PENDING photo requests.
// Intent protection (no stray tap):
//  1) collapsed <details> — must expand first;
//  2) required checkbox «Понимаю»;
//  3) submit button shows the exact count for the selected scope;
//  4) server re-checks confirm token + ack + canRequestPhoto.
"use client";

import { useMemo, useState } from "react";
import { bulkClosePhotoRequests } from "./actions";
import {
  BULK_CLOSE_CONFIRM_TOKEN,
  BULK_CLOSE_DEFAULT_DAYS,
  type BulkCloseScope,
} from "./bulk-close";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";

export default function BulkClosePanel({
  pendingAll,
  pendingOlder,
  defaultDays = BULK_CLOSE_DEFAULT_DAYS,
}: {
  /** Count of all PENDING requests (server). */
  pendingAll: number;
  /** Count of PENDING older than defaultDays. */
  pendingOlder: number;
  defaultDays?: number;
}) {
  const [scope, setScope] = useState<BulkCloseScope>("older");
  const [ack, setAck] = useState(false);

  const closeCount = useMemo(
    () => (scope === "all" ? pendingAll : pendingOlder),
    [scope, pendingAll, pendingOlder],
  );

  if (pendingAll === 0) return null;

  return (
    <details className="mb-6 rounded-card border border-warning/40 bg-warning/5 open:bg-warning/[0.07]">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-ink marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="underline decoration-warning/50 underline-offset-2">
          Закрыть зависшие запросы…
        </span>
        <span className="ml-2 font-normal text-ink/60">
          (открыто: {pendingAll}
          {pendingOlder > 0
            ? `, старше ${defaultDays} дн.: ${pendingOlder}`
            : ""}
          )
        </span>
      </summary>

      <div className="border-t border-warning/25 px-4 pb-4 pt-3">
        <Alert variant="warning" className="mb-3">
          Закрытие ставит статус «готово» — склад больше не сможет прикрепить
          фото к этим запросам. Удаления нет, но ждать фото по ним уже нельзя.
          Автоматического сгорания нет — только эта кнопка.
        </Alert>

        <form action={bulkClosePhotoRequests} className="flex flex-col gap-3">
          <input
            type="hidden"
            name="confirm"
            value={BULK_CLOSE_CONFIRM_TOKEN}
          />
          <input
            type="hidden"
            name="olderThanDays"
            value={String(defaultDays)}
          />

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-semibold text-ink">
              Что закрыть
            </legend>
            <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-field border border-line bg-paper px-3 py-2 text-sm">
              <input
                type="radio"
                name="scope"
                value="older"
                checked={scope === "older"}
                onChange={() => setScope("older")}
                className="mt-1"
              />
              <span>
                <span className="font-semibold text-ink">
                  Только старше {defaultDays} дней
                </span>
                <span className="block text-ink/60">
                  Безопаснее: свежие задачи не трогаем ({pendingOlder} шт.)
                </span>
              </span>
            </label>
            <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-field border border-line bg-paper px-3 py-2 text-sm">
              <input
                type="radio"
                name="scope"
                value="all"
                checked={scope === "all"}
                onChange={() => setScope("all")}
                className="mt-1"
              />
              <span>
                <span className="font-semibold text-ink">
                  Все открытые ({pendingAll})
                </span>
                <span className="block text-ink/60">
                  В том числе сегодняшние — только если очередь точно мусор
                </span>
              </span>
            </label>
          </fieldset>

          <label className="flex min-h-11 cursor-pointer items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              name="ack"
              value="1"
              required
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
              className="mt-1"
            />
            <span>
              Понимаю: закрою{" "}
              <strong className="tnum">{closeCount}</strong>{" "}
              {closeCount === 1 ? "запрос" : "запросов"} — фото к ним больше не
              привяжутся.
            </span>
          </label>

          <Button
            type="submit"
            variant="danger"
            disabled={!ack || closeCount === 0}
            className="min-h-12 w-full font-bold"
          >
            {closeCount === 0
              ? scope === "older"
                ? `Нет запросов старше ${defaultDays} дн.`
                : "Нет открытых запросов"
              : `Закрыть ${closeCount} ${closeCount === 1 ? "запрос" : "запросов"}`}
          </Button>
        </form>
      </div>
    </details>
  );
}
