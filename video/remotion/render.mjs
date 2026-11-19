// ТЗ №21 Б — пересборка видео одной командой:
//   npm run video:build -- vladelets      (из корня репозитория)
// Шаги: данные (titры + скриншоты + длительность голоса) → рендер MP4 H.264 30 fps.
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const NAMES = { vladelets: "onyx-vladelets", menedzher: "onyx-menedzher", zavsklad: "onyx-zavsklad" };
const role = process.argv[2];
if (!NAMES[role]) {
  console.error("Роль: vladelets | menedzher | zavsklad");
  process.exit(2);
}
const run = (cmd, args) => execFileSync(cmd, args, { cwd: here, stdio: "inherit" });
run("node", ["build-data.mjs", role]);
const out = join(here, "out", `${NAMES[role]}.mp4`);
run("npx", ["remotion", "render", "src/index.ts", role, out, "--codec=h264", "--crf=24", "--audio-bitrate=128k", "--log=error"]);
const mb = statSync(out).size / 1024 / 1024;
console.log(`Готово: ${out} — ${mb.toFixed(1)} МБ${mb > 50 ? " (больше 50 МБ — поднимите --crf)" : ""}`);
