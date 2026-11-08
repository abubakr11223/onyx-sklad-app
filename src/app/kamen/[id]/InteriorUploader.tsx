"use client";

// ТЗ №20 J (§11.1) — загрузка фото «В интерьере» (до 10 на вид). Перед
// отправкой браузер ужимает каждое фото до 2560 px JPEG: телефонный снимок
// 8–12 МБ иначе не пролезет в лимит запроса к функции (4,5 МБ на Vercel).
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import { uploadInteriorPhotos } from "../texture-actions";

const MAX_SIDE = 2560;
/** Запас под лимит запроса: все фото одной отправки вместе. */
const MAX_BATCH_BYTES = 4 * 1024 * 1024;

async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  for (const q of [0.85, 0.75, 0.6]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", q));
    if (blob && (blob.size < 1.8 * 1024 * 1024 || q === 0.6)) return blob;
  }
  throw new Error("encode");
}

export default function InteriorUploader({
  stoneTypeId,
  remaining,
}: {
  stoneTypeId: string;
  remaining: number;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function onFiles(list: FileList) {
    setErr(null);
    setOk(null);
    const files = [...list].filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;
    if (files.length > remaining) {
      setErr(`Можно добавить ещё ${remaining} фото (всего не больше 10).`);
      return;
    }
    setBusy(true);
    try {
      const blobs = await Promise.all(files.map(shrink));
      // Партиями, чтобы каждый запрос был меньше лимита.
      const batches: Blob[][] = [];
      let cur: Blob[] = [];
      let size = 0;
      for (const b of blobs) {
        if (cur.length > 0 && size + b.size > MAX_BATCH_BYTES) {
          batches.push(cur);
          cur = [];
          size = 0;
        }
        cur.push(b);
        size += b.size;
      }
      if (cur.length > 0) batches.push(cur);
      let saved = 0;
      for (const batch of batches) {
        const fd = new FormData();
        fd.set("stoneTypeId", stoneTypeId);
        batch.forEach((b, i) =>
          fd.append("photos", new File([b], `interior-${i}.jpg`, { type: "image/jpeg" })),
        );
        const res = await uploadInteriorPhotos(fd);
        saved += res.saved;
        if (!res.ok) {
          setErr(res.error);
          break;
        }
      }
      if (saved > 0) {
        setOk(`Добавлено фото: ${saved}.`);
        router.refresh();
      }
    } catch {
      setErr("Не удалось подготовить фото — попробуйте другой файл.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  const working = busy;
  return (
    <div className="mt-3 flex flex-col gap-1">
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => e.target.files && void onFiles(e.target.files)}
      />
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={working || remaining <= 0}
        onClick={() => input.current?.click()}
        className="self-start"
      >
        {working ? "Загрузка…" : remaining <= 0 ? "Уже 10 фото" : "Добавить фото"}
      </Button>
      {ok && (
        <p role="status" className="text-xs text-success">
          {ok}
        </p>
      )}
      {err && (
        <p role="alert" className="text-xs text-danger">
          {err}
        </p>
      )}
    </div>
  );
}
