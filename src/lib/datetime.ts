// BUG-05 — единый форматтер дат/времени в Asia/Tashkent (UTC+5).
// ПОЧЕМУ явный timeZone: сервер (Vercel/Node) работает в UTC, а Intl без
// опции timeZone форматирует по времени процесса — экран отставал на 5 часов
// (17:03 показывался как 12:03). Хранение остаётся в UTC (.toISOString() не
// трогаем) — переводим ТОЛЬКО отображение. Модуль чистый (client-safe): без
// server-only зависимостей, поэтому даёт одинаковый результат на сервере и
// клиенте. UZ: server UTCda ishlaydi — ko'rsatishda vaqt zonasini aniq beramiz.
export const APP_TZ = "Asia/Tashkent"; // UTC+5

const dateOnly = new Intl.DateTimeFormat("ru-RU", {
  timeZone: APP_TZ,
  dateStyle: "short",
});
const dateTime = new Intl.DateTimeFormat("ru-RU", {
  timeZone: APP_TZ,
  dateStyle: "short",
  timeStyle: "short",
});

/** Только дата в Ташкенте: «21.07.2026». */
export const formatTashkentDate = (d: Date) => dateOnly.format(d);

/** Дата и время в Ташкенте: «21.07.2026, 17:03». */
export const formatTashkentDateTime = (d: Date) => dateTime.format(d);

/** «Сегодня» в Ташкенте как ISO-дата YYYY-MM-DD (для <input type="date">). */
export const todayTashkentISO = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
