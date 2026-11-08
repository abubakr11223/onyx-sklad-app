"use client";

// ТЗ №20 K (§12.2–12.3) — «Спросить ИИ» и «Найти по фото».
// Фото ужимается в браузере до 1600 px JPEG: телефонный снимок 8–12 МБ иначе
// не пролезет в лимит запроса к функции, а модели больше и не нужно.
import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { aiPhotoSearchAction, aiTextSearchAction } from "@/app/katalog/ai-actions";
import Button from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";

export interface AiSearchLabels {
  title: string;
  placeholder: string;
  submit: string;
  thinking: string;
  photo: string;
  photoHint: string;
  photoBad: string;
}

const MAX_SIDE = 1600;
const MAX_INPUT_BYTES = 10 * 1024 * 1024;

async function shrink(file: File): Promise<File> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  if (!blob) throw new Error("encode");
  return new File([blob], "search.jpg", { type: "image/jpeg" });
}

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="shrink-0">
      {pending ? busy : label}
    </Button>
  );
}

export default function AiSearchBox({
  labels,
  defaultQuery = "",
}: {
  labels: AiSearchLabels;
  defaultQuery?: string;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onPhoto(file: File) {
    setErr(null);
    if (!file.type.startsWith("image/") || file.size > MAX_INPUT_BYTES) {
      setErr(labels.photoBad);
      return;
    }
    setBusy(true);
    try {
      const small = await shrink(file);
      const fd = new FormData();
      fd.set("photo", small);
      await aiPhotoSearchAction(fd); // redirect → страница каталога с результатом
    } catch (e) {
      // redirect() из server action приходит как исключение навигации — не ошибка.
      if ((e as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw e;
      setErr(labels.photoBad);
      setBusy(false);
    }
  }

  return (
    <section className="mb-4 rounded-card border border-gold/40 bg-gold/5 p-4" aria-label={labels.title}>
      <form action={aiTextSearchAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-semibold text-ink">
          ✦ {labels.title}
          <input
            name="ai"
            defaultValue={defaultQuery}
            maxLength={300}
            placeholder={labels.placeholder}
            className={inputClass}
          />
        </label>
        <Submit label={labels.submit} busy={labels.thinking} />
      </form>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onPhoto(f);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          {busy ? labels.thinking : `📷 ${labels.photo}`}
        </Button>
        <span className="text-xs text-ink/55">{labels.photoHint}</span>
      </div>
      {err && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {err}
        </p>
      )}
    </section>
  );
}
