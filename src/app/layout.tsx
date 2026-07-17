import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";
import BottomTabBar from "@/components/BottomTabBar";
import { getCapabilities } from "@/lib/session";
import { capabilitiesFor } from "@/lib/permissions";

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

  return (
    <html lang="ru">
      <body className="antialiased">
        <Nav caps={caps} />
        {/* pb-20 на мобиле — контент не прячется за нижним таб-баром. */}
        <div className="min-h-screen pb-20 md:pb-0">{children}</div>
        <BottomTabBar caps={caps} />
      </body>
    </html>
  );
}
