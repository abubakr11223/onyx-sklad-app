"use client";

// Глобальная граница ошибок (обязана быть client-компонентом). Раньше воркер
// увидел бы дефолтный английский экран Next — теперь дружелюбный русский текст
// и кнопка «Повторить» (reset). error.tsx рендерится ВНЕ layout, поэтому
// навигацию сюда не тянем — даём явный путь назад.

import Link from "next/link";
import { useEffect } from "react";
import Button, { buttonClass } from "@/components/ui/Button";
import { AlertTriangleIcon } from "@/components/ui/Icons";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Диагностика в консоль — без внешних логгеров (слабая сеть).
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <span className="flex size-14 items-center justify-center rounded-card bg-danger/12 text-danger">
        <AlertTriangleIcon width={28} height={28} />
      </span>

      <h1 className="mt-5 font-serif text-2xl font-bold text-ink">
        Что-то пошло не так
      </h1>
      <p className="mt-2 text-base text-ink/70">
        Не удалось загрузить страницу. Попробуйте ещё раз.
      </p>

      <div className="mt-6 flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
        <Button variant="primary" onClick={() => reset()}>
          Повторить
        </Button>
        <Link href="/" className={buttonClass("secondary")}>
          На главную
        </Link>
      </div>

      {error.digest && (
        <p className="mt-6 text-xs text-ink/40">Код: {error.digest}</p>
      )}
    </main>
  );
}
