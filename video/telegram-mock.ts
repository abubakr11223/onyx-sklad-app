// ТЗ №21 Б — кадры Telegram-бота для видео зав. складом (шаги 4-5, 5-1, 5-2).
//
//   npm run video:telegram        (capture.ts zavsklad вызывает сам в конце)
//
// Настоящий Telegram на стенде не снять, поэтому чат рисуется здесь как HTML
// и снимается тем же Playwright в том же размере (390×844 @3x). Тексты бота —
// ТЕ ЖЕ, что в коде: buildTaskText (src/lib/photo-requests.ts) и сообщения
// src/lib/telegram-webhook.ts. Поменялся текст в боте — поменяйте и здесь.
// Результат: video/captures/zavsklad/{4-5,5-1,5-2}*.png + записи в manifest.json.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { buildTaskText } from "../src/lib/photo-requests";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "captures", "zavsklad");
const VIEW = { w: 390, h: 844, scale: 3 };

type Box = { x: number; y: number; w: number; h: number };

const img = (f: string) =>
  `data:image/jpeg;base64,${readFileSync(join(here, "assets/stones", f)).toString("base64")}`;
const BROKEN = img("travertin-klassik.jpg");
const CALACATTA = img("mramor-calacatta.jpg");
const LOGO = `data:image/jpeg;base64,${readFileSync(join(here, "..", "public/logo/onyx-sphere.jpg")).toString("base64")}`;

// Тексты бота (копии из src/lib/telegram-webhook.ts).
const TASK = buildTaskText("Мрамор Calacatta", { block: "C", landmark: "1" }, "Mijoz prozhilkalarni ko'rmoqchi");
const SINGAN_LINK = "Форма определена: 4 стороны. Откройте ссылку, чтобы ввести размеры:\nonyx-sklad-app.vercel.app/singan?d=…";
const PHOTO_SAVED = "✅ Фото сохранено, спасибо!";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>");
const linkify = (s: string) => esc(s).replace(/(onyx-sklad-app\.vercel\.app\/\S+)/, '<span class="link">$1</span>');

type Msg =
  | { id?: string; from: "bot" | "me"; text: string; time: string }
  | { id?: string; from: "me"; photo: string; caption?: string; quote?: string; time: string };

function bubble(m: Msg): string {
  const tick = m.from === "me" ? ' <span class="tick">✓✓</span>' : "";
  const id = m.id ? ` id="${m.id}"` : "";
  if ("photo" in m) {
    return `<div class="row me"><div class="b me photo"${id}>
      ${m.quote ? `<div class="quote"><b>Onyx Sklad</b><span>${esc(m.quote)}</span></div>` : ""}
      <img src="${m.photo}">
      ${m.caption ? `<div class="cap">${esc(m.caption)}<span class="t">${m.time}${tick}</span></div>` : `<span class="t over">${m.time}${tick}</span>`}
    </div></div>`;
  }
  return `<div class="row ${m.from}"><div class="b ${m.from}"${id}>${linkify(m.text)}<span class="t">${m.time}${tick}</span></div></div>`;
}

type Compose = { photo?: string; caption?: string; replyTo?: string } | null;

function html(msgs: Msg[], compose: Compose): string {
  const bottom = compose?.photo
    ? `<div id="compose" class="compose">
        ${compose.replyTo ? `<div class="replybar"><span class="ri">↩</span><div><b>В ответ Onyx Sklad</b><span>${esc(compose.replyTo)}</span></div></div>` : ""}
        <div class="attach"><img src="${compose.photo}"><div class="capin">${compose.caption ? esc(compose.caption) : '<i>Подпись</i>'}</div>
        <div id="send" class="send">➤</div></div>
      </div>`
    : `<div class="input"><span class="clip">📎</span><div class="field">Сообщение</div><span class="mic">🎤</span></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0}
  body{width:${VIEW.w}px;height:${VIEW.h}px;font:15px/1.32 -apple-system,"Helvetica Neue",Arial,sans-serif;color:#000;
    display:flex;flex-direction:column;background:#cfdcb8}
  .head{height:56px;background:#f7f7f7;border-bottom:1px solid #d9d9d9;display:flex;align-items:center;padding:0 12px;gap:10px}
  .back{color:#2481cc;font-size:28px;width:24px}
  .head img{width:38px;height:38px;border-radius:50%;object-fit:cover}
  .title b{display:block;font-size:16px}.title span{font-size:13px;color:#8a8a8a}
  .chat{flex:1;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end;gap:6px;padding:10px 8px;
    background:linear-gradient(160deg,#d5e2bd,#b9cf9c)}
  .day{align-self:center;background:rgba(0,0,0,.18);color:#fff;font-size:13px;padding:2px 10px;border-radius:12px;margin-bottom:4px}
  .row{display:flex}.row.me{justify-content:flex-end}
  .b{max-width:82%;padding:7px 10px 6px;border-radius:16px;box-shadow:0 1px 1px rgba(0,0,0,.12);word-wrap:break-word}
  .b.bot{background:#fff;border-bottom-left-radius:5px}.b.me{background:#e1fec6;border-bottom-right-radius:5px}
  .t{float:right;font-size:11px;color:#8a8a8a;margin:8px 0 -4px 10px}.b.me .t{color:#4fae4e}.tick{letter-spacing:-3px}
  .link{color:#2481cc}
  .photo{padding:3px;width:240px}.photo img{display:block;width:100%;height:190px;object-fit:cover;border-radius:13px}
  .photo .cap{padding:5px 7px 3px}.photo .over{position:relative;float:none;display:block;text-align:right;margin:2px 6px 0}
  .quote{border-left:3px solid #4fae4e;background:rgba(79,174,78,.12);border-radius:5px;padding:3px 7px;margin:3px 3px 5px;font-size:13px}
  .quote b{display:block;color:#3b9a3a}.quote span,.replybar span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .input{height:54px;background:#f7f7f7;border-top:1px solid #d9d9d9;display:flex;align-items:center;gap:10px;padding:0 10px}
  .field{flex:1;height:36px;border:1px solid #d9d9d9;border-radius:18px;background:#fff;color:#a0a0a0;padding:8px 14px}
  .clip,.mic{font-size:20px;filter:grayscale(1);opacity:.6}
  .compose{background:#f7f7f7;border-top:1px solid #d9d9d9;padding:8px 10px 10px}
  .replybar{display:flex;gap:10px;align-items:center;padding:0 4px 8px;font-size:13px;min-width:0}
  .replybar div{min-width:0;border-left:3px solid #2481cc;padding-left:8px}.replybar b{color:#2481cc}.ri{color:#2481cc;font-size:20px}
  .attach{display:flex;align-items:center;gap:10px}
  .attach img{width:64px;height:64px;border-radius:10px;object-fit:cover}
  .capin{flex:1;height:40px;border:1px solid #d9d9d9;border-radius:20px;background:#fff;padding:9px 14px;font-size:16px}
  .capin i{color:#a0a0a0;font-style:normal}
  .home{height:72px;background:#f7f7f7;flex:none}
  .send{width:40px;height:40px;border-radius:50%;background:#2481cc;color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px}
  </style></head><body>
  <div class="head"><span class="back">‹</span><img src="${LOGO}"><div class="title"><b>Onyx Sklad</b><span>бот</span></div></div>
  <div class="chat"><div class="day">Сегодня</div>${msgs.map(bubble).join("")}</div>
  ${bottom}<div class="home"></div></body></html>`;
}

