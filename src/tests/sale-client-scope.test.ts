// Аудит 2026-08-10 — область видимости объектов в форме продажи.
//
// Контекст: поиск клиента в форме продажи НАМЕРЕННО глобальный
// (`attachAnyExisting`, ТЗ №14 BUG-02) — менеджер должен находить чужую/владельческую
// карточку, а не плодить дубль. Из-за этого `listSitesForClient` получал реальный
// чужой clientId и раньше отдавал ПОЛНЫЙ список объектов (имя, адрес, контактное
// лицо) — те же записи, которые `/obekty/[id]` этому менеджеру отдаёт как 404.
//
// Этот файл фиксирует: список объектов подчиняется ТОМУ ЖЕ scope, что справочник.
// Владелец — все; менеджер — только свои (managerId). Если этот тест падает —
// значит горизонтальная утечка между менеджерами вернулась.
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCapabilities = vi.fn();
const currentActorId = vi.fn();
const clientFindUnique = vi.fn();
const siteFindMany = vi.fn();
const siteCreate = vi.fn();

vi.mock("@/lib/session", () => ({
  getCapabilities: (...a: unknown[]) => getCapabilities(...a),
  currentActorId: (...a: unknown[]) => currentActorId(...a),
}));

vi.mock("@/lib/db", () => ({
  db: {
    client: { findUnique: (...a: unknown[]) => clientFindUnique(...a) },
    site: {
      findMany: (...a: unknown[]) => siteFindMany(...a),
      create: (...a: unknown[]) => siteCreate(...a),
    },
  },
}));

import {
  createSiteForSale,
  listSitesForClient,
} from "@/app/prodazha/client-actions";
import { SITE_PICKER_TAKE } from "@/lib/client-search";

const MANAGER_CAPS = { canSell: true, canSeeAllClients: false };
const OWNER_CAPS = { canSell: true, canSeeAllClients: true };

beforeEach(() => {
  getCapabilities.mockReset();
  currentActorId.mockReset();
  clientFindUnique.mockReset();
  siteFindMany.mockReset();
  siteCreate.mockReset();
  clientFindUnique.mockResolvedValue({ id: "cli-of-other-manager" });
  siteFindMany.mockResolvedValue([]);
});

describe("listSitesForClient — scope равен справочнику", () => {
  it("менеджер: WHERE сужен до его managerId (чужие объекты недостижимы)", async () => {
    getCapabilities.mockResolvedValue(MANAGER_CAPS);
    currentActorId.mockResolvedValue("mgr-A");

    const res = await listSitesForClient("cli-of-other-manager");

    expect(res.ok).toBe(true);
    expect(siteFindMany).toHaveBeenCalledTimes(1);
    const where = siteFindMany.mock.calls[0][0].where;
    expect(where).toEqual({
      clientId: "cli-of-other-manager",
      managerId: "mgr-A",
    });
  });

  it("владелец: без сужения по managerId — видит все объекты клиента", async () => {
    getCapabilities.mockResolvedValue(OWNER_CAPS);
    currentActorId.mockResolvedValue("owner-1");

    await listSitesForClient("cli-of-other-manager");

    const where = siteFindMany.mock.calls[0][0].where;
    expect(where).toEqual({ clientId: "cli-of-other-manager" });
    expect(where.managerId).toBeUndefined();
  });

  it("запрос всегда ограничен take (без unbounded findMany)", async () => {
    getCapabilities.mockResolvedValue(MANAGER_CAPS);
    currentActorId.mockResolvedValue("mgr-A");

    await listSitesForClient("cli-1");

    expect(siteFindMany.mock.calls[0][0].take).toBe(SITE_PICKER_TAKE);
  });

  it("чужой клиент → пустой список, а не ошибка: продажа «Без объекта» проходит", async () => {
    getCapabilities.mockResolvedValue(MANAGER_CAPS);
    currentActorId.mockResolvedValue("mgr-A");
    siteFindMany.mockResolvedValue([]);

    const res = await listSitesForClient("cli-of-other-manager");

    expect(res).toEqual({ ok: true, sites: [] });
  });

  it("несуществующий клиент → ошибка (а не тихий пустой список)", async () => {
    getCapabilities.mockResolvedValue(MANAGER_CAPS);
    currentActorId.mockResolvedValue("mgr-A");
    clientFindUnique.mockResolvedValue(null);

    const res = await listSitesForClient("nope");

    expect(res).toEqual({ ok: false, error: "Клиент не найден" });
    expect(siteFindMany).not.toHaveBeenCalled();
  });

  it("без права canSell — отказ до любого запроса в БД", async () => {
    getCapabilities.mockResolvedValue({ canSell: false, canSeeAllClients: false });
    currentActorId.mockResolvedValue("wh-1");

    const res = await listSitesForClient("cli-1");

    expect(res.ok).toBe(false);
    expect(clientFindUnique).not.toHaveBeenCalled();
    expect(siteFindMany).not.toHaveBeenCalled();
  });
});

describe("createSiteForSale — созданный объект принадлежит автору", () => {
  it("managerId проставляется из сессии, а не из входных данных", async () => {
    getCapabilities.mockResolvedValue(MANAGER_CAPS);
    currentActorId.mockResolvedValue("mgr-A");
    clientFindUnique.mockResolvedValue({ id: "cli-1" });
    siteCreate.mockResolvedValue({
      id: "s1",
      name: "Вилла",
      type: "RESIDENTIAL",
      status: "ACTIVE",
      address: null,
    });

    const res = await createSiteForSale({
      clientId: "cli-1",
      name: "Вилла",
      type: "RESIDENTIAL",
    });

    expect(res.ok).toBe(true);
    expect(siteCreate.mock.calls[0][0].data.managerId).toBe("mgr-A");
  });
});
