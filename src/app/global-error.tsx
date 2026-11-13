"use client";

// Глобальная граница ошибок ПОСЛЕДНЕГО рубежа. Ловит сбои, которые error.tsx
// поймать не может — в т.ч. throw в САМОМ root layout (напр. моргнула БД).
// Заменяет весь документ, поэтому обязана рендерить свои <html>/<body> и не
// может опираться на layout, шрифты или globals-токены (инлайн-стили).

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="ru">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          background: "#f4f1ec",
          color: "#1c1915",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: "24rem" }}>
          <h1
            style={{
                            fontSize: "1.5rem",
              fontWeight: 600,
              margin: 0,
            }}
          >
            Что-то пошло не так
          </h1>
          <p style={{ marginTop: "0.5rem", color: "#6b6359" }}>
            Приложение временно недоступно. Попробуйте ещё раз.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: "1.5rem",
              minHeight: "44px",
              padding: "0 1.25rem",
              borderRadius: "6px",
              border: "none",
              background: "#1c1915",
              color: "#ffffff",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Повторить
          </button>
        </div>
      </body>
    </html>
  );
}
