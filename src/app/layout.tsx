import type { Metadata } from "next";
import { Suspense } from "react";
import Script from "next/script";
import { Montserrat, Lora } from "next/font/google";
import "./globals.css";
import Nav from "@/components/Nav";
import BottomTabBar from "@/components/BottomTabBar";
import Ripple from "@/components/ui/Ripple";
import Toaster from "@/components/ui/toast";
import FlashToaster from "@/components/FlashToaster";
import TelegramBackButton from "@/components/TelegramBackButton";
import OfflineBanner from "@/components/OfflineBanner";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { GATED_REQUEST_HEADER } from "@/lib/auth";
import { staleSessionLoginHref } from "@/lib/gated-request";
import { capabilitiesFor } from "@/lib/permissions";

// Фирменная типографика бренда «Графит + золото» (см. public/karta.html):
// Montserrat = UI/sans, Lora = заголовки/serif. Оба грузятся через next/font
// (сеть до fonts.gstatic.com на билде есть) с cyrillic-сабсетом — интерфейс на
// русском. globals.css потребляет эти переменные (--font-montserrat/--font-lora)
// с системным стеком как fallback.
const montserrat = Montserrat({
  subsets: ["latin", "cyrillic"],
  variable: "--font-montserrat",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const lora = Lora({
  subsets: ["latin", "cyrillic"],
  variable: "--font-lora",
  display: "swap",
  weight: ["600", "700"],
});

export const metadata: Metadata = {
  title: "Onyx — складская система",
  description: "Учёт натурального камня: партии, плиты, остатки, брони",
  manifest: "/manifest.webmanifest", // §7/§8 — PWA (устанавливаемое приложение)
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Роль-фильтр навигации решается на СЕРВЕРЕ и передаётся пропом в оба
  // варианта навигации — так первый рендер уже правильный (нет мигания ссылок).
  //
  // ВАЖНО: root layout — выше error.tsx (тот его сиблинг и не ловит). Если БД
  // моргнёт (Neon cold-start), throw здесь обвалил бы ВЕСЬ апп. Поэтому падаем
  // в deny-all (самый безопасный) shell навигации; сама страница-ребёнок всё
  // ещё вызовет getCapabilities() и её throw поймает error.tsx (дружелюбный
  // русский экран). global-error.tsx — дополнительный рубеж.
  // R6: реальный пользователь из сессии (демо-shim удалён). БД моргнула → null
  // (deny-all shell), сама страница-ребёнок повторит и её throw поймает error.tsx.
  const user = await getCurrentUser().catch(() => null);

  // BUG-OWN: proxy stamped x-onyx-gated after signature OK, but getCurrentUser
  // is null (deleted / inactive / tokenVersion bump). Half-logged-in shell
  // used to render «only Поиск» — force re-login instead.
  //
  // Trust: the stamp is only meaningful after proxy DELETE+optional SET
  // (src/proxy.ts). Clients can send the header name; public paths never re-set
  // it. See staleSessionLoginHref — pure contract unit-tested.
  //
  // ⚠️ DB blip: catch → user null + stamp present → /login (fail-closed).
  // Server Actions / /api do NOT run this layout branch — they use
  // getCapabilities / own secrets (documented in result-security.md).
  const gatedPath = (await headers()).get(GATED_REQUEST_HEADER);
  const staleLogin = staleSessionLoginHref(!user, gatedPath);
  if (staleLogin) redirect(staleLogin);

  // Shell caps: real role when logged in. Null user should not reach nav
  // (redirect above on gated paths; public pages hide Nav via `user ?`).
  // Keep PARTNER-shaped shell only for the rare null-user shell path without stamp.
  const caps = user
    ? capabilitiesFor(user.role, { canSeePurchasePrice: user.canSeePurchasePrice })
    : capabilitiesFor("PARTNER", { canSeePurchasePrice: false });

  return (
    <html lang="ru" className={`${montserrat.variable} ${lora.variable}`}>
      <body className="antialiased">
        {/* §7/§8 — офлайн-индикатор (над всем интерфейсом). */}
        <OfflineBanner />
        {/* R6: навигация — только для вошедших. Без сессии (страница /login,
            куда gate перенаправляет) — чистый экран без панели/таб-бара. */}
        {user ? (
          <>
            {/* Десктоп: фиксированная боковая панель слева (w-64). */}
            <Nav caps={caps} user={{ name: user.name, role: user.role }} />
            {/* Контент сдвинут вправо на ширину панели (md:pl-64); на мобиле —
                во всю ширину, pb-20 чтобы не прятался за нижним таб-баром. */}
            <div className="min-h-screen pb-20 md:pb-0 md:pl-64">{children}</div>
            {/* Мобиль: нижний таб-бар (панель скрыта). */}
            <BottomTabBar caps={caps} />
          </>
        ) : (
          <div className="min-h-screen">{children}</div>
        )}

        {/* Micro-interactions: ripple на кнопках, тосты, мост флеш→тост. */}
        <Ripple />
        <Toaster />
        <Suspense fallback={null}>
          <FlashToaster />
        </Suspense>

        {/* §5.9 — Telegram Mini App SDK (нужен для BackButton и др.). Вне
            Telegram — безвредная заглушка. BackButton управляет навигацией
            «назад» внутри Telegram (в webview нет кнопки браузера). */}
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="afterInteractive"
        />
        <TelegramBackButton />
        {/* §7/§8 — офлайн-загрузка оболочки (безопасный SW). */}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