async function shot(page: Page, file: string, msgs: Msg[], compose: Compose, ids: string[]) {
  await page.setContent(html(msgs, compose), { waitUntil: "load" });
  await page.screenshot({ path: join(OUT, file) });
  const boxes: Box[] = [];
  for (const id of ids) {
    const b = await page.locator(`#${id}`).boundingBox();
    if (b) boxes.push({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) });
  }
  return boxes;
}

const center = (b: Box) => ({ x: Math.round(b.x + b.w / 2), y: Math.round(b.y + b.h / 2) });

export async function renderTelegramFrames(): Promise<void> {
  const manifestPath = join(OUT, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error("нет video/captures/zavsklad/manifest.json — сначала npm run video:capture -- zavsklad");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: VIEW.w, height: VIEW.h }, deviceScaleFactor: VIEW.scale });

  const singanHelp: Msg = { from: "bot", time: "09:12",
    text: "Битый камень: отправьте фото и в подписи (caption) напишите «бой» — ИИ обведёт форму, затем размеры вы введёте на сайте." };
  const task: Msg = { id: "task", from: "bot", text: TASK, time: "12:11" };

  // 4-5: фото битой плиты с подписью «бой» → бот присылает ссылку.
  const [compose45, send45] = await shot(page, "4-5.png", [singanHelp], { photo: BROKEN, caption: "бой" }, ["compose", "send"]);
  const after45 = await shot(page, "4-5-after.png",
    [singanHelp, { id: "sent", from: "me", photo: BROKEN, caption: "бой", time: "09:14" }, { id: "reply", from: "bot", text: SINGAN_LINK, time: "09:14" }],
    null, ["reply"]);

  // 5-1: задача от бота.
  const box51 = await shot(page, "5-1.png", [task], null, ["task"]);

  // 5-2: фото ответом (reply) на задачу → «Фото сохранено».
  const [compose52, send52] = await shot(page, "5-2.png", [task], { photo: CALACATTA, replyTo: TASK.split("\n")[0], caption: "" }, ["compose", "send"]);
  const after52 = await shot(page, "5-2-after.png",
    [task, { id: "sent", from: "me", photo: CALACATTA, quote: TASK.split("\n")[0], time: "12:20" }, { id: "ok", from: "bot", text: PHOTO_SAVED, time: "12:20" }],
    null, ["sent", "ok"]);

  await browser.close();

  const set = (scene: number, step: number, patch: object) => {
    const i = manifest.steps.findIndex((s: { scene: number; step: number }) => Number(s.scene) === scene && Number(s.step) === step);
    const base = { key: `s${scene}.${step}`, scene, step, sceneId: scene === 4 ? "razbit" : "fotozapros", url: "telegram" };
    const entry = { ...base, ...patch, note: "Telegram-бот: кадр нарисован video/telegram-mock.ts с текстами из кода бота." };
    if (i >= 0) manifest.steps[i] = entry;
    else manifest.steps.push(entry);
  };
  set(4, 5, { file: "4-5.png", highlights: [compose45], click: center(send45), after: { file: "4-5-after.png", highlights: after45, click: null } });
  set(5, 1, { file: "5-1.png", highlights: box51, click: null });
  set(5, 2, { file: "5-2.png", highlights: [compose52], click: center(send52), after: { file: "5-2-after.png", highlights: after52, click: null } });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log("telegram: 4-5, 5-1, 5-2 готовы");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  renderTelegramFrames().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
