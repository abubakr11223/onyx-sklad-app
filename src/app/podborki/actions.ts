"use server";

// ТЗ №20 I (§10.3) — действия сотрудника с подборками. Правила и запись — в
// src/lib/collections.ts; здесь только форма, кто нажал и куда вернуть.
// Право — canManageCollections (OWNER / MANAGER) по сессии; менеджер меняет
// только свои подборки (canEditCollection), владелец — любые.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { capabilitiesFor } from "@/lib/permissions";
import {
  addCollectionItem,
  createCollection,
  removeCollectionItem,
  setCollectionClosed,
} from "@/lib/collections";
import { normalizeStoneCode } from "@/lib/stone-code";

async function actor() {
  const me = await getCurrentUser();
  if (!me) return null;
  const caps = capabilitiesFor(me.role, { canSeePurchasePrice: me.canSeePurchasePrice });
  if (!caps.canManageCollections) return null;
  return { id: me.id, caps };
}

const NEW = "__new__";

/** «В подборку»: в выбранную открытую подборку или в новую (название + клиент). */
export async function addToCollectionAction(formData: FormData): Promise<void> {
  const code = normalizeStoneCode(String(formData.get("code") ?? "")) ?? "";
  const formBack = `/podborki/dobavit?code=${encodeURIComponent(code)}`;
  const a = await actor();
  if (!a) redirect(`${formBack}&err=denied`);

  let collectionId = String(formData.get("collectionId") ?? "").trim();
  if (!collectionId) redirect(`${formBack}&err=pick`);
  if (collectionId === NEW) {
    const created = await createCollection(db, {
      actor: a!,
      title: formData.get("title"),
      clientId: String(formData.get("clientId") ?? ""),
    });
    if (!created.ok) redirect(`${formBack}&err=${created.error}`);
    collectionId = created.id;
  }
  const r = await addCollectionItem(db, {
    actor: a!,
    collectionId,
    stoneCode: code,
    comment: formData.get("comment"),
  });
  if (!r.ok) redirect(`${formBack}&err=${r.error}`);
  revalidatePath("/podborki");
  redirect(`/podborki/${collectionId}?ok=added`);
}

/** Новая пустая подборка со страницы «Подборки». */
export async function createCollectionAction(formData: FormData): Promise<void> {
  const a = await actor();
  if (!a) redirect("/podborki?err=denied");
  const r = await createCollection(db, {
    actor: a!,
    title: formData.get("title"),
    clientId: String(formData.get("clientId") ?? ""),
  });
  if (!r.ok) redirect(`/podborki?err=${r.error}`);
  revalidatePath("/podborki");
  redirect(`/podborki/${r.id}?ok=created`);
}

/** Закрыть / открыть снова (closed = "1" / "0"). */
export async function setCollectionClosedAction(formData: FormData): Promise<void> {
  const id = String(formData.get("collectionId") ?? "");
  const closed = String(formData.get("closed") ?? "") === "1";
  const back = `/podborki/${encodeURIComponent(id)}`;
  const a = await actor();
  if (!a) redirect(`${back}?err=denied`);
  const r = await setCollectionClosed(db, { actor: a!, collectionId: id, closed });
  if (!r.ok) redirect(`${back}?err=${r.error}`);
  revalidatePath("/podborki");
  revalidatePath(back);
  redirect(`${back}?ok=${closed ? "closed" : "reopened"}`);
}

/** Убрать камень из открытой подборки. */
export async function removeCollectionItemAction(formData: FormData): Promise<void> {
  const id = String(formData.get("collectionId") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  const back = `/podborki/${encodeURIComponent(id)}`;
  const a = await actor();
  if (!a) redirect(`${back}?err=denied`);
  const r = await removeCollectionItem(db, { actor: a!, collectionId: id, itemId });
  if (!r.ok) redirect(`${back}?err=${r.error}`);
  revalidatePath(back);
  redirect(`${back}?ok=removed`);
}
