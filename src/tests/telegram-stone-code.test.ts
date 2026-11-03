// ТЗ №20 G (§8.4) — сотрудник отправляет боту код ONX-… → сводка камня.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TgUpdate } from "@/lib/telegram";
import { handleUpdate, stoneCodeReply, type WebhookDeps } from "@/lib/telegram-webhook";
import type { StoneCodeCard } from "@/lib/stone-code";

const CARD: StoneCodeCard = {
  code: "ONX-7K3QD",
  kind: "PATTERN",
  kindLabel: "Узор",
  stoneTypeId: "st1",
  title: "Травертин Классик · узор «светлый»",
  availability: "свободно 3 пл. / 13,4 м²",
  location: "Блок A1 · ориентир 2",
};

const sendMessage = vi.fn();
const userFindFirst = vi.fn();
const lookupStoneCode = vi.fn();

function deps(over: Partial<WebhookDeps> = {}): WebhookDeps {
  return {
    db: { user: { findFirst: userFindFirst } },
    sendMessage,
    appBaseUrl: "https://app.test",
    stoneCodeBaseUrl: "https://onyx.test",
    lookupStoneCode,
    claimTelegramUpdate: async () => "claimed",
    releaseTelegramUpdate: async () => true,
    ...over,
  } as unknown as WebhookDeps;
}

const textUpdate = (text: string): TgUpdate =>
  ({
    update_id: Math.floor(Math.random() * 1e9),
    message: { message_id: 1, chat: { id: 555 }, from: { id: 555 }, text },
  }) as unknown as TgUpdate;

beforeEach(() => {
  sendMessage.mockReset().mockResolvedValue(undefined);
  userFindFirst.mockReset().mockResolvedValue({ id: "u1", role: "WAREHOUSE" });
  lookupStoneCode.mockReset().mockResolvedValue(CARD);
});

describe("stoneCodeReply", () => {
  it("название, наличие, локация, ссылка", () => {
    const t = stoneCodeReply(CARD, "https://onyx.test/");
    expect(t).toContain("Травертин Классик");
    expect(t).toContain("Наличие: свободно 3 пл. / 13,4 м²");
    expect(t).toContain("Локация: Блок A1 · ориентир 2");
    expect(t).toContain("https://onyx.test/k/ONX-7K3QD");
  });
});

describe("handleUpdate — код камня", () => {
  it("сотрудник: код в любом регистре → карточка", async () => {
    await handleUpdate(textUpdate("onx-7k3qd"), deps());
    expect(lookupStoneCode).toHaveBeenCalledWith("ONX-7K3QD");
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [chat, text] = sendMessage.mock.calls[0];
    expect(chat).toBe(555);
    expect(text).toContain("https://onyx.test/k/ONX-7K3QD");
  });

  it("ссылка с этикетки тоже работает", async () => {
    await handleUpdate(textUpdate("https://onyx-sklad-app.vercel.app/k/ONX-7K3QD"), deps());
    expect(lookupStoneCode).toHaveBeenCalledWith("ONX-7K3QD");
  });

  it("код не найден — честный ответ", async () => {
    lookupStoneCode.mockResolvedValue(null);
    await handleUpdate(textUpdate("ONX-AAAAA"), deps());
    expect(sendMessage.mock.calls[0][1]).toContain("не найден");
  });

  it("партнёр / не привязан — без данных склада", async () => {
    userFindFirst.mockResolvedValue({ id: "p1", role: "PARTNER" });
    await handleUpdate(textUpdate("ONX-7K3QD"), deps());
    expect(lookupStoneCode).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls[0][1]).toContain("сотрудникам");

    sendMessage.mockClear();
    userFindFirst.mockResolvedValue(null);
    await handleUpdate(textUpdate("ONX-7K3QD"), deps());
    expect(lookupStoneCode).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls[0][1]).toContain("сотрудникам");
  });

  it("слово из 5 букв без ONX — не код (подсказка)", async () => {
    await handleUpdate(textUpdate("CREMA"), deps());
    expect(lookupStoneCode).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls[0][1]).toContain("Onyx bot");
  });
});
