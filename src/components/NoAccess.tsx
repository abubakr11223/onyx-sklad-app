// R2 — Rol majburlash: «Нет доступа» paneli (kichik server komponenti).
// Gate qilingan sahifa joriy rolga yopiq bo'lsa shuni ko'rsatadi. Nav layout'da
// qolgani uchun foydalanuvchi baribir ruxsatli bo'limlarga o'tib keta oladi.
// Barcha gate qilingan sahifalar qayta ishlatadi (DRY).
import Link from "next/link";

export default function NoAccess() {
  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-6 text-center">
      <h1 className="text-xl font-bold text-gray-900">Нет доступа</h1>
      <p className="mt-2 text-base text-gray-600">
        Эта страница доступна другой роли.
      </p>
      <Link
        href="/poisk"
        className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700"
      >
        <span aria-hidden="true">🔍</span> К поиску
      </Link>
    </div>
  );
}
