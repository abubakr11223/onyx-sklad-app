// ТЗ №20 H (§9.2) — кнопка «Менеджер связался» работает, только если Telegram
// присылает нам callback_query. Если вебхук когда-то зарегистрировали со
// списком allowed_updates без него, нажатие кнопки до сайта не доходит.
// Чистые правила (без сети): что не хватает и каким станет список.

/** Что нужно боту Onyx: сообщения, их правки и нажатия inline-кнопок. */
export const REQUIRED_UPDATES = ["message", "edited_message", "callback_query"] as const;

/**
 * Каких типов не хватает. Пустой/отсутствующий allowed_updates у Telegram
 * означает «все обычные типы» — тогда не хватает ничего.
 */
export function missingUpdates(allowed: readonly string[] | undefined | null): string[] {
  if (!allowed || allowed.length === 0) return [];
  return REQUIRED_UPDATES.filter((u) => !allowed.includes(u));
}

/** Новый список: всё, что было, плюс недостающее (порядок сохраняем). */
export function mergedUpdates(allowed: readonly string[] | undefined | null): string[] {
  const base = allowed && allowed.length > 0 ? [...allowed] : [];
  for (const u of REQUIRED_UPDATES) if (!base.includes(u)) base.push(u);
  return base;
}

/** Адрес вебхука ведёт на наш маршрут бота? (чужой адрес не трогаем). */
export function isOurWebhookUrl(url: string, appHosts: readonly string[]): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.pathname === "/api/telegram/webhook" && appHosts.includes(u.host);
  } catch {
    return false;
  }
}
