// ТЗ №21 Б — собирает данные для видео одной роли.
//
//   node build-data.mjs vladelets
//
// Источники:
//   docs/video/texts.uz.json                — титры и текст диктора
//   video/captures/<role>/manifest.json     — скриншоты (npm run video:capture)
//   video/remotion/public/audio/<role>/*.mp3 — голос (ElevenLabs), имена: intro, 1-1 …, outro
// Результат: video/remotion/src/data/<role>.json + копии картинок в public/.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const FPS = 30;

const FORMATS = {
  vladelets: { width: 1920, height: 1080, device: "browser" },
  menedzher: { width: 1920, height: 1080, device: "browser" },
  zavsklad: { width: 1080, height: 1920, device: "phone" },
};

const role = process.argv[2];
if (!FORMATS[role]) {
  console.error("Роль: vladelets | menedzher | zavsklad");
  process.exit(2);
}

const texts = JSON.parse(readFileSync(join(repo, "docs/video/texts.uz.json"), "utf8")).videos[role];
const capDir = join(repo, "video/captures", role);
const manifestPath = join(capDir, "manifest.json");
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;
const audioDir = join(here, "public/audio", role);

// Публичные ассеты: фото камней (фон) и логотип.
mkdirSync(join(here, "public/stones"), { recursive: true });
for (const f of readdirSync(join(repo, "video/assets/stones"))) {
  if (f.endsWith(".jpg")) cpSync(join(repo, "video/assets/stones", f), join(here, "public/stones", f));
}
cpSync(join(repo, "public/logo/onyx-sphere.jpg"), join(here, "public/logo.jpg"));
if (manifest) {
  mkdirSync(join(here, "public/captures", role), { recursive: true });
  for (const f of readdirSync(capDir)) {
    if (f.endsWith(".png")) cpSync(join(capDir, f), join(here, "public/captures", role, f));
  }
}

function audioSec(name) {
  const p = join(audioDir, `${name}.mp3`);
  if (!existsSync(p)) return null;
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]);
  return Number(String(out).trim());
}

const frames = (sec) => Math.round(sec * FPS);
const findShot = (scene, step) =>
  manifest?.steps.find((s) => Number(s.scene) === scene && Number(s.step) === step) ?? null;

const segments = [];
const introSec = audioSec("intro");
segments.push({
  type: "intro",
  title: texts.intro.title,
  subtitle: texts.intro.subtitle,
  audio: introSec ? `audio/${role}/intro.mp3` : null,
  frames: frames(Math.max(4, (introSec ?? 3) + 0.8)),
});

const missing = [];
texts.scenes.forEach((scene, i) => {
  const n = i + 1;
  segments.push({ type: "scene", n, total: texts.scenes.length, title: scene.title, frames: frames(2.2) });
  for (const st of scene.steps) {
    const key = `${n}-${st.n}`;
    const sec = audioSec(key);
    const shot = findShot(n, st.n);
    if (!shot) missing.push(key);
    segments.push({
      type: "step",
      key,
      scene: n,
      sceneTotal: texts.scenes.length,
      sceneTitle: scene.title,
      caption: st.caption,
      audio: sec ? `audio/${role}/${key}.mp3` : null,
      // Пауза после фразы, чтобы глаз успел прочитать титр; шаг с результатом — дольше.
      frames: frames(Math.max(shot?.after ? 5.2 : 3.4, (sec ?? 3) + 1.0)),
      image: shot ? `captures/${role}/${shot.file}` : null,
      highlights: shot?.highlights ?? [],
      click: shot?.click ?? null,
      after: shot?.after ? { image: `captures/${role}/${shot.after.file}`, highlights: shot.after.highlights ?? [] } : null,
    });
  }
});

const outroSec = audioSec("outro");
segments.push({
  type: "outro",
  title: "Rahmat!",
  subtitle: texts.intro.title,
  audio: outroSec ? `audio/${role}/outro.mp3` : null,
  frames: frames(Math.max(4, (outroSec ?? 3) + 1.2)),
});

const data = {
  role,
  fps: FPS,
  ...FORMATS[role],
  viewport: manifest?.viewport ?? (FORMATS[role].device === "phone" ? { w: 390, h: 844, scale: 3 } : { w: 1440, h: 900, scale: 2 }),
  // Чёрный гранит в размытом фоне выглядит серым пятном — не берём.
  stones: readdirSync(join(here, "public/stones")).filter((f) => f.endsWith(".jpg") && !f.startsWith("granit")).map((f) => `stones/${f}`),
  segments,
  durationInFrames: segments.reduce((a, s) => a + s.frames, 0),
};

mkdirSync(join(here, "src/data"), { recursive: true });
writeFileSync(join(here, "src/data", `${role}.json`), JSON.stringify(data, null, 2));
console.log(
  `${role}: ${segments.length} сегментов, ${(data.durationInFrames / FPS).toFixed(1)} с` +
    (missing.length ? `; нет скриншотов: ${missing.join(", ")}` : ""),
);
