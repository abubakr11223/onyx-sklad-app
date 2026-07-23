"use client";

// «Снять бронь» через модал-подтверждение (вместо инлайн-<details>). Серверный
// action приходит пропом (стандартный паттерн server action → client). На отправке
// показываем тост; сам action делает revalidate — бронь уходит из списка.
import { useState } from "react";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import { toast } from "@/components/ui/toast";

export default function CancelReservationButton({
  reservationId,
  label,
  action,
}: {
  reservationId: string;
  label: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="danger" size="sm" className="mt-3" onClick={() => setOpen(true)}>
        Снять бронь…
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title="Снять бронь?">
        <p className="text-sm text-ink/70">
          Камень <span className="font-medium text-ink">«{label}»</span> вернётся
          «В наличии». Отменить это нельзя.
        </p>
        <form
          action={action}
          onSubmit={() => {
            toast("Бронь снята", "success");
            setOpen(false);
          }}
          className="mt-5 flex gap-2.5"
        >
          <input type="hidden" name="reservationId" value={reservationId} />
          <Button
            type="button"
            variant="ghost"
            className="flex-1"
            onClick={() => setOpen(false)}
          >
            Отмена
          </Button>
          <Button type="submit" variant="danger" className="flex-1">
            Да, снять
          </Button>
        </form>
      </Modal>
    </>
  );
}
