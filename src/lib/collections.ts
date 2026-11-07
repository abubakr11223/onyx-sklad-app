// ТЗ №20 I (§10.3) — подборка камней для клиента.
//
// Сотрудник (владелец / менеджер) нажимает «В подборку» на карточке /k или в
// каталоге: выбирает свою открытую подборку или создаёт новую (название,
// клиент из справочника — необязательно). Камень хранится КОДОМ ONX-… (вид,
// партия, узор, плита — с чего добавили) + комментарий.
//
// Публичная страница /podborka/<code> — права клиента без входа (таблица 9.1):
// витрина камня + наличие словом, без цифр, локаций, цен, клиентов, менеджеров.
// Клиент ставит «Нравится» (анонимно: одна отметка likedAt на камень подборки —
// у ссылки один адресат) и оставляет заявку на конкретный камень (поток H,
// источник «QR / каталог», в заявке — название подборки).
//
// Доступ (§15): владелец — все подборки, менеджер — свои (managerId = actor).
// Ссылка бессрочная; закрытая подборка показывает «Подборка закрыта,
// свяжитесь с менеджером» (камни и заявки не показываются).
//
// Всё, что меняет подборку, — в «Историю» (AuditLog, entityType «Collection»).
// Модуль: чистые правила + функции с db параметром (тесты — mock-БД).

import { randomInt } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { STONE_CODE_ALPHABET, findByCode, type StoneCodeDb } from "./stone-code";
import { clientListScope } from "./clients";
import type { Capabilities } from "./permissions";
import {
  buildCatalogItem,
  loadCatalogFacts,
  CATALOG_TYPE_SELECT,
  type ClientCatalogItem,
} from "./catalog";

// ───────────────────────── Правила ─────────────────────────

export const COLLECTION_CODE_LENGTH = 10;
export const COLLECTION_TITLE_MAX = 120;
export const COLLECTION_COMMENT_MAX = 500;
/** Камней в одной подборке — больше клиенту всё равно не пролистать. */
export const COLLECTION_ITEMS_MAX = 60;

/**
 * Код ссылки: 10 символов из алфавита ONX (без 0/O, 1/I) — 32^10 ≈ 10^15,
 * перебором не угадать. randomInt — криптостойкий источник.
 */
export function generateCollectionCode(rand: (max: number) => number = randomInt): string {
  let out = "";
  for (let i = 0; i < COLLECTION_CODE_LENGTH; i++) {
    out += STONE_CODE_ALPHABET[rand(STONE_CODE_ALPHABET.length)];
  }
  return out;
}

/** Код из ссылки → канонический (верхний регистр) или null. */
export function normalizeCollectionCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toUpperCase();
  if (s.length !== COLLECTION_CODE_LENGTH) return null;
  for (const ch of s) if (!STONE_CODE_ALPHABET.includes(ch)) return null;
  return s;
}

/** Скоуп списка: владелец — все, менеджер — свои, без актёра — ничего. */
export function collectionListScope(args: {
  canSeeAllCollections: boolean;
  actorId: string | null;
}): { managerId?: string } {
  if (args.canSeeAllCollections) return {};
  if (args.actorId) return { managerId: args.actorId };
  return { managerId: "__no_actor__" };
}

type CollectionCaps = Pick<Capabilities, "canManageCollections" | "canSeeAllCollections">;

/** Может ли сотрудник менять эту подборку (свою — менеджер, любую — владелец). */
export function canEditCollection(
  caps: CollectionCaps,
  actorId: string | null,
  c: { managerId: string },
): boolean {
  if (!caps.canManageCollections || !actorId) return false;
  return caps.canSeeAllCollections || c.managerId === actorId;
}

export function cleanTitle(raw: unknown): string {
  return (typeof raw === "string" ? raw : "").trim().replace(/\s+/g, " ").slice(0, COLLECTION_TITLE_MAX);
}

export function cleanComment(raw: unknown): string | null {
  const s = (typeof raw === "string" ? raw : "").trim().slice(0, COLLECTION_COMMENT_MAX);
  return s === "" ? null : s;
}

