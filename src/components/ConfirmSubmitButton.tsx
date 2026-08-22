"use client";

// ТЗ №18 §9.2 — подтверждение деструктивного действия на карте склада.
//
// Кнопки «Удалить блок» и «Убрать» (ориентир) стояли голыми: один промах мышью
// — и разметка исчезала. Серверные запреты (нельзя удалить блок/ориентир с
// камнем) остаются главной защитой ДАННЫХ; этот диалог закрывает другой риск —
// случайный клик по пустому блоку, который зав. складом размечал полдня.
//
// Нативный confirm(), а не собственная модалка: склад работает с телефона на
// слабой сети, системный диалог не зависит от загрузки стилей и не может
// «залипнуть» полупрозрачным слоем поверх формы.

import Button, { type ButtonSize, type ButtonVariant } from "@/components/ui/Button";
import type { ReactNode } from "react";

export default function ConfirmSubmitButton({
  message,
  children,
  variant = "danger",
  size = "sm",
  className,
  disabled,
  title,
}: {
  /** Текст диалога — обязан называть, ЧТО именно удаляется. */
  message: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      className={className}
      disabled={disabled}
      title={title}
      onClick={(ev) => {
        if (!window.confirm(message)) ev.preventDefault();
      }}
    >
      {children}
    </Button>
  );
}
