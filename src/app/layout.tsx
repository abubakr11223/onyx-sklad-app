import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "Onyx — складская система",
  description: "Учёт натурального камня: партии, плиты, остатки, брони",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased">
        <Nav />
        <div className="min-h-screen">{children}</div>
      </body>
    </html>
  );
}
