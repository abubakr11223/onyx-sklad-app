// TZ №10+11 Этап 2 — блок «Клиент / Объект» на шаге оформления продажи.
// Чистая валидация (без БД): server action + unit-тесты.
// Клиент обязателен (clientId существующей карточки). Объект — нет.

import {
  isClientType,
  isSiteType,
  type ClientType,
  type SiteType,
} from "@/lib/clients";

export interface SaleClientFormInput {
  /** id выбранного/только что созданного клиента. Пусто = ошибка. */
  clientId: string;
  /** id объекта или пусто («без объекта»). */
  siteId: string;
  /**
   * Явный режим объекта: "none" | "existing" | "".
   * "existing" требует siteId; "none"/пусто + пустой siteId = без объекта.
   */
  siteMode: string;
}

export interface ValidSaleClientLink {
  clientId: string;
  /** null = частная продажа без объекта. */
  siteId: string | null;
}

export type SaleClientErrors = Record<string, string>;

export type SaleClientResult =
  | { ok: true; data: ValidSaleClientLink }
  | { ok: false; errors: SaleClientErrors };

/**
 * Валидирует привязку продажи к справочнику (TZ §6).
 * clientId обязателен — прямой POST без UI обязан отсекаться.
 * siteId необязателен.
 */
export function validateSaleClientLink(
  input: SaleClientFormInput,
): SaleClientResult {
  const errors: SaleClientErrors = {};

  const clientId = (input.clientId ?? "").trim();
  if (!clientId) {
    errors.clientId = "Выберите или создайте клиента — обязательное поле";
  }

  const siteMode = (input.siteMode ?? "").trim();
  const siteIdRaw = (input.siteId ?? "").trim();
  let siteId: string | null = null;

  if (siteMode === "existing") {
    if (!siteIdRaw) {
      errors.siteId = "Выберите объект или отметьте «Без объекта»";
    } else {
      siteId = siteIdRaw;
    }
  } else if (siteIdRaw && siteMode !== "none") {
    // Hidden field alone is enough (form may omit siteMode).
    siteId = siteIdRaw;
  }
  // siteMode "none" or empty + no siteId → null (частная продажа).

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, data: { clientId, siteId } };
}

/** Поля быстрого создания клиента (до привязки к продаже). */
export interface NewClientInput {
  name: string;
  type: string;
  phone: string;
}

export interface ValidNewClient {
  name: string;
  type: ClientType;
  phone: string;
}

export function validateNewClient(
  input: NewClientInput,
): { ok: true; data: ValidNewClient } | { ok: false; errors: SaleClientErrors } {
  const errors: SaleClientErrors = {};
  const name = (input.name ?? "").trim();
  if (!name) errors.newClientName = "Укажите имя или название";

  const typeRaw = (input.type ?? "").trim();
  let type: ClientType | null = null;
  if (!typeRaw) {
    errors.newClientType = "Выберите тип: частный или компания";
  } else if (!isClientType(typeRaw)) {
    errors.newClientType = "Неизвестный тип клиента";
  } else {
    type = typeRaw;
  }

  const phone = (input.phone ?? "").trim();
  if (!phone) {
    errors.newClientPhone = "Укажите телефон — обязателен";
  } else if (phone.replace(/\D+/g, "").length < 7) {
    errors.newClientPhone = "Телефон слишком короткий";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, data: { name, type: type!, phone } };
}

/** Поля быстрого создания объекта. */
export interface NewSiteInput {
  name: string;
  type: string;
  address: string;
  contactPerson: string;
  clientId: string;
}

export interface ValidNewSite {
  name: string;
  type: SiteType;
  address: string | null;
  contactPerson: string | null;
  clientId: string;
}

export function validateNewSite(
  input: NewSiteInput,
): { ok: true; data: ValidNewSite } | { ok: false; errors: SaleClientErrors } {
  const errors: SaleClientErrors = {};
  const clientId = (input.clientId ?? "").trim();
  if (!clientId) errors.clientId = "Сначала выберите клиента";

  const name = (input.name ?? "").trim();
  if (!name) errors.newSiteName = "Укажите название объекта";

  const typeRaw = (input.type ?? "").trim();
  let type: SiteType | null = null;
  if (!typeRaw) {
    errors.newSiteType = "Выберите тип объекта";
  } else if (!isSiteType(typeRaw)) {
    errors.newSiteType = "Неизвестный тип объекта";
  } else {
    type = typeRaw;
  }

  const address = (input.address ?? "").trim() || null;
  const contactPerson = (input.contactPerson ?? "").trim() || null;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: { name, type: type!, address, contactPerson, clientId },
  };
}
