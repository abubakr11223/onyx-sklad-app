"use server";

// TZ №10+11 Этап 2 — server actions для справочника в форме продажи.
// Поиск / создание клиента и объекта. Сами разделы UI — этап 3.

import { db } from "@/lib/db";
import {
  findClientByNormalizedPhone,
  siteListScope,
  type ClientType,
  type SiteType,
} from "@/lib/clients";
import {
  CLIENT_SEARCH_SALE_TAKE,
  SITE_PICKER_TAKE,
  searchClients,
  type ClientSearchHit,
} from "@/lib/client-search";
import {
  validateNewClient,
  validateNewSite,
} from "@/lib/validators/sale-client";
import { getCapabilities, currentActorId } from "@/lib/session";

export type ClientHit = ClientSearchHit;

export type SiteHit = {
  id: string;
  name: string;
  type: SiteType;
  status: "ACTIVE" | "COMPLETED";
  address: string | null;
};

async function requireSeller(): Promise<
  | { ok: true; managerId: string; canSeeAllClients: boolean }
  | { ok: false; error: string }
> {
  const caps = await getCapabilities();
  if (!caps.canSell) {
    return { ok: false, error: "Нет доступа: продажа доступна менеджеру" };
  }
  const managerId = await currentActorId();
  if (!managerId) {
    return {
      ok: false,
      error: "В системе нет активного менеджера — обратитесь к администратору",
    };
  }
  return {
    ok: true,
    managerId,
    canSeeAllClients: caps.canSeeAllClients,
  };
}

/**
 * Поиск клиентов для формы продажи.
 * TZ №14 BUG-02: тот же механизм, что /klienty (client-search.ts) —
 * имя + телефон, partial, без регистра. attachAnyExisting: менеджер
 * находит карточку владельца и по имени (раньше global path был только
 * у телефона ≥7 цифр).
 */
export async function searchClientsForSale(
  query: string,
): Promise<{ ok: true; clients: ClientHit[] } | { ok: false; error: string }> {
  const auth = await requireSeller();
  if (!auth.ok) return auth;

  const clients = await searchClients(db, {
    q: query,
    canSeeAllClients: auth.canSeeAllClients,
    actorId: auth.managerId,
    take: CLIENT_SEARCH_SALE_TAKE,
    attachAnyExisting: true,
  });

  return { ok: true, clients };
}

/**
 * Создать клиента в справочнике. При совпадении телефона (нормализованно) —
 * НЕ плодит дубль: возвращает existing + reason=duplicate.
 */
export async function createClientForSale(input: {
  name: string;
  type: string;
  phone: string;
}): Promise<
  | { ok: true; client: ClientHit }
  | {
      ok: false;
      reason: "duplicate";
      existing: ClientHit;
      error: string;
    }
  | { ok: false; reason: "validation" | "auth"; error: string; errors?: Record<string, string> }
> {
  const auth = await requireSeller();
  if (!auth.ok) return { ok: false, reason: "auth", error: auth.error };

  const v = validateNewClient(input);
  if (!v.ok) {
    const first = Object.values(v.errors)[0] ?? "Проверьте поля клиента";
    return { ok: false, reason: "validation", error: first, errors: v.errors };
  }

  // Soft dedup: scan recent/all phones (normalized). Index is raw string —
  // we load candidates and match in process (phones stored with various masks).
  const candidates = await db.client.findMany({
    select: { id: true, name: true, phone: true, type: true },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });
  const dup = findClientByNormalizedPhone(candidates, v.data.phone);
  if (dup) {
    return {
      ok: false,
      reason: "duplicate",
      existing: {
        id: dup.id,
        name: dup.name,
        phone: dup.phone,
        type: dup.type as ClientType,
      },
      error: `Клиент с таким телефоном уже есть: ${dup.name}. Выберите его.`,
    };
  }

  const created = await db.client.create({
    data: {
      name: v.data.name,
      type: v.data.type,
      phone: v.data.phone,
      managerId: auth.managerId,
    },
    select: { id: true, name: true, phone: true, type: true },
  });

  return {
    ok: true,
    client: {
      id: created.id,
      name: created.name,
      phone: created.phone,
      type: created.type as ClientType,
    },
  };
}

