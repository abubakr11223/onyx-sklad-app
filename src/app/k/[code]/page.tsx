// ТЗ №20 G (§8.2) — ВРЕМЕННАЯ цель QR-ссылки /k/ONX-XXXXX.
//
// Полная карточка по скану с разными доступами — часть H (§9), будет здесь же
// и заменит этот файл целиком. Пока: путь закрыт входом (proxy/login-gate),
// сотрудник попадает в существующую карточку вида /kamen/<id>, а её страница
// сама проверяет права. Код не найден — честное «Код не найден».
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { findByCode, staffCardHref } from "@/lib/stone-code";
import { buttonClass } from "@/components/ui/Button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Камень по коду — Onyx",
  robots: { index: false, follow: false },
};

export default async function StoneByCodePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const hit = await findByCode(db, code);
  if (hit) redirect(staffCardHref(hit));

  return (
    <main className="mx-auto max-w-2xl p-4 pb-12 sm:p-8">
      <div className="rounded-card border border-line bg-paper-2 p-6 text-center">
        <h1 className="font-serif text-xl font-bold text-ink">Код не найден</h1>
        <p className="mt-2 text-sm text-ink/55">
          Проверьте код на этикетке (формат ONX-XXXXX) или найдите камень в «Поиске».
        </p>
        <Link href="/poisk" className={buttonClass("secondary", "md", "mt-4")}>
          Открыть «Поиск»
        </Link>
      </div>
    </main>
  );
}
