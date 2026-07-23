import type { Metadata } from "next";
import { Suspense } from "react";
import { Montserrat, Lora } from "next/font/google";
import "./globals.css";
import { cookies } from "next/headers";
import Nav from "@/components/Nav";
import BottomTabBar from "@/components/BottomTabBar";
import Ripple from "@/components/ui/Ripple";
import Toaster from "@/components/ui/toast";
import FlashToaster from "@/components/FlashToaster";
import { getCapabilities } from "@/lib/session";
import { capabilitiesFor } from "@/lib/permissions";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

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
  const caps = await getCapabilities().catch(() =>
    capabilitiesFor("PARTNER", { canSeePurchasePrice: false }),
  );

  // OWN-03: реальная сессия активна? (только для показа кнопки «Выйти»).
  // Проверяем лишь подпись session-cookie — БД не трогаем (быстро, fail-safe).
  const isLoggedIn = await (async () => {
    try {
      const token = (await cookies()).get(SESSION_COOKIE)?.value;
      return token ? !!(await verifySessionToken(token)) : false;
    } catch {
      return false;
    }
  })();

  return (
    <html lang="ru" className={`${montserrat.variable} ${lora.variable}`}>
      <body className="antialiased">
        {/* Десктоп: фиксированная боковая панель слева (w-64). */}
        <Nav caps={caps} isLoggedIn={isLoggedIn} />
        {/* Контент сдвинут вправо на ширину панели (md:pl-64); на мобиле —
            во всю ширину, pb-20 чтобы не прятался за нижним таб-баром. */}
        <div className="min-h-screen pb-20 md:pb-0 md:pl-64">{children}</div>
        {/* Мобиль: нижний таб-бар (панель скрыта). */}
        <BottomTabBar caps={caps} />

        {/* Micro-interactions: ripple на кнопках, тосты, мост флеш→тост. */}
        <Ripple />
        <Toaster />
        <Suspense fallback={null}>
          <FlashToaster />
        </Suspense>
      </body>
    </html>
  );
}
