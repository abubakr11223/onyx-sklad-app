// Страница приёмки партии (TZ §5.1, §6.3) — server component:
// загружает виды камня из каталога и показывает уведомление об успехе.

import { db } from "@/lib/db";
import { getCapabilities } from "@/lib/session";
import NoAccess from "@/components/NoAccess";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";
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
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold-deep">
          Onyx · склад
        </p>
        <h1 className="mt-2 font-serif text-display font-bold tracking-tight text-ink">
          Приёмка партии
        </h1>
        <p className="mt-2 text-base text-ink/60">
          Партия целиком — без поимённого учёта плит.
        </p>
      </header>

      {ok && stone && (
        <Alert variant="success" title="Партия принята" className="mb-6">
          <span className="font-medium text-ink">{stone}</span>
          {qty && (
            <Badge variant="neutral" className="ml-2 align-middle">
              {qty}
            </Badge>
          )}
        </Alert>
      )}

      <IntakeForm stoneTypes={stoneTypes} defaultDate={today} />
    </main>
  );
}
