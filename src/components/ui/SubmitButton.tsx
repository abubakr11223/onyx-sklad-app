"use client";

// Кнопка отправки обычной <form action={serverAction}>: пока форма уходит —
// спиннер 14px и блокировка (ТЗ №20 §7.1, защита от двойного тапа). Логика
// отправки не меняется: это та же <button type="submit">, только знает
// pending через useFormStatus (виден лишь потомкам <form>).

import { useFormStatus } from "react-dom";
import Button, { type ButtonSize, type ButtonVariant } from "./Button";
import type { ButtonHTMLAttributes } from "react";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export default function SubmitButton(props: Props) {
  const { pending } = useFormStatus();
  return <Button type="submit" pending={pending} {...props} />;
}
