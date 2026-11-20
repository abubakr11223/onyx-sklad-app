// Screenshot capture for the training videos (ТЗ №21 часть Б).
//
//   npm run video:db                      # fresh demo data (onyx_video)
//   npm run video:serve                   # app on :3100 against onyx_video (separate terminal)
//   npm run video:capture -- vladelets    # or menedzher | zavsklad
//
// Logs in through the real /login page with the generated demo account
// (video/.auth.local.json), walks every step of docs/video/onyx-<role>.md and
// writes video/captures/<role>/<scene>-<step>.png + manifest.json.
//
// Manifest step: { key:"s<scene>.<n>", scene, step, sceneId, file, url,
//   highlights:[{x,y,w,h}], click:{x,y}|null, after? }
// Boxes are CSS px relative to the viewport screenshot (multiply by
// viewport.scale for image pixels). `after` (optional) is an extra frame showing
// the result of the step's action (e.g. after «Сохранить»), same box format.
//
// Mutating steps really run on onyx_video — re-run `video:db` before a re-capture.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Locator, type Page } from "playwright";
import { renderTelegramFrames } from "./telegram-mock";
import {
  AUTH_FILE,
  CAPTURES_DIR,
  REPO_ROOT,
  VIDEO_BASE_URL,
  type AuthFile,
} from "./video-env";

type Box = { x: number; y: number; w: number; h: number };
type Frame = { file: string; url: string; highlights: Box[]; click: { x: number; y: number } | null };
type StepOut = Frame & { key: string; scene: number; step: number; sceneId: string; after?: Frame; note?: string };

interface StepCtx {
  page: Page;
  /** take the step's main frame */
  shot: (opts: { highlights?: Locator[]; click?: Locator | null }) => Promise<void>;
  /** extra "result" frame for the same step */
  after: (opts: { highlights?: Locator[]; page?: Page }) => Promise<void>;
}
type StepFn = (c: StepCtx) => Promise<void>;
interface RoleDef {
  account: string;
  viewport: { w: number; h: number; scale: number };
  mobile?: boolean;
  /** steps[sceneIndex][stepIndex] */
  scenes: StepFn[][];
}

const go = async (page: Page, path: string) => {
  await page.goto(VIDEO_BASE_URL + path, { waitUntil: "networkidle" });
  await settle(page);
};
async function settle(page: Page): Promise<void> {
  // server actions redirect a moment after the click — let navigation start
  await page.waitForTimeout(700);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  // route-level loading skeleton (aria-busy) must be gone
  await page.waitForFunction(() => !document.querySelector('main[aria-busy="true"]'), null, { timeout: 30000 }).catch(() => undefined);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => undefined);
  // fonts + images
  await page.evaluate(async () => {
    await document.fonts.ready;
    // lazy offscreen images never fire load — cap the wait
    const imgs = Promise.all(
      Array.from(document.images)
        .filter((i) => !i.complete && i.loading !== "lazy")
        .map((i) => new Promise((r) => { i.onload = i.onerror = r; })),
    );
    await Promise.race([imgs, new Promise((r) => setTimeout(r, 4000))]);
  });
  await page.waitForTimeout(250);
}
const vis = (l: Locator) => l.filter({ visible: true }).first();
/** sidebar nav link (desktop) */
const nav = (page: Page, href: string) => vis(page.locator(`aside a[href="${href}"], nav a[href="${href}"]`));
/** scroll element so its top sits ~`top` px below the viewport top */
async function scrollTo(page: Page, l: Locator, top = 120): Promise<void> {
  // deterministic: element top → viewport top, then back off by `top` px
  // (window.scrollBy works for desktop and touch-emulated contexts alike)
  await page.waitForTimeout(200);
  await l.evaluate((el) => el.scrollIntoView({ block: "start", behavior: "instant" as ScrollBehavior }));
  await page.evaluate((dy) => window.scrollBy(0, -dy), top);
  await page.waitForTimeout(300);
}
const randPw = () => Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8);

// ───────────────────────── Владелец ─────────────────────────

