"use client";

// ТЗ №20 I (§10.3) — «Скопировать ссылку» и «Поделиться» для подборки.
// «Поделиться» — системное меню телефона (navigator.share: Telegram, WhatsApp);
// где его нет (десктоп) — копирует ссылку, как первая кнопка. Ссылка
// собирается от текущего адреса сайта: путь /podborka/<код> приходит пропом.

import { useState } from "react";
import Button from "@/components/ui/Button";

export default function ShareButtons({
  path,
  title,
  t,
}: {
  path: string;
  title: string;
  t: { copyLink: string; linkCopied: string; share: string };
}) {
  const [copied, setCopied] = useState(false);

  const url = () => new URL(path, window.location.origin).toString();

  async function copy() {
    const link = url();
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Без доступа к буферу (старый браузер / http) — даём выделить вручную.
      window.prompt(t.copyLink, link);
    }
  }

  async function share() {
    const link = url();
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url: link });
        return;
      } catch (e) {
        // Пользователь закрыл меню — это не ошибка.
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    await copy();
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Button variant="secondary" onClick={copy} className="w-full sm:w-auto">
        {t.copyLink}
      </Button>
      <Button variant="secondary" onClick={share} className="w-full sm:w-auto">
        {t.share}
      </Button>
      <span role="status" aria-live="polite" className="text-sm font-medium text-success">
        {copied ? t.linkCopied : ""}
      </span>
    </div>
  );
}
