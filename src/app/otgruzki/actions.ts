"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCapabilities, currentActorId } from "@/lib/session";
import { confirmShipment, ShipmentError } from "@/lib/shipments";
import { strOf } from "@/lib/form";

export async function confirmShipmentAction(formData: FormData): Promise<void> {
  const caps = await getCapabilities();
  if (!caps.canConfirmShipment) {
    redirect(
      "/otgruzki?err=" +
        encodeURIComponent("Нет доступа: отгрузку подтверждает склад"),
    );
  }
  const actorId = await currentActorId();
  if (!actorId) {
    redirect("/otgruzki?err=" + encodeURIComponent("Нет пользователя"));
  }
  const str = strOf(formData);
  const shipmentId = str("shipmentId");
  if (!shipmentId) {
    redirect("/otgruzki?err=" + encodeURIComponent("Не указана отгрузка"));
  }
  const qtySlabsRaw = str("qtySlabs");
  const qtyAreaRaw = str("qtyAreaM2");
  const qtySlabs = qtySlabsRaw
    ? Number(qtySlabsRaw.replace(/\s/g, ""))
    : null;
  const qtyAreaM2 = qtyAreaRaw
    ? Number(qtyAreaRaw.replace(/\s/g, "").replace(",", "."))
    : null;

  try {
    await confirmShipment({
      shipmentId,
      actorId,
      qtySlabs,
      qtyAreaM2,
    });
  } catch (e) {
    const msg =
      e instanceof ShipmentError
        ? e.message
        : "Не удалось подтвердить отгрузку";
    redirect("/otgruzki?err=" + encodeURIComponent(msg));
  }
  revalidatePath("/otgruzki");
  revalidatePath("/prodazha");
  redirect("/otgruzki?ok=shipped");
}
