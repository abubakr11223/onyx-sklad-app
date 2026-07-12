// Страница приёмки партии (TZ §5.1, §6.3) — server component:
// загружает виды камня из каталога и показывает уведомление об успехе.

import { db } from "@/lib/db";
import { getCapabilities } from "@/lib/session";
import NoAccess from "@/components/NoAccess";
import IntakeForm from "./IntakeForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Приёмка партии — Onyx",
};

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function PriemkaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // R2 — rol gate: приёмку делает склад (canManageWarehouse: OWNER/WAREHOUSE).
  // TZ §3: MANAGER складом не управляет — теперь тоже видит <NoAccess/>.
  const caps = await getCapabilities();
  if (!caps.canManageWarehouse) {
    return (
      <main className="mx-auto max-w-xl p-4 pb-12">
        <NoAccess />
      </main>
    );
  }

  const sp = await searchParams;
  const stoneTypes = await db.stoneType.findMany({
    where: { isArchived: false },
    orderBy: { name: "asc" },
    select: { id: true, name: true, rockType: true },
  });

  const ok = first(sp.ok) === "1";
  const stone = first(sp.stone);
  const slabs = first(sp.slabs);
  const area = first(sp.area);
  const qty = [slabs && `${slabs} плит`, area && `${area} м²`].filter(Boolean).join(" / ");

  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="mx-auto max-w-xl p-4 pb-12">
      <h1 className="mb-1 text-3xl font-bold tracking-tight">Приёмка партии</h1>
      <p className="mb-5 text-base text-gray-500">
        Партия целиком — без поимённого учёта плит.
      </p>

      {ok && stone && (
        <div
          role="status"
          className="mb-5 rounded-2xl border border-green-300 bg-green-50 p-4 text-base text-green-900"
        >
          <p className="font-semibold">Партия принята ✓</p>
          <p>
            {stone}
            {qty && ` — ${qty}`}
          </p>
        </div>
      )}

      <IntakeForm stoneTypes={stoneTypes} defaultDate={today} />
    </main>
  );
}
