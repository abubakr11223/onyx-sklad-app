// Домены нашего приложения: вебхук бота должен вести на один из них.
import { publicBaseUrl } from "@/lib/qr";

export function appHosts(env: Record<string, string | undefined> = process.env): string[] {
  const out = new Set<string>();
  const add = (raw: string | undefined) => {
    const s = (raw ?? "").trim();
    if (!s) return;
    try {
      out.add(new URL(/^https?:\/\//.test(s) ? s : `https://${s}`).host);
    } catch {
      // мусор в переменной — пропускаем
    }
  };
  add(publicBaseUrl(env));
  add(env.APP_BASE_URL);
  add(env.VERCEL_PROJECT_PRODUCTION_URL);
  add(env.VERCEL_URL);
  return [...out];
}
