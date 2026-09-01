"use client";

// §7/§8 — индикатор офлайна. Склад — большая территория со слабым сигналом;
// складчику важно ВИДЕТЬ, что связи нет (тогда он знает: приёмка сохранится
// черновиком, продажа/бронь недоступны до связи). Липкая полоса сверху.
import { useEffect, useState } from "react";

export default function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;
  return (
    <div
      role="status"
      className="sticky top-0 z-50 bg-warning/95 px-4 py-2 text-center text-sm font-semibold text-on-gold shadow-pop"
    >
      Нет связи — работаем офлайн. Приёмка сохранится черновиком; продажа и бронь
      будут доступны после восстановления связи.
    </div>
  );
}