const vladelets: RoleDef = {
  account: "owner",
  viewport: { w: 1440, h: 900, scale: 2 },
  scenes: [
    // 1. Bosh sahifa
    [
      async ({ page, shot }) => {
        await go(page, "/");
        const logo = vis(page.locator('aside a[href="/"]'));
        await shot({ highlights: [logo], click: logo });
      },
      async ({ page, shot }) => {
        const tiles = ["Партии", "Требует проверки", "Фото в очереди", "Активные брони"].map((t) =>
          vis(page.locator("main a").filter({ hasText: t })),
        );
        await shot({ highlights: tiles });
      },
      async ({ page, shot }) => {
        const t = vis(page.locator("main a").filter({ hasText: "Требует проверки" }));
        await shot({ highlights: [t] });
      },
      async ({ page, shot }) => {
        const sec = vis(page.locator("main a").filter({ hasText: "Сводка" }).last());
        await scrollTo(page, sec, 300);
        const grid = sec.locator("xpath=ancestor::ul[1] | ancestor::div[contains(@class,'grid')][1]").first();
        await shot({ highlights: [(await grid.count()) ? grid : sec] });
      },
    ],
    // 2. Сводка
    [
      async ({ page, shot }) => {
        await go(page, "/svodka");
        const l = nav(page, "/svodka");
        await shot({ highlights: [l], click: l });
      },
      async ({ page, shot }) => {
        const now = new Date(Date.now() + 5 * 3600e3);
        const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
        const to = now.toISOString().slice(0, 10);
        await page.fill("#from", from);
        await page.fill("#to", to);
        const btn = vis(page.getByRole("button", { name: "Показать" }));
        await shot({ highlights: [page.locator("#from"), page.locator("#to"), btn], click: btn });
        await btn.click();
        await settle(page);
      },
      async ({ page, shot }) => {
        const cards = ["Выручка периода", "B2B", "B2C"].map((t) =>
          vis(page.locator("main section").first().locator("> *").filter({ hasText: t })),
        );
        await shot({ highlights: cards });
      },
      async ({ page, shot }) => {
        const bar = vis(page.locator("main section, main div").filter({ has: page.locator('h2:text-is("B2B / B2C")') }).last());
        await scrollTo(page, bar, 160);
        await shot({ highlights: [bar] });
      },
      async ({ page, shot }) => {
        const chip = vis(page.locator("#reyting a").filter({ hasText: "Квартал" }));
        await chip.click();
        await settle(page);
        const sec = page.locator("#reyting");
        await scrollTo(page, sec, 80);
        const chip2 = vis(page.locator("#reyting a").filter({ hasText: "Квартал" }));
        await shot({ highlights: [sec, chip2], click: chip2 });
      },
      async ({ page, shot }) => {
        const h = vis(page.locator('h2:text-is("Продажи по менеджерам")'));
        const sec = h.locator("xpath=..");
        await scrollTo(page, h, 100);
        await shot({ highlights: [sec] });
      },
    ],
    // 3. Должники
    [
      async ({ page, shot }) => {
        await go(page, "/dolzhniki");
        const l = nav(page, "/dolzhniki");
        await shot({ highlights: [l], click: l });
      },
      async ({ page, shot }) => {
        const kpi = ["Долг, сум", "Долг, $", "Должников", "Просрочено"].map((t) =>
          vis(page.locator("main p, main h2, main h3").filter({ hasText: new RegExp("^" + t.replace("$", "\\$")) })).locator("xpath=.."),
        );
        await shot({ highlights: kpi });
      },
      async ({ page, shot }) => {
        const cb = vis(page.locator('input[name="overdue"]'));
        await cb.check();
        const apply = vis(page.getByRole("button", { name: "Применить" }));
        await apply.click();
        await settle(page);
        const row = vis(page.locator("main li").filter({ hasText: "Demo mijoz 1" }));
        await scrollTo(page, row, 380);
        await shot({
          highlights: [row, vis(page.locator('input[name="overdue"]')).locator("xpath=..")],
          click: vis(page.getByRole("button", { name: "Применить" })),
        });
      },
      async ({ page, shot, after }) => {
        const row = vis(page.locator("main li").filter({ hasText: "Demo mijoz 1" }));
        const sum = vis(row.locator("summary").filter({ hasText: "Принять оплату" }));
        await sum.click();
        await page.waitForTimeout(200);
        const amount = vis(row.locator('input[name="amount"]'));
        await amount.fill("4000000");
        const submit = vis(row.getByRole("button", { name: "Внести" }));
        await scrollTo(page, row, 220);
        await shot({ highlights: [amount, submit], click: submit });
        await submit.click();
        await settle(page);
        const row2 = vis(page.locator("main li").filter({ hasText: "Demo mijoz 1" }));
        const s2 = vis(row2.locator("summary"));
        await s2.click();
        await page.waitForTimeout(200);
        await scrollTo(page, row2, 220);
        await after({ highlights: [row2] });
      },
    ],
    // 4. История
    [
      async ({ page, shot }) => {
        await go(page, "/istoriya");
        const l = nav(page, "/istoriya");
        await shot({ highlights: [l], click: l });
      },
      async ({ page, shot }) => {
        const head = vis(page.locator("main thead"));
        const crossed = vis(page.locator("main tbody tr").filter({ has: page.locator(".line-through") }));
        await scrollTo(page, head, 140);
        await shot({ highlights: [head, crossed] });
      },
      async ({ page, shot }) => {
        await page.evaluate(() => window.scrollTo(0, 0));
        const a = vis(page.locator("main a").filter({ hasText: "Архив продаж" }));
        await shot({ highlights: [a] });
      },
    ],
    // 5. Сотрудники
    [
      async ({ page, shot }) => {
        await go(page, "/accounts");
        const l = nav(page, "/accounts");
        await shot({ highlights: [l], click: l });
      },
      async ({ page, shot, after }) => {
        await page.fill("#name", "Aziz Karimov (демо)");
        await page.fill("#new-email", "aziz@demo.onyx.local");
        await page.fill("#new-password", randPw());
        await page.selectOption("#new-role", "WAREHOUSE");
        await page.fill("#new-phone", "+998900000008");
        const card = page.locator("form").filter({ has: page.locator("#new-email") });
        const btn = vis(page.getByRole("button", { name: "Создать аккаунт" }));
        await scrollTo(page, card, 140);
        await shot({ highlights: [card, btn], click: btn });
        await btn.click();
        await settle(page);
        const created = vis(page.locator("main li").filter({ hasText: "aziz@demo.onyx.local" }));
        await scrollTo(page, created, 300);
        await after({ highlights: [created] });
      },
      async ({ page, shot, after }) => {
        await go(page, "/accounts");
        const card = vis(page.locator("main li").filter({ hasText: "otabek_demo" }));
        const btn = vis(card.getByRole("button", { name: "Одобрить" }));
        await scrollTo(page, card, 200);
        await shot({ highlights: [card], click: btn });
        await btn.click();
        await settle(page);
        const created = vis(page.locator("main li").filter({ hasText: "Otabek Ergashev" }));
        await scrollTo(page, created, 300);
        await after({ highlights: [created] });
      },
      async ({ page, shot, after }) => {
        await go(page, "/accounts");
        const card = vis(page.locator("main li").filter({ hasText: "jasur@demo.onyx.local" }));
        await vis(card.locator("summary").filter({ hasText: "Изменить" })).click();
        const deact = vis(card.locator("summary").filter({ hasText: "Деактивировать" }));
        await deact.click();
        await page.waitForTimeout(200);
        const yes = vis(card.getByRole("button", { name: /Да, деактивировать/ }));
        await scrollTo(page, card, 24);
        await shot({ highlights: [deact.locator("xpath=.."), yes], click: yes });
        await yes.click();
        await settle(page);
        const card2 = vis(page.locator("main li").filter({ hasText: "jasur@demo.onyx.local" }));
        await scrollTo(page, card2, 300);
        await after({ highlights: [card2] });
      },
    ],
    // 6. Партнёры и Заявки
    [
      async ({ page, shot }) => {
        await go(page, "/partnery");
        const sum = vis(page.locator("summary").filter({ hasText: "Завести партнёра" }));
        await sum.click();
        await page.waitForTimeout(200);
        await shot({ highlights: [nav(page, "/partnery"), sum], click: sum });
      },
      async ({ page, shot, after }) => {
        const form = vis(page.locator("details form").filter({ has: page.locator('select[name="partnerType"]') }));
        await form.locator('input[name="name"]').fill("Kamola Interyer (демо)");
        await form.locator('select[name="partnerType"]').selectOption("DESIGNER");
        await form.locator('input[name="email"]').fill("kamola@demo.onyx.local");
        await form.locator('input[name="password"]').fill(randPw());
        await form.locator('input[name="phone"]').fill("+998900000010");
        const btn = vis(form.getByRole("button", { name: "Завести партнёра" }));
        await scrollTo(page, form, 120);
        await shot({ highlights: [form.locator('select[name="partnerType"]'), btn], click: btn });
        await btn.click();
        await settle(page);
        const card = vis(page.locator("main li").filter({ hasText: "Kamola Interyer" }));
        await scrollTo(page, card, 250);
        await after({ highlights: [card] });
      },
      async ({ page, shot, after }) => {
        const card = vis(page.locator("main li").filter({ hasText: "Kamola Interyer" }));
        const sel = vis(card.locator('select[name="managerId"]'));
        const opt = await sel.locator("option").filter({ hasText: "Dilshod" }).first().getAttribute("value");
        await sel.selectOption(opt ?? "");
        const save = vis(card.getByRole("button", { name: "Сохранить" }));
        await scrollTo(page, card, 220);
        await shot({ highlights: [sel, save], click: save });
        await save.click();
        await settle(page);
        const card2 = vis(page.locator("main li").filter({ hasText: "Kamola Interyer" }));
        await scrollTo(page, card2, 250);
        await after({ highlights: [card2] });
      },
      async ({ page, shot, after }) => {
        await go(page, "/zayavki");
        const card = vis(page.locator("main li").filter({ has: page.getByRole("button", { name: "Связался" }) }));
        const btn = vis(card.getByRole("button", { name: "Связался" }));
        await scrollTo(page, card, 160);
        await shot({ highlights: [nav(page, "/zayavki"), card], click: btn });
        await btn.click();
        await settle(page);
        await after({ highlights: [] });
      },
    ],
    // 7. Каталог и QR
    [
      async ({ page, shot }) => {
        await go(page, "/katalog");
        const l = nav(page, "/katalog");
        await shot({ highlights: [l], click: l });
      },
      async ({ page, shot, after }) => {
        const tile = vis(page.locator("main ul > li").filter({ hasText: "Мрамор Calacatta" }));
        const img = vis(tile.locator("a").first());
        await scrollTo(page, tile, 140);
        await shot({ highlights: [tile], click: img });
        await Promise.all([page.waitForURL(/\/k\//), img.click()]);
        await settle(page);
        await after({ highlights: [] });
      },
      async ({ page, shot, after }) => {
        await go(page, "/poisk");
        const boxes = page.locator('input[type="checkbox"][form="qr-print"]').filter({ visible: true });
        await boxes.nth(0).check();
        await boxes.nth(1).check();
        const btn = vis(page.getByRole("button", { name: "Печать QR отмеченных" }));
        await shot({ highlights: [boxes.nth(0), boxes.nth(1), btn], click: btn });
        const [popup] = await Promise.all([page.context().waitForEvent("page"), btn.click()]);
        await popup.setViewportSize({ width: page.viewportSize()!.width, height: page.viewportSize()!.height });
        await settle(popup);
        await after({ highlights: [], page: popup });
      },
    ],
  ],
};

// ───────────────────────── Менеджер ─────────────────────────

/** Tashkent date + N days as YYYY-MM-DD */
const tashDate = (plusDays = 0) => new Date(Date.now() + 5 * 3600e3 + plusDays * 864e5).toISOString().slice(0, 10);
const card = (page: Page, text: string | RegExp) => vis(page.locator("main li").filter({ hasText: text }));

/** shared start of the sale wizard: stone → «Продать объём» (n-th batch) → slabs → client */
async function saleWizard(page: Page, stone: RegExp, slabs: string, client: string): Promise<void> {
  await go(page, "/prodazha");
  await vis(page.getByRole("button", { name: stone })).click();
  await vis(page.getByRole("button", { name: "Продать объём" })).click();
  await page.getByRole("textbox", { name: "Плит" }).fill(slabs);
  await page.getByPlaceholder("Поиск по имени или телефону…").fill(client);
  await vis(page.locator("main").getByRole("button", { name: "Найти", exact: true }).last()).click();
  await vis(page.getByRole("button", { name: new RegExp("^" + client + " ·") })).click();
  await page.waitForTimeout(500);
}

const menedzher: RoleDef = {
  account: "manager1",
  viewport: { w: 1440, h: 900, scale: 2 },
  scenes: [
    // 1. Поиск
    [
      async ({ page, shot, after }) => {
        await go(page, "/poisk");
        const name = vis(page.getByPlaceholder(/травертин, мрамор/));
        await name.fill("Оникс");
        await shot({ highlights: [nav(page, "/poisk"), name], click: nav(page, "/poisk") });
        await name.press("Enter");
        await settle(page);
        await after({ highlights: [vis(page.locator("main h2").filter({ hasText: /наличии|Найдено|Результат/ }))] });
      },
      async ({ page, shot, after }) => {
        await go(page, "/poisk");
        const len = page.getByPlaceholder("Длина");
        const wid = page.getByPlaceholder("Ширина");
        await len.fill("120");
        await wid.fill("60");
        const btn = vis(page.locator("form").filter({ has: len }).getByRole("button", { name: "Найти" }));
        await shot({ highlights: [len, wid, btn], click: btn });
        await btn.click();
        await settle(page);
        await after({ highlights: [] });
      },
      async ({ page, shot, after }) => {
        await go(page, "/poisk");
        const ai = vis(page.getByPlaceholder(/Например: светлый оникс/));
        await ai.fill("светлый оникс на столешницу");
        const btn = vis(page.locator("form").filter({ has: ai }).getByRole("button", { name: "Найти" }));
        await shot({ highlights: [ai, btn], click: btn });
        await btn.click();
        await settle(page);
        await page.waitForTimeout(1500);
        await settle(page);
        await after({ highlights: [] });
      },
      async ({ page, shot }) => {
        await go(page, "/poisk");
        const b = vis(page.getByRole("button", { name: "Найти по фото" }).or(page.getByText("Найти по фото")));
        await shot({ highlights: [b], click: b });
      },
    ],
    // 2. Карточка камня
    [
      async ({ page, shot, after }) => {
        await go(page, "/poisk");
        const row = vis(page.locator("main a").filter({ hasText: "Оникс Медовый" }));
        await scrollTo(page, row, 300);
        await shot({ highlights: [row], click: row });
        await Promise.all([page.waitForURL(/\/kamen\//), row.click()]);
        await settle(page);
        await after({ highlights: [] });
      },
      async ({ page, shot }) => {
        const nal = vis(page.locator('main h2:text-is("Наличие")')).locator("xpath=..");
        const loc = vis(page.locator('main h2:text-is("Локации")')).locator("xpath=..");
        await scrollTo(page, nal, 90);
        await shot({ highlights: [nal, loc] });
      },
      async ({ page, shot, after }) => {
        const h = vis(page.locator('main h2:text-is("Запросить фото")'));
        const sec = h.locator("xpath=..");
        const btn = vis(sec.getByRole("button", { name: "Запросить фото" }));
        await scrollTo(page, sec, 200);
        await shot({ highlights: [sec], click: btn });
        await btn.click();
        await settle(page);
        await after({ highlights: [] });
      },
    ],
    // 3. Бронь
    [
      async ({ page, shot }) => {
        await go(page, "/bron");
        const l = nav(page, "/bron");
        await shot({ highlights: [l], click: l });
      },
      async ({ page, shot }) => {
        const stone = page.getByRole("combobox", { name: "Вид камня *" });
        await stone.selectOption({ label: "Гранит Абсолют Блэк (гранит)" });
        await page.waitForTimeout(500);
        const target = page.locator("#bron-target");
        const val = await target.evaluate((s) => {
          const o = s.querySelector('optgroup[label^="Объём"] option:not([disabled])') as HTMLOptionElement | null;
          return o?.value ?? "";
        });
        await target.selectOption(val);
        await page.waitForTimeout(300);
        await page.locator('input[name="qtySlabs"]').fill("3");
        const client = page.getByRole("textbox", { name: "Имя или телефон клиента" });
        await client.fill("Demo mijoz 1");
        await vis(page.getByRole("button", { name: /^Demo mijoz 1 ·/ })).click();
        await page.waitForTimeout(300);
        await scrollTo(page, stone, 200);
        await shot({ highlights: [stone, target, vis(page.locator("main").getByText("Demo mijoz 1", { exact: false }).last())] });
      },
      async ({ page, shot, after }) => {
        const days = page.getByRole("textbox", { name: "Срок, дней" });
        const btn = vis(page.getByRole("button", { name: "Забронировать" }));
        await scrollTo(page, days, 300);
        await shot({ highlights: [days, btn], click: btn });
        await btn.click();
        await settle(page);
        await page.evaluate(() => window.scrollTo(0, 0));
        await after({ highlights: [vis(page.locator('main h2:text-is("Активные брони")')).locator("xpath=following-sibling::*[1]")] });
      },
    ],
    // 4. Продажа
    [
      async ({ page, shot }) => {
        await go(page, "/prodazha");
        const b = vis(page.getByRole("button", { name: /Травертин Классик/ }));
        await shot({ highlights: [nav(page, "/prodazha"), b], click: b });
        await b.click();
        await page.waitForTimeout(500);
      },
      async ({ page, shot }) => {
        const first = vis(page.locator("main li").filter({ has: page.getByRole("button", { name: "Продать объём" }) }));
        const btn = vis(first.getByRole("button", { name: "Продать объём" }));
        await shot({ highlights: [first], click: btn });
        await btn.click();
        await page.getByRole("textbox", { name: "Плит" }).fill("5");
        await page.waitForTimeout(300);
      },
      async ({ page, shot }) => {
        await page.getByPlaceholder("Поиск по имени или телефону…").fill("Demo mijoz 1");
        await vis(page.locator("main").getByRole("button", { name: "Найти", exact: true }).last()).click();
        const hit = vis(page.getByRole("button", { name: /^Demo mijoz 1 ·/ }));
        await scrollTo(page, hit, 300);
        await shot({ highlights: [page.getByRole("textbox", { name: "Плит" }), hit], click: hit });
        await hit.click();
        await page.waitForTimeout(500);
      },
      async ({ page, shot }) => {
        const siteRadio = page.getByRole("radio", { name: "Выбрать объект клиента" });
        if (await siteRadio.count()) {
          await siteRadio.check();
          await page.waitForTimeout(500);
          const sel = page.locator("main select").filter({ has: page.locator("option", { hasText: "Yunusobod" }) });
          if (await sel.count()) {
            const v = await sel.first().locator("option", { hasText: "Yunusobod" }).first().getAttribute("value");
            await sel.first().selectOption(v ?? "");
          } else {
            const r = page.getByRole("radio", { name: /Yunusobod/ });
            if (await r.count()) await r.first().check();
          }
        }
        const deliv = page.getByRole("radio", { name: "Доставка на объект" });
        await deliv.check();
        const grp = page.getByRole("group", { name: "Отгрузка" });
        await scrollTo(page, grp, 260);
        await shot({ highlights: [grp], click: deliv });
      },
      async ({ page, shot }) => {
        await page.getByRole("textbox", { name: "Цена продажи *" }).fill("12450000");
        await page.getByRole("textbox", { name: "Сумма оплаты 1" }).fill("8000000");
        await page.waitForTimeout(300);
        const due = page.getByRole("textbox", { name: "Срок возврата долга" });
        if (await due.count()) await due.fill(tashDate(10));
        const grp = page.getByRole("group", { name: "Оплата" });
        await scrollTo(page, grp, 90);
        await shot({ highlights: [grp, vis(page.getByRole("complementary", { name: "Итого" }))] });
      },
      async ({ page, shot, after }) => {
        await vis(page.getByRole("button", { name: "Далее — подтверждение" })).click();
        await page.waitForTimeout(500);
        await page.evaluate(() => window.scrollTo(0, 0));
        const btn = vis(page.getByRole("button", { name: "Подтвердить продажу" }));
        const head = vis(page.locator("main h2").filter({ hasText: "4. Подтверждение продажи" }));
        await shot({ highlights: [head.locator("xpath=.."), btn], click: btn });
        await btn.click();
        await settle(page);
        await page.evaluate(() => window.scrollTo(0, 0));
        await after({ highlights: [vis(page.locator('[role="alert"], [role="status"]').filter({ hasText: /оформлен/ }))] });
      },
    ],
    // 5. Образец
    [
      async ({ page, shot }) => {
        await saleWizard(page, /Гранит Абсолют Блэк/, "1", "Demo mijoz 3");
        const cb = page.getByRole("checkbox", { name: "Выдать как образец (не продажа)" });
        await cb.check();
        await page.waitForTimeout(300);
        await scrollTo(page, cb, 380);
        await shot({ highlights: [cb.locator("xpath=..")], click: cb });
      },
      async ({ page, shot, after }) => {
        const due = page.getByRole("textbox", { name: "Срок возврата образца *" });
        await due.fill(tashDate(7));
        const dep = page.getByRole("textbox", { name: "Залог (необязательно)" });
        await dep.fill("500000");
        await page.waitForTimeout(300);
        const next = vis(page.getByRole("button", { name: "Далее — выдача образца" }));
        await scrollTo(page, due, 300);
        await shot({ highlights: [due, dep, next], click: next });
        await next.click();
        await page.waitForTimeout(500);
        const btn = vis(page.getByRole("button", { name: /Подтвердить выдачу образца/ }));
        await btn.click();
        await settle(page);
        await page.evaluate(() => window.scrollTo(0, 0));
        await after({ highlights: [] });
      },
      async ({ page, shot }) => {
        await go(page, "/obraztsy");
        const l = nav(page, "/obraztsy");
        await shot({ highlights: [l, page.locator("main div").filter({ hasText: /Гранит Абсолют Блэк — объём/ }).filter({ hasText: "Вернули" }).last()], click: l });
      },
    ],
    // 6. Клиенты и Объекты
    [
      async ({ page, shot, after }) => {
        await go(page, "/klienty");
        const link = vis(page.getByRole("link", { name: "Demo mijoz 1" }));
        await shot({ highlights: [nav(page, "/klienty"), link], click: link });
        await Promise.all([page.waitForURL(/\/klienty\/.+/), link.click()]);
        await settle(page);
        await after({ highlights: [vis(page.getByRole("region", { name: "Итоги" }))] });
      },
      async ({ page, shot }) => {
        const tab = vis(page.getByRole("link", { name: /^Долги/ }));
        await Promise.all([page.waitForURL(/tab=dolgi/), tab.click()]);
        await settle(page);
        await shot({ highlights: [vis(page.getByRole("navigation", { name: "Разделы карточки клиента" })), vis(page.getByRole("link", { name: /^Долги/ }))], click: vis(page.getByRole("link", { name: /^Долги/ })) });
      },
      async ({ page, shot, after }) => {
        await vis(page.getByRole("link", { name: "Внести платёж клиента (сум)" })).click();
        await page.waitForURL(/dolzhniki\/klient/);
        await settle(page);
        await page.locator('input[name="total"]').fill("2000000");
        await vis(page.getByRole("button", { name: "Разложить" })).click();
        await settle(page);
        const btn = vis(page.getByRole("button", { name: "Внести платёж" }));
        await scrollTo(page, page.locator('input[name="total"]'), 200);
        await shot({ highlights: [page.locator('input[name="total"]'), btn.locator("xpath=ancestor::form[1]"), btn], click: btn });
        await btn.click();
        await settle(page);
        await after({ highlights: [] });
      },
      async ({ page, shot, after }) => {
        await go(page, "/obekty");
        const link = vis(page.locator("main tbody a").filter({ hasText: "Yunusobod" }));
        await shot({ highlights: [nav(page, "/obekty"), link], click: link });
        await Promise.all([page.waitForURL(/\/obekty\/.+/), link.click()]);
        await settle(page);
        await after({ highlights: [] });
      },
    ],
    // 7. Шоу-рум
    [
      async ({ page, shot }) => {
        await go(page, "/shourum");
        const h = vis(page.locator("main h2").filter({ hasText: "Сейчас в шоу-руме" }));
        await scrollTo(page, h, 90);
        await shot({ highlights: [nav(page, "/shourum"), h.locator("xpath=../following-sibling::ul[1]")], click: nav(page, "/shourum") });
      },
      async ({ page, shot, after }) => {
        const item = card(page, "Травертин Классик — Плита");
        await vis(item.getByRole("button", { name: "Продать из шоу-рума" })).click();
        const dlg = vis(page.getByRole("dialog"));
        await dlg.getByPlaceholder("Поиск по имени или телефону…").fill("Demo mijoz 1");
        await vis(dlg.getByRole("button", { name: "Найти", exact: true })).click();
        await vis(dlg.getByRole("button", { name: /^Demo mijoz 1 ·/ })).click();
        await dlg.getByText("Наличные", { exact: true }).click();
        await dlg.getByRole("textbox", { name: "Цена продажи *" }).fill("2016000");
        const btn = vis(dlg.getByRole("button", { name: "Подтвердить продажу" }));
        await scrollTo(page, dlg, 120);
        await shot({ highlights: [dlg, btn], click: btn });
        await btn.click();
        await settle(page);
        await page.evaluate(() => window.scrollTo(0, 0));
        await after({ highlights: [] });
      },
    ],
    // 8. Подборки
    [
      async ({ page, shot, after }) => {
        await go(page, "/podborki");
        const t = page.getByRole("textbox", { name: "Название (обязательно)" });
        await t.fill("Demo mijoz 3 — ofis qabulxonasi");
        const sel = page.getByRole("combobox", { name: "Клиент (необязательно)" });
        await sel.selectOption({ label: "Demo mijoz 3 · +998900000103" });
        const btn = vis(page.getByRole("button", { name: "Создать подборку" }));
        await shot({ highlights: [t, sel, btn], click: btn });
        await btn.click();
        await settle(page);
        await after({ highlights: [] });
      },
      async ({ page, shot, after }) => {
        for (const [i, stone] of ["Оникс Зелёный", "Гранит Абсолют Блэк"].entries()) {
          await go(page, "/katalog");
          const tile = vis(page.locator("main ul > li").filter({ hasText: stone }));
          const add = vis(tile.getByRole("link", { name: "В подборку" }));
          await scrollTo(page, tile, 140);
          if (i === 0) await shot({ highlights: [tile, add], click: add });
          await Promise.all([page.waitForURL(/dobavit/), add.click()]);
          await settle(page);
          await vis(page.locator("label").filter({ hasText: "Demo mijoz 3 — ofis" })).click();
          await vis(page.getByRole("button", { name: "Добавить в подборку" })).click();
          await settle(page);
        }
        await after({ highlights: [] });
      },
      async ({ page, shot, after }) => {
        await go(page, "/podborki");
        await Promise.all([page.waitForURL(/\/podborki\/.+/), vis(page.getByRole("link", { name: "Demo mijoz 3 — ofis qabulxonasi" })).click()]);
        await settle(page);
        const copy = vis(page.getByRole("button", { name: "Скопировать ссылку" }));
        const share = vis(page.getByRole("button", { name: "Поделиться" }));
        await shot({ highlights: [copy.locator("xpath=.."), copy, share], click: copy });
        await page.context().grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
        await copy.click();
        await page.waitForTimeout(400);
        await after({ highlights: [vis(page.getByRole("status"))] });
      },
    ],
    // 9. Возврат
    [
      async ({ page, shot }) => {
        await go(page, "/prodazha#sales");
        const cl = page.getByRole("searchbox", { name: "Клиент" });
        await cl.fill("Demo mijoz 1");
        const show = vis(page.locator("form").filter({ has: cl }).getByRole("button", { name: "Показать" }));
        await show.click();
        await settle(page);
        const row = card(page, /Травертин Классик — объём из партии · 5 плит/);
        await scrollTo(page, row, 260);
        await shot({ highlights: [page.getByRole("searchbox", { name: "Клиент" }), row] });
      },
      async ({ page, shot, after }) => {
        const row = card(page, /Травертин Классик — объём из партии · 5 плит/);
        await vis(row.locator("summary").filter({ hasText: "Оформить возврат" })).click();
        await row.locator('input[name="qtySlabs"]').fill("1");
        await row.locator('input[name="reason"]').fill("Bitta plita ortib qoldi");
        await page.waitForTimeout(300);
        const btn = vis(row.getByRole("button", { name: "Оформить возврат" }));
        await scrollTo(page, row, 120);
        await shot({ highlights: [row.locator("form"), btn], click: btn });
        await btn.click();
        await settle(page);
        const row2 = card(page, /Травертин Классик — объём из партии/);
        await scrollTo(page, row2, 260).catch(() => undefined);
        await after({ highlights: [row2] });
      },
    ],
  ],
};

// ───────────────────────── Зав. складом (телефон) ─────────────────────────

const tab = (page: Page, href: string) => vis(page.locator(`nav[aria-label="Основная навигация"] a[href="${href}"]`));
const STONE_PHOTO = join(REPO_ROOT, "video/assets/stones/travertin-klassik.jpg");
/** open «Ещё» sheet, frame it with the target link highlighted, then navigate */
async function viaMore(page: Page, href: string, shot: StepCtx["shot"], extra: Locator[] = []): Promise<void> {
  await go(page, "/otgruzki");
  const more = vis(page.getByRole("button", { name: "Ещё" }));
  await more.click();
  await page.waitForTimeout(400);
  const link = vis(page.locator(`#onyx-more-sheet a[href="${href}"]`));
  await shot({ highlights: [more, link, ...extra], click: link });
  await Promise.all([page.waitForURL((u) => u.pathname === href), link.click()]);
  await settle(page);
}
const blockCard = (page: Page, note: string) =>
  vis(page.locator("main p").filter({ hasText: note })).locator("xpath=ancestor::*[contains(@class,'rounded-card')][1]");

const zavsklad: RoleDef = {
  account: "zavsklad",
  viewport: { w: 390, h: 844, scale: 3 },
  mobile: true,
  scenes: [
    // 1. Приёмка
    [
      async ({ page, shot }) => {
        await go(page, "/priemka");
        await shot({ highlights: [tab(page, "/priemka")], click: tab(page, "/priemka") });
      },
      async ({ page, shot }) => {
        const rg = page.getByRole("radiogroup", { name: "Вид камня" });
        const sel = page.getByRole("combobox", { name: "Вид *" });
        await sel.selectOption({ label: "Травертин Классик (травертин)" });
        await scrollTo(page, rg, 80);
        await shot({ highlights: [rg, sel], click: sel });
      },
      async ({ page, shot }) => {
        const n = page.getByRole("textbox", { name: "Плит", exact: true });
        await n.fill("40");
        await scrollTo(page, n, 200);
        await shot({ highlights: [n, page.getByRole("textbox", { name: "Площадь , м²" }).first()], click: n });
      },
      async ({ page, shot }) => {
        const l = page.getByRole("textbox", { name: "Длина * , см" });
        const w = page.getByRole("textbox", { name: "Ширина * , см" });
        const t = page.getByRole("textbox", { name: "Толщина * , см" });
        await l.fill("280");
        await w.fill("160");
        await t.fill("2");
        await scrollTo(page, l, 220);
        await shot({ highlights: [l, w, t] });
      },
      async ({ page, shot }) => {
        const cb = page.getByRole("checkbox", { name: "В партии несколько узоров / толщин" });
        await cb.check();
        await page.waitForTimeout(400);
        const add = vis(page.getByRole("button", { name: /Добавить узор/ }));
        await scrollTo(page, cb, 160);
        await shot({ highlights: [cb.locator("xpath=.."), add], click: add });
        // the demo batch is homogeneous — switch back to the fast path
        await cb.uncheck();
        await page.waitForTimeout(300);
      },
      async ({ page, shot }) => {
        const blocks = page.getByRole("combobox", { name: "Блок *" });
        const marks = page.getByRole("combobox", { name: "Ориентир" });
        const here = page.getByRole("textbox", { name: "Плит здесь" });
        await blocks.nth(0).selectOption("A");
        await page.waitForTimeout(300);
        await marks.nth(0).selectOption("4");
        await here.nth(0).fill("25");
        const add = vis(page.getByRole("button", { name: "+ Добавить локацию" }));
        await add.click();
        await page.waitForTimeout(300);
        await blocks.nth(1).selectOption("E");
        await page.waitForTimeout(300);
        await marks.nth(1).selectOption("1");
        await here.nth(1).fill("15");
        const h = vis(page.locator('main h2:text-is("Локации")'));
        await scrollTo(page, h, 70);
        await shot({ highlights: [h.locator("xpath=.."), add], click: add });
      },
      async ({ page, shot }) => {
        const input = page.locator("#batchPhoto");
        await input.setInputFiles(STONE_PHOTO);
        await page.getByRole("textbox", { name: "Поставщик / документ" }).fill("Turkiya, Denizli — 3-partiya");
        await page.waitForTimeout(500);
        const label = vis(page.locator('label[for="batchPhoto"]'));
        await scrollTo(page, label, 200);
        await shot({ highlights: [label, input], click: input });
      },
      async ({ page, shot, after }) => {
        const btn = vis(page.getByRole("button", { name: "Принять партию" }));
        await scrollTo(page, btn, 500);
        await shot({ highlights: [btn], click: btn });
        await btn.click();
        await settle(page);
        await page.evaluate(() => window.scrollTo(0, 0));
        await after({ highlights: [vis(page.locator('[role="alert"], [role="status"]').filter({ hasText: /ринят/ }))] });
      },
    ],
    // 2. Карта склада
    [
      async ({ page, shot }) => {
        await viaMore(page, "/karta-sklada", shot);
      },
      async ({ page, shot }) => {
        const c = blockCard(page, "травертин и бежевые");
        await scrollTo(page, c, 70);
        await shot({ highlights: [c] });
      },
      async ({ page, shot, after }) => {
        await vis(page.getByRole("link", { name: "Редактировать карту" })).click();
        await page.waitForURL(/edit=1/);
        await settle(page);
        const c = blockCard(page, "гранит, удобный заезд");
        const cb = c.getByRole("checkbox", { name: "Заполнен (нет места)" });
        await cb.check();
        const save = vis(c.getByRole("button", { name: "Сохранить" }));
        await scrollTo(page, c, 70);
        await shot({ highlights: [cb.locator("xpath=.."), save], click: save });
        await save.click();
        await settle(page);
        const done = vis(page.getByRole("link", { name: "Готово" }));
        await done.click();
        await settle(page);
        const c2 = blockCard(page, "гранит, удобный заезд");
        await scrollTo(page, c2, 70);
        await after({ highlights: [c2] });
      },
    ],
    // 3. Отгрузки
    [
      async ({ page, shot }) => {
        await go(page, "/otgruzki");
        await shot({ highlights: [tab(page, "/otgruzki"), vis(page.getByRole("link", { name: "К отгрузке" }))], click: tab(page, "/otgruzki") });
      },
      async ({ page, shot }) => {
        const c = card(page, "Срочно");
        await scrollTo(page, c, 70);
        await shot({ highlights: [c, vis(c.getByText(/^Блок /))] });
      },
      async ({ page, shot }) => {
        const c = card(page, "Срочно");
        const n = c.getByRole("textbox", { name: "Плит (пусто = весь остаток)" });
        await n.fill("1");
        await scrollTo(page, n, 300);
        await shot({ highlights: [n], click: n });
      },
      async ({ page, shot }) => {
        const c = card(page, "Срочно");
        // not attached: the app rejects `local:` photo keys for shipment photos
        // (src/lib/shipment-photo.ts assertPhotoStorageKey) → warning banner
        const input = c.locator('input[type="file"]');
        await scrollTo(page, input, 300);
        await shot({ highlights: [input], click: input });
      },
      async ({ page, shot, after }) => {
        const c = card(page, "Срочно");
        const btn = vis(c.getByRole("button", { name: /^Отгрузить/ }));
        await scrollTo(page, btn, 400);
        await shot({ highlights: [btn], click: btn });
        await btn.click();
        await settle(page);
        await page.evaluate(() => window.scrollTo(0, 0));
        await after({ highlights: [] });
      },
      async ({ page, shot, after }) => {
        await go(page, "/otgruzki");
        const link = vis(page.getByRole("link", { name: "Накладная →" }));
        await scrollTo(page, link, 300);
        await shot({ highlights: [link], click: link });
        await Promise.all([page.waitForURL(/\/otgruzki\/.+/), link.click()]);
        await settle(page);
        await after({ highlights: [] });
      },
    ],
    // 4. Разбить
    [
      async ({ page, shot }) => {
        await go(page, "/razbit");
        await page.getByText("Бой в партии", { exact: true }).click();
        await page.waitForTimeout(300);
        const rg = page.getByRole("radiogroup", { name: "Что разбиваем" });
        await scrollTo(page, rg, 120);
        await shot({ highlights: [tab(page, "/razbit"), rg], click: vis(page.getByText("Бой в партии", { exact: true })) });
      },
      async ({ page, shot }) => {
        const batch = page.locator('select[name="batchId"]');
        const v = await batch.locator("option").filter({ hasText: "Травертин Классик · от 24.10" }).first().getAttribute("value");
        await batch.selectOption(v ?? "");
        await page.getByRole("textbox", { name: "Длина * , см" }).fill("118");
        await page.getByRole("textbox", { name: "Ширина * , см" }).fill("64");
        await page.locator('select[name="pBlock"]').selectOption("B");
        await page.waitForTimeout(300);
        await page.locator('select[name="pLandmark"]').selectOption("3");
        const h = vis(page.locator('main h2:text-is("Куски")'));
        const add = vis(page.getByRole("button", { name: "+ Добавить кусок" }));
        await scrollTo(page, h, 60);
        await shot({ highlights: [h.locator("xpath=.."), add], click: add });
      },
      async ({ page, shot }) => {
        const c = page.getByRole("combobox", { name: "Причина *" });
        await c.selectOption({ label: "Бой при перемещении" });
        await scrollTo(page, c, 300);
        await shot({ highlights: [c], click: c });
      },
      async ({ page, shot, after }) => {
        await vis(page.getByRole("button", { name: "Продолжить" })).click();
        await page.waitForTimeout(600);
        const btn = vis(page.getByRole("button", { name: "Подтвердить" }));
        await scrollTo(page, btn, 400);
        await shot({ highlights: [btn], click: btn });
        await btn.click();
        await settle(page);
        await page.evaluate(() => window.scrollTo(0, 0));
        await after({ highlights: [] });
      },
      async ({ shot }) => {
        // Telegram bot flow — not reproducible on the web stand; show the result page instead
        await shot({ highlights: [] });
      },
    ],
    // 5. Фотозапросы (Telegram steps shown via the site list)
    [
      async ({ page, shot }) => {
        await go(page, "/fotozapros");
        await shot({ highlights: [vis(page.locator("main li").first())] });
      },
      async ({ page, shot }) => {
        await shot({ highlights: [vis(page.locator("main li").first())] });
      },
      async ({ page, shot }) => {
        await viaMore(page, "/fotozapros", shot);
      },
    ],
    // 6. Перемещение и «требует проверки»
    [
      async ({ page, shot }) => {
        await go(page, "/poisk");
        await Promise.all([page.waitForURL(/\/kamen\//), vis(page.locator("main a").filter({ hasText: "Травертин Классик" })).click()]);
        await settle(page);
        const h = vis(page.locator('main h2:text-is("Локации")'));
        await scrollTo(page, h, 60);
        await shot({ highlights: [h.locator("xpath=..")] });
      },
      async ({ page, shot, after }) => {
        const row = vis(page.locator("main li li").filter({ has: page.getByRole("button", { name: "Переместить" }) }));
        const sel = row.locator("select").first();
        const v = await sel.locator("option:not([disabled])").first().getAttribute("value");
        await sel.selectOption(v ?? "");
        await row.getByRole("textbox", { name: "плит" }).fill("3");
        const btn = vis(row.getByRole("button", { name: "Переместить" }));
        await scrollTo(page, sel, 300);
        await shot({ highlights: [sel, row.getByRole("textbox", { name: "плит" }), btn], click: btn });
        await btn.click();
        await settle(page);
        const h = vis(page.locator('main h2:text-is("Локации")'));
        await scrollTo(page, h, 60);
        await after({ highlights: [h.locator("xpath=..")] });
      },
      async ({ page, shot, after }) => {
        const locs = vis(page.locator('main h2:text-is("Локации")')).locator("xpath=..");
        const btn = vis(locs.getByRole("button", { name: "Отметить: требует проверки" }));
        await scrollTo(page, btn, 300);
        await shot({ highlights: [btn], click: btn });
        await btn.click();
        await settle(page);
        const h = vis(page.locator('main h2:text-is("Локации")'));
        await scrollTo(page, h, 60);
        await after({ highlights: [vis(h.locator("xpath=..").locator("li").first())] });
      },
    ],
    // 7. Шоу-рум
    [
      async ({ page, shot, after }) => {
        await go(page, "/shourum");
        const sel = vis(page.locator("main select").filter({ has: page.locator("option", { hasText: "Выберите партию" }) }));
        const v = await sel.locator("option").filter({ hasText: "Оникс Медовый · тёмный" }).first().getAttribute("value");
        await sel.selectOption(v ?? "");
        await page.getByRole("textbox", { name: "Стенд / комментарий" }).fill("Zal, markaziy stend");
        const btn = vis(page.getByRole("button", { name: "Выделить и отправить" }));
        await scrollTo(page, sel, 200);
        await shot({ highlights: [sel, btn], click: btn });
        await btn.click();
        await settle(page);
        await page.evaluate(() => window.scrollTo(0, 0));
        await after({ highlights: [] });
      },
      async ({ page, shot, after }) => {
        await go(page, "/shourum");
        const it = card(page, "Травертин Классик — Плита");
        const btn = vis(it.getByRole("button", { name: "Вернуть на склад" }));
        await scrollTo(page, it, 80);
        await shot({ highlights: [it, btn], click: btn });
        await btn.click();
        await settle(page);
        await page.evaluate(() => window.scrollTo(0, 0));
        await after({ highlights: [] });
      },
    ],
  ],
};

const ROLES: Record<string, RoleDef> = { vladelets, menedzher, zavsklad };

/**
 * Steps that cannot be shown exactly on the web stand (manifest `note`), so the
 * composer can render an illustration/caption instead of relying on the frame.
 */
const NOTES: Record<string, Record<string, string>> = {
  vladelets: {
    "s3.4": "Submit button on screen is «Внести» (script says «saqlaymiz»).",
  },
  menedzher: {
    "s1.3": "AI search is off on the stand (no API key): page shows the fallback «ИИ сейчас не ответил — показан обычный поиск».",
    "s1.4": "Photo search not executed (needs AI); frame only highlights «Найти по фото».",
    "s2.3": "Telegram is off on the stand: toast says the request was created but not delivered.",
  },
  zavsklad: {
    "s3.4": "Photo picker only highlighted, no file attached: on PHOTO_STORAGE=local the app rejects shipment photos (app bug), which would show a warning banner.",
    "s1.5": "Patterns checkbox shown ticked, then unticked again — the demo batch is homogeneous.",
    "s4.5": "Telegram bot flow — not reproducible on the web stand; frame shows the «Разбить» result page.",
    "s5.1": "Telegram bot message — not reproducible; frame shows the same task in «Фотозапросы» on the site.",
    "s5.2": "Telegram reply with photo — not reproducible; frame shows the task list on the site.",
  },
};

// ───────────────────────── runner ─────────────────────────

async function boxOf(l: Locator): Promise<Box | null> {
  try {
    const b = await l.boundingBox({ timeout: 3000 });
    if (!b) return null;
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const roleKey = process.argv[2] ?? "vladelets";
  const role = ROLES[roleKey];
  if (!role) throw new Error(`unknown role ${roleKey}; known: ${Object.keys(ROLES).join(", ")}`);
  const texts = JSON.parse(readFileSync(join(REPO_ROOT, "docs/video/texts.uz.json"), "utf8"));
  const sceneTexts: { id: string; steps: { n: number }[] }[] = texts.videos[roleKey].scenes;
  const auth: AuthFile = JSON.parse(readFileSync(AUTH_FILE, "utf8"));
  const acc = auth[role.account];

  const outDir = join(CAPTURES_DIR, roleKey);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ args: ["--lang=ru-RU"] });
  const context = await browser.newContext({
    viewport: { width: role.viewport.w, height: role.viewport.h },
    deviceScaleFactor: role.viewport.scale,
    isMobile: role.mobile ?? false,
    hasTouch: role.mobile ?? false,
    locale: "ru-RU",
    timezoneId: "Asia/Tashkent",
    colorScheme: "light",
  });
  // hide the Next.js dev-mode badge (stand runs `next dev`)
  await context.addInitScript(() => {
    const css = "nextjs-portal{display:none!important}";
    const add = () => {
      const st = document.createElement("style");
      st.textContent = css;
      document.documentElement.appendChild(st);
    };
    if (document.documentElement) add();
    else document.addEventListener("DOMContentLoaded", add);
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);

  // real login page. Retries: right after `video:db` dropped/recreated the
  // database, the dev server's first query can fail on a stale connection.
  for (let attempt = 1; ; attempt++) {
    try {
      await page.goto(VIDEO_BASE_URL + "/login", { waitUntil: "networkidle" });
      await page.fill("#email", acc.email);
      await page.fill("#login-password", acc.password);
      await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click('button[type="submit"]')]);
      break;
    } catch (e) {
      if (attempt >= 3) throw e;
      console.log(`[capture] login attempt ${attempt} failed, retrying…`);
    }
  }

  const steps: StepOut[] = [];
  const problems: string[] = [];
  for (const [si, scene] of role.scenes.entries()) {
    const st = sceneTexts[si];
    for (const [ji, fn] of scene.entries()) {
      const n = st?.steps[ji]?.n ?? ji + 1;
      const key = `s${si + 1}.${n}`;
      const base = `${si + 1}-${n}`;
      let out: StepOut | null = null;
      const frame = async (file: string, hl: Locator[], click: Locator | null | undefined, pg: Page = page): Promise<Frame> => {
        const highlights: Box[] = [];
        for (const h of hl) {
          const b = await boxOf(h);
          if (b) highlights.push(b);
          else problems.push(`${key}: highlight not found`);
        }
        let c: Frame["click"] = null;
        if (click) {
          const b = await boxOf(click);
          if (b) c = { x: Math.round(b.x + b.w / 2), y: Math.round(b.y + b.h / 2) };
          else problems.push(`${key}: click target not found`);
        }
        await pg.screenshot({ path: join(outDir, file) });
        return { file, url: pg.url().replace(VIDEO_BASE_URL, ""), highlights, click: c };
      };
      const ctx: StepCtx = {
        page,
        shot: async ({ highlights = [], click = null }) => {
          const f = await frame(`${base}.png`, highlights, click);
          out = { key, scene: si + 1, step: n, sceneId: st?.id ?? "", ...f };
        },
        after: async ({ highlights = [], page: pg }) => {
          const f = await frame(`${base}-after.png`, highlights, null, pg ?? page);
          if (out) out.after = f;
        },
      };
      try {
        await fn(ctx);
      } catch (e) {
        problems.push(`${key}: ${(e as Error).message.split("\n")[0]}`);
        if (!out) {
          await page.screenshot({ path: join(outDir, `${base}.png`) });
          out = { key, scene: si + 1, step: n, sceneId: st?.id ?? "", file: `${base}.png`, url: page.url(), highlights: [], click: null };
        }
      }
      const note = NOTES[roleKey]?.[key];
      if (out && note) (out as StepOut).note = note;
      if (out) steps.push(out);
      console.log(`[capture] ${key} ${out ? "ok" : "MISSING"}`);
    }
  }
  await browser.close();

  const manifest = { role: roleKey, viewport: role.viewport, baseUrl: VIDEO_BASE_URL, capturedAt: new Date().toISOString(), steps };
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  if (problems.length) {
    console.log("[capture] problems:\n  " + problems.join("\n  "));
    process.exitCode = 2;
  }
  console.log(`[capture] ${steps.length} steps → ${outDir}`);
  // Шаги Telegram-бота на сайте не снять — рисуем чат поверх этих шагов.
  if (roleKey === "zavsklad") await renderTelegramFrames();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
