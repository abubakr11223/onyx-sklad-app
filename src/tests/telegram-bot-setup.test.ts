// ТЗ №20 H — вебхук бота: не хватает ли callback_query, новый список, наш адрес.
import { describe, expect, it } from "vitest";
import { isOurWebhookUrl, mergedUpdates, missingUpdates } from "@/lib/telegram-bot-setup";
import { appHosts } from "@/app/accounts/bot/hosts";

describe("вебхук бота — callback_query", () => {
  it("пустой список = все типы, ничего не нужно", () => {
    expect(missingUpdates(undefined)).toEqual([]);
    expect(missingUpdates([])).toEqual([]);
  });
  it("старый список без кнопок", () => {
    expect(missingUpdates(["message", "edited_message"])).toEqual(["callback_query"]);
    expect(mergedUpdates(["message", "edited_message"])).toEqual(["message", "edited_message", "callback_query"]);
    expect(mergedUpdates(["message", "my_chat_member"])).toEqual([
      "message",
      "my_chat_member",
      "edited_message",
      "callback_query",
    ]);
  });
  it("адрес: только наш маршрут на нашем домене", () => {
    const hosts = appHosts({ PUBLIC_BASE_URL: "https://onyx-sklad-app.vercel.app", VERCEL_URL: "x-abc.vercel.app" });
    expect(hosts).toEqual(["onyx-sklad-app.vercel.app", "x-abc.vercel.app"]);
    expect(isOurWebhookUrl("https://onyx-sklad-app.vercel.app/api/telegram/webhook", hosts)).toBe(true);
    expect(isOurWebhookUrl("https://evil.example/api/telegram/webhook", hosts)).toBe(false);
    expect(isOurWebhookUrl("http://onyx-sklad-app.vercel.app/api/telegram/webhook", hosts)).toBe(false);
    expect(isOurWebhookUrl("https://onyx-sklad-app.vercel.app/other", hosts)).toBe(false);
    expect(isOurWebhookUrl("", hosts)).toBe(false);
  });
});