/**
 * Объекты выбранного клиента (для select в форме).
 *
 * ⚠️ ОБЛАСТЬ ВИДИМОСТИ (аудит 2026-08-10). Поиск клиента в форме продажи
 * намеренно ГЛОБАЛЬНЫЙ (`attachAnyExisting`, ТЗ №14 BUG-02) — менеджер должен
 * находить существующую карточку, а не плодить дубль. Раньше отсюда следовало,
 * что по чужому clientId возвращался ПОЛНЫЙ список объектов (имя, адрес,
 * контактное лицо) — тех самых, которые `/obekty/[id]` этому же менеджеру
 * отдаёт как 404 (`canAccessDirectoryRecord`). Две части системы противоречили
 * друг другу, и более слабая выигрывала.
 *
 * Теперь список объектов подчиняется ТОМУ ЖЕ правилу, что справочник:
 * `siteListScope` — владелец видит все, менеджер только свои (`managerId`).
 * Продажа не ломается: объект опционален («Без объекта»), а нужный менеджер
 * создаёт через `createSiteForSale` — запись сразу становится его.
 */
export async function listSitesForClient(
  clientId: string,
): Promise<{ ok: true; sites: SiteHit[] } | { ok: false; error: string }> {
  const auth = await requireSeller();
  if (!auth.ok) return auth;

  const id = clientId.trim();
  if (!id) return { ok: true, sites: [] };

  const client = await db.client.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!client) return { ok: false, error: "Клиент не найден" };

  const sites = await db.site.findMany({
    where: {
      clientId: id,
      ...siteListScope({
        canSeeAllClients: auth.canSeeAllClients,
        actorId: auth.managerId,
      }),
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    take: SITE_PICKER_TAKE,
    select: {
      id: true,
      name: true,
      type: true,
      status: true,
      address: true,
    },
  });

  return {
    ok: true,
    sites: sites.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type as SiteType,
      status: s.status as "ACTIVE" | "COMPLETED",
      address: s.address,
    })),
  };
}

/**
 * Создать объект у клиента. Сразу в справочник, затем выбирается для продажи.
 */
export async function createSiteForSale(input: {
  clientId: string;
  name: string;
  type: string;
  address?: string;
  contactPerson?: string;
}): Promise<
  | { ok: true; site: SiteHit }
  | { ok: false; error: string; errors?: Record<string, string> }
> {
  const auth = await requireSeller();
  if (!auth.ok) return auth;

  const v = validateNewSite({
    clientId: input.clientId,
    name: input.name,
    type: input.type,
    address: input.address ?? "",
    contactPerson: input.contactPerson ?? "",
  });
  if (!v.ok) {
    const first = Object.values(v.errors)[0] ?? "Проверьте поля объекта";
    return { ok: false, error: first, errors: v.errors };
  }

  const client = await db.client.findUnique({
    where: { id: v.data.clientId },
    select: { id: true },
  });
  if (!client) return { ok: false, error: "Клиент не найден" };

  const created = await db.site.create({
    data: {
      name: v.data.name,
      type: v.data.type,
      address: v.data.address,
      contactPerson: v.data.contactPerson,
      clientId: v.data.clientId,
      managerId: auth.managerId,
      status: "ACTIVE",
    },
    select: {
      id: true,
      name: true,
      type: true,
      status: true,
      address: true,
    },
  });

  return {
    ok: true,
    site: {
      id: created.id,
      name: created.name,
      type: created.type as SiteType,
      status: created.status as "ACTIVE" | "COMPLETED",
      address: created.address,
    },
  };
}