/** Путь публичной страницы. */
export function collectionPath(code: string): string {
  return `/podborka/${code}`;
}

// ───────────────────────── БД: сотрудник ─────────────────────────

type Actor = { id: string; caps: CollectionCaps };

export type CollectionError =
  | "denied"
  | "notfound"
  | "closed"
  | "title"
  | "client"
  | "stone"
  | "full";

type Db = PrismaClient;

/**
 * Новая подборка. Клиент — только из видимых сотруднику (менеджер — свои,
 * как «Клиенты»). Код уникален; при редком совпадении — новая попытка.
 */
export async function createCollection(
  db: Db,
  args: { actor: Actor; title: unknown; clientId?: string | null; rand?: (max: number) => number },
): Promise<{ ok: true; id: string; code: string } | { ok: false; error: CollectionError }> {
  const { actor } = args;
  if (!actor.caps.canManageCollections) return { ok: false, error: "denied" };
  const title = cleanTitle(args.title);
  if (!title) return { ok: false, error: "title" };

  let client: { id: string; name: string } | null = null;
  const clientId = (args.clientId ?? "").trim();
  if (clientId) {
    client = await db.client.findFirst({
      where: {
        id: clientId,
        ...clientListScope({ canSeeAllClients: actor.caps.canSeeAllCollections, actorId: actor.id }),
      },
      select: { id: true, name: true },
    });
    if (!client) return { ok: false, error: "client" };
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCollectionCode(args.rand);
    try {
      const id = await db.$transaction(async (tx) => {
        const c = await tx.collection.create({
          data: { code, title, clientId: client?.id ?? null, managerId: actor.id },
          select: { id: true },
        });
        await tx.auditLog.create({
          data: {
            userId: actor.id,
            action: "STATUS_CHANGE",
            entityType: "Collection",
            entityId: c.id,
            payload: {
              kind: "collection.create",
              title,
              code,
              clientId: client?.id ?? null,
              clientName: client?.name ?? null,
            } as Prisma.InputJsonValue,
          },
        });
        return c.id;
      });
      return { ok: true, id, code };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
  throw new Error("Не удалось подобрать уникальный код подборки");
}

/** Подборка, которую этот сотрудник может менять (или причина отказа). */
async function editableCollection(
  db: Db,
  actor: Actor,
  collectionId: string,
): Promise<
  | { ok: true; c: { id: string; code: string; title: string; managerId: string; closedAt: Date | null } }
  | { ok: false; error: CollectionError }
> {
  if (!actor.caps.canManageCollections) return { ok: false, error: "denied" };
  const c = await db.collection.findUnique({
    where: { id: collectionId },
    select: { id: true, code: true, title: true, managerId: true, closedAt: true },
  });
  if (!c) return { ok: false, error: "notfound" };
  // Чужая подборка для менеджера — «не найдена» (не раскрываем, что она есть).
  if (!canEditCollection(actor.caps, actor.id, c)) return { ok: false, error: "notfound" };
  return { ok: true, c };
}

/**
 * «В подборку»: камень по коду ONX-… + комментарий. Повторное добавление того
 * же кода — обновляет комментарий (дубля нет: UNIQUE collectionId+stoneCode).
 */
export async function addCollectionItem(
  db: Db,
  args: { actor: Actor; collectionId: string; stoneCode: unknown; comment?: unknown },
): Promise<{ ok: true; itemId: string } | { ok: false; error: CollectionError }> {
  const ed = await editableCollection(db, args.actor, args.collectionId);
  if (!ed.ok) return ed;
  if (ed.c.closedAt) return { ok: false, error: "closed" };
  const hit = await findByCode(db as unknown as StoneCodeDb, String(args.stoneCode ?? ""));
  if (!hit) return { ok: false, error: "stone" };
  const comment = cleanComment(args.comment);

  const [existing, count, stone] = await Promise.all([
    db.collectionItem.findUnique({
      where: { collectionId_stoneCode: { collectionId: ed.c.id, stoneCode: hit.code } },
      select: { id: true },
    }),
    db.collectionItem.count({ where: { collectionId: ed.c.id } }),
    db.stoneType.findUnique({ where: { id: hit.stoneTypeId }, select: { name: true } }),
  ]);
  if (!existing && count >= COLLECTION_ITEMS_MAX) return { ok: false, error: "full" };

  const itemId = await db.$transaction(async (tx) => {
    const item = existing
      ? await tx.collectionItem.update({
          where: { id: existing.id },
          data: { comment },
          select: { id: true },
        })
      : await tx.collectionItem.create({
          data: {
            collectionId: ed.c.id,
            stoneTypeId: hit.stoneTypeId,
            stoneCode: hit.code,
            comment,
            sort: count,
          },
          select: { id: true },
        });
    await tx.auditLog.create({
      data: {
        userId: args.actor.id,
        action: "STATUS_CHANGE",
        entityType: "Collection",
        entityId: ed.c.id,
        payload: {
          kind: "collection.item_add",
          title: ed.c.title,
          stoneCode: hit.code,
          stoneName: stone?.name ?? null,
          comment,
          updated: Boolean(existing),
        } as Prisma.InputJsonValue,
      },
    });
    return item.id;
  });
  return { ok: true, itemId };
}

/** Убрать камень из подборки (только открытой). */
export async function removeCollectionItem(
  db: Db,
  args: { actor: Actor; collectionId: string; itemId: string },
): Promise<{ ok: true } | { ok: false; error: CollectionError }> {
  const ed = await editableCollection(db, args.actor, args.collectionId);
  if (!ed.ok) return ed;
  if (ed.c.closedAt) return { ok: false, error: "closed" };
  const item = await db.collectionItem.findFirst({
    where: { id: args.itemId, collectionId: ed.c.id },
    select: { id: true, stoneCode: true, stoneType: { select: { name: true } } },
  });
  if (!item) return { ok: false, error: "notfound" };
  await db.$transaction(async (tx) => {
    await tx.collectionItem.delete({ where: { id: item.id } });
    await tx.auditLog.create({
      data: {
        userId: args.actor.id,
        action: "STATUS_CHANGE",
        entityType: "Collection",
        entityId: ed.c.id,
        payload: {
          kind: "collection.item_remove",
          title: ed.c.title,
          stoneCode: item.stoneCode,
          stoneName: item.stoneType.name,
        } as Prisma.InputJsonValue,
      },
    });
  });
  return { ok: true };
}

/**
 * Закрыть (closed = true) или открыть снова. Условный updateMany — повторное
 * нажатие ничего не меняет и не пишет второй строки в «Историю».
 */
export async function setCollectionClosed(
  db: Db,
  args: { actor: Actor; collectionId: string; closed: boolean; now?: Date },
): Promise<{ ok: true; changed: boolean } | { ok: false; error: CollectionError }> {
  const ed = await editableCollection(db, args.actor, args.collectionId);
  if (!ed.ok) return ed;
  const now = args.now ?? new Date();
  const changed = await db.$transaction(async (tx) => {
    const res = await tx.collection.updateMany({
      where: { id: ed.c.id, closedAt: args.closed ? null : { not: null } },
      data: { closedAt: args.closed ? now : null },
    });
    if (res.count !== 1) return false;
    await tx.auditLog.create({
      data: {
        userId: args.actor.id,
        action: "STATUS_CHANGE",
        entityType: "Collection",
        entityId: ed.c.id,
        payload: {
          kind: args.closed ? "collection.close" : "collection.reopen",
          title: ed.c.title,
          code: ed.c.code,
        } as Prisma.InputJsonValue,
      },
    });
    return true;
  });
  return { ok: true, changed };
}

export interface CollectionListRow {
  id: string;
  code: string;
  title: string;
  clientId: string | null;
  clientName: string | null;
  managerName: string;
  closedAt: Date | null;
  createdAt: Date;
  items: number;
  likes: number;
}

/** «Мои подборки» / подборки клиента — в скоупе сотрудника, новые сверху. */
export async function listCollections(
  db: Db,
  args: {
    caps: Pick<Capabilities, "canSeeAllCollections">;
    actorId: string | null;
    clientId?: string;
    onlyOpen?: boolean;
    take?: number;
  },
): Promise<CollectionListRow[]> {
  const rows = await db.collection.findMany({
    where: {
      ...collectionListScope({ canSeeAllCollections: args.caps.canSeeAllCollections, actorId: args.actorId }),
      ...(args.clientId ? { clientId: args.clientId } : {}),
      ...(args.onlyOpen ? { closedAt: null } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: args.take ?? 200,
    select: {
      id: true,
      code: true,
      title: true,
      clientId: true,
      closedAt: true,
      createdAt: true,
      client: { select: { name: true } },
      manager: { select: { name: true } },
      items: { select: { likedAt: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    title: r.title,
    clientId: r.clientId,
    clientName: r.client?.name ?? null,
    managerName: r.manager.name,
    closedAt: r.closedAt,
    createdAt: r.createdAt,
    items: r.items.length,
    likes: r.items.filter((i) => i.likedAt !== null).length,
  }));
}

export interface StaffCollectionItem {
  id: string;
  stoneCode: string;
  stoneTypeId: string;
  stoneName: string;
  rockType: string;
  color: string | null;
  comment: string | null;
  likedAt: Date | null;
}

export interface StaffCollection {
  id: string;
  code: string;
  title: string;
  clientId: string | null;
  clientName: string | null;
  managerId: string;
  managerName: string;
  closedAt: Date | null;
  createdAt: Date;
  items: StaffCollectionItem[];
}

/** Подборка для сотрудника (с отметками «Нравится»); чужая менеджеру — null. */
export async function loadStaffCollection(
  db: Db,
  args: { id: string; caps: CollectionCaps; actorId: string | null },
): Promise<StaffCollection | null> {
  if (!args.caps.canManageCollections) return null;
  const c = await db.collection.findFirst({
    where: {
      id: args.id,
      ...collectionListScope({ canSeeAllCollections: args.caps.canSeeAllCollections, actorId: args.actorId }),
    },
    select: {
      id: true,
      code: true,
      title: true,
      clientId: true,
      managerId: true,
      closedAt: true,
      createdAt: true,
      client: { select: { name: true } },
      manager: { select: { name: true } },
      items: {
        orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          stoneCode: true,
          stoneTypeId: true,
          comment: true,
          likedAt: true,
          stoneType: { select: { name: true, rockType: true, color: true } },
        },
      },
    },
  });
  if (!c) return null;
  return {
    id: c.id,
    code: c.code,
    title: c.title,
    clientId: c.clientId,
    clientName: c.client?.name ?? null,
    managerId: c.managerId,
    managerName: c.manager.name,
    closedAt: c.closedAt,
    createdAt: c.createdAt,
    items: c.items.map((i) => ({
      id: i.id,
      stoneCode: i.stoneCode,
      stoneTypeId: i.stoneTypeId,
      stoneName: i.stoneType.name,
      rockType: i.stoneType.rockType,
      color: i.stoneType.color,
      comment: i.comment,
      likedAt: i.likedAt,
    })),
  };
}

// ───────────────────────── БД: публичная страница ─────────────────────────

/** Камень на публичной подборке — поля клиента (9.1) + комментарий и отметка. */
export interface PublicCollectionItem {
  id: string;
  /** Код, с которого добавили: ссылка на /k/<code>. */
  code: string;
  stone: ClientCatalogItem;
  comment: string | null;
  liked: boolean;
}

export type PublicCollection =
  | { status: "notfound" }
  | { status: "closed"; code: string; title: string }
  | { status: "open"; code: string; title: string; items: PublicCollectionItem[] };

/**
 * Подборка глазами клиента. Явный список полей: ни клиента, ни менеджера, ни
 * цифр остатка — только то, что клиент видит на карточке /k (вид «client»).
 * Камни показываются, даже если вид скрыт из каталога: их выбрал менеджер.
 */
export async function loadPublicCollection(
  db: Db,
  rawCode: unknown,
  now: Date = new Date(),
): Promise<PublicCollection> {
  const code = normalizeCollectionCode(rawCode);
  if (!code) return { status: "notfound" };
  const c = await db.collection.findUnique({
    where: { code },
    select: {
      code: true,
      title: true,
      closedAt: true,
      items: {
        orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
        take: COLLECTION_ITEMS_MAX,
        select: {
          id: true,
          stoneCode: true,
          comment: true,
          likedAt: true,
          stoneType: { select: CATALOG_TYPE_SELECT },
        },
      },
    },
  });
  if (!c) return { status: "notfound" };
  if (c.closedAt) return { status: "closed", code: c.code, title: c.title };

  const types = [...new Map(c.items.map((i) => [i.stoneType.id, i.stoneType])).values()];
  const facts = new Map((await loadCatalogFacts(db, types, now)).map((f) => [f.stoneTypeId, f]));
  const items: PublicCollectionItem[] = [];
  for (const i of c.items) {
    const f = facts.get(i.stoneType.id);
    if (!f) continue;
    items.push({
      id: i.id,
      code: i.stoneCode,
      stone: buildCatalogItem(f, "client") as ClientCatalogItem,
      comment: i.comment,
      liked: i.likedAt !== null,
    });
  }
  return { status: "open", code: c.code, title: c.title, items };
}

export type LikeResult =
  | { status: "ok"; liked: boolean }
  | { status: "notfound" }
  | { status: "closed" };

/**
 * «Нравится» на публичной подборке (без входа). Переключатель: отметка есть —
 * снимаем, нет — ставим. Только открытая подборка и только её камень.
 * В «Историю» — от имени клиента (userId = NULL).
 */
export async function toggleCollectionLike(
  db: Db,
  args: { code: unknown; itemId: unknown; now?: Date },
): Promise<LikeResult> {
  const code = normalizeCollectionCode(args.code);
  const itemId = typeof args.itemId === "string" ? args.itemId.trim() : "";
  if (!code || !itemId) return { status: "notfound" };
  const now = args.now ?? new Date();
  const c = await db.collection.findUnique({
    where: { code },
    select: { id: true, title: true, closedAt: true },
  });
  if (!c) return { status: "notfound" };
  if (c.closedAt) return { status: "closed" };
  const item = await db.collectionItem.findFirst({
    where: { id: itemId, collectionId: c.id },
    select: { id: true, likedAt: true, stoneCode: true, stoneType: { select: { name: true } } },
  });
  if (!item) return { status: "notfound" };
  const liked = item.likedAt === null;
  await db.$transaction(async (tx) => {
    await tx.collectionItem.update({
      where: { id: item.id },
      data: { likedAt: liked ? now : null },
    });
    await tx.auditLog.create({
      data: {
        userId: null,
        action: "STATUS_CHANGE",
        entityType: "Collection",
        entityId: c.id,
        payload: {
          kind: liked ? "collection.like" : "collection.unlike",
          title: c.title,
          stoneCode: item.stoneCode,
          stoneName: item.stoneType.name,
        } as Prisma.InputJsonValue,
      },
    });
  });
  return { status: "ok", liked };
}

/**
 * Заявка со страницы подборки: подборка открыта и камень в ней есть → контекст
 * для заявки (название и код подборки), иначе null — заявку не принимаем.
 */
export async function collectionLeadContext(
  db: Pick<PrismaClient, "collection">,
  args: { collectionCode: unknown; stoneCode: string },
): Promise<{ collectionCode: string; collectionTitle: string } | null> {
  const code = normalizeCollectionCode(args.collectionCode);
  if (!code) return null;
  const c = await db.collection.findUnique({
    where: { code },
    select: {
      code: true,
      title: true,
      closedAt: true,
      items: { where: { stoneCode: args.stoneCode }, select: { id: true }, take: 1 },
    },
  });
  if (!c || c.closedAt || c.items.length === 0) return null;
  return { collectionCode: c.code, collectionTitle: c.title };
}
