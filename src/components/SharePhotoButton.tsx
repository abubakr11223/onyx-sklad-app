"use client";

// §6.1 шаг 7 — менеджер передаёт фото клиенту из системы (без мессенджера).
// /api/photo/[id] — открытый GET (только байты картинки, без остатков/цен).
// Web Share (моб.) → fallback: копирование абсолютной ссылки в буфер.

import { useState } from "react";

type Status = "idle" | "copied" | "shared" | "err";

export default function SharePhotoButton({
  photoId,
  title,
}: {
  photoId: string;
  /** Подпись для Web Share (напр. «Травертин Classic — Плита №2»). */
  title: string;
}) {
  const [status, setStatus] = useState<Status>("idle");

  function absoluteUrl(): string {
    return `${window.location.origin}/api/photo/${photoId}`;
  }

  async function copyLink(url: string): Promise<boolean> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        return true;
      }
    } catch {
      /* fall through */
    }
    // Старый Safari / insecure context: временный input + execCommand.
    try {
      const input = document.createElement("input");
      input.value = url;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(input);
      return ok;
    } catch {
      return false;
    }
  }

  async function onShare(): Promise<void> {
    const url = absoluteUrl();

    // Web Share — «переслать» на телефоне (WhatsApp / Telegram / …).
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text: title, url });
        setStatus("shared");
        window.setTimeout(() => setStatus("idle"), 2000);
        return;
      } catch (e) {
        // Пользователь отменил — молча; иначе fallback на копирование.
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }

    const ok = await copyLink(url);
    if (ok) {
      setStatus("copied");
      window.setTimeout(() => setStatus("idle"), 2000);
    } else {
      setStatus("err");
      window.setTimeout(() => setStatus("idle"), 2500);
    }
  }

  const label =
    status === "copied"
      ? "Ссылка скопирована"
      : status === "shared"
        ? "Отправлено"
        : status === "err"
          ? "Не удалось"
          : "Клиенту";

  return (
    <button
      type="button"
      onClick={() => void onShare()}
      className="max-w-[4.5rem] truncate text-left text-[11px] font-medium leading-tight text-gold-deep hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-1 focus-visible:ring-offset-paper"
      title={
        status === "idle"
          ? "Поделиться фото с клиентом (ссылка)"
          : undefined
      }
      aria-label={
        status === "idle"
          ? `Отправить клиенту фото: ${title}`
          : label
      }
    >
      {label}
    </button>
  );
}
