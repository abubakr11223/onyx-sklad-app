// Debug helper: draws manifest highlight boxes (honey) and click points (red)
// onto reduced JPG copies of the captures, to eyeball box accuracy.
//   npx tsx video/overlay-debug.ts <role> <outDir>
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { CAPTURES_DIR } from "./video-env";

type Box = { x: number; y: number; w: number; h: number };
type F = { file: string; highlights: Box[]; click: { x: number; y: number } | null };

(async () => {
  const [role, out] = process.argv.slice(2);
  const dir = join(CAPTURES_DIR, role);
  const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  const { w, h, scale } = m.viewport;
  for (const s of m.steps) {
    for (const f of [s, s.after].filter(Boolean) as F[]) {
      const rects = f.highlights
        .map((b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="none" stroke="#e0a526" stroke-width="3"/>`)
        .join("");
      const dot = f.click ? `<circle cx="${f.click.x}" cy="${f.click.y}" r="9" fill="#e0263a" opacity="0.8"/>` : "";
      const svg = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}" viewBox="0 0 ${w} ${h}">${rects}${dot}</svg>`,
      );
      const composed = await sharp(join(dir, f.file)).composite([{ input: svg }]).png().toBuffer();
      await sharp(composed)
        .resize(Math.round(w * 0.75))
        .jpeg({ quality: 72 })
        .toFile(join(out, f.file.replace(".png", ".jpg")));
    }
  }
})();
