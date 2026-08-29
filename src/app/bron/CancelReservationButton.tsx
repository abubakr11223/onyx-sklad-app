"use client";

// «Снять бронь» через модал-подтверждение (вместо инлайн-<details>). Серверный
// action приходит пропом (стандартный паттерн server action → client).
//
// W3-T1: раньше тост «Бронь снята» показывался в onSubmit — ДО ответа сервера.
// При отказе (чужая бронь, нет доступа) менеджер видел зелёный «снята» и рядом
// красную ошибку. Успех подтверждает только сервер: redirect /bron?cancelled=1
// рисует баннер на странице. Здесь остаётся лишь состояние «идёт снятие».
import { useState } from "react";
import { useFormStatus } from "react-dom";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";

/** Кнопки внутри <form> — useFormStatus виден только потомкам формы. */
function CancelActions({ onClose }: { onClose: () => void }) {
  const { pending } = useFormStatus();
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className="flex-1"
        disabled={pending}
        onClick={onClose}
      >
        Отмена
      </Button>
      <Button
        type="submit"
        variant="danger"
        className="flex-1"
        disabled={pending}
      >
        {pending ? "Снятие…" : "Да, снять"}
      </Button>
    </>
  );
}

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
        <form action={action} className="mt-5 flex gap-2.5">
          <input type="hidden" name="reservationId" value={reservationId} />
          <CancelActions onClose={() => setOpen(false)} />
        </form>
      </Modal>
    </>
  );
}
