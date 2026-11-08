"use client";

// ТЗ №20 J (§11.2) — загрузка «Текстуры для 3D» на узор / партию.
// На Vercel оригинал (5–25 МБ) уходит из браузера прямо в Blob (лимит функции
// 4,5 МБ), затем action делает превью и проверки. На своём сервере — формой.
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import Button from "@/components/ui/Button";
import {
  saveUploadedTexture,
  uploadTextureFile,
  type TextureActionResult,
} from "../texture-actions";

export default function TextureUploader({
  code,
  mode,
  hasTexture,
}: {
  code: string;
  mode: "direct" | "form";
  hasTexture: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(null);

  async function onFile(file: File) {
    setMsg(null);
    if (file.type !== "image/jpeg") {
      setMsg({ kind: "err", text: "Нужен файл JPG." });
      return;
    }
    setBusy(true);
    try {
      let res: TextureActionResult;
      if (mode === "direct") {
        const blob = await upload(`textures/uploads/${code}/original.jpg`, file, {
          access: "public",
          handleUploadUrl: "/api/texture-upload",
          contentType: "image/jpeg",
          multipart: file.size > 8 * 1024 * 1024,
        });
        res = await saveUploadedTexture({ code, blobUrl: blob.url });
      } else {
        const fd = new FormData();
        fd.set("code", code);
        fd.set("file", file);
        res = await uploadTextureFile(fd);
      }
      if (!res.ok) {
        setMsg({ kind: "err", text: res.error });
      } else {
        const size = `${res.widthPx} × ${res.heightPx} px`;
        setMsg(
          res.warning
            ? { kind: "warn", text: `Сохранено (${size}). ${res.warning}` }
            : { kind: "ok", text: `Сохранено: ${size}.` },
        );
        router.refresh();
      }
    } catch (err) {
      console.error(err);
      setMsg({ kind: "err", text: "Не удалось загрузить файл — проверьте связь и попробуйте ещё раз." });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        ref={input}
        type="file"
        accept="image/jpeg"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
        }}
      />
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {busy ? "Загрузка…" : hasTexture ? "Заменить текстуру" : "Загрузить текстуру"}
      </Button>
      {msg && (
        <p
          role="status"
          className={
            "text-xs " +
            (msg.kind === "err"
              ? "text-danger"
              : msg.kind === "warn"
                ? "text-warning"
                : "text-success")
          }
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}
