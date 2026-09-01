---
name: onyx-ui
description: Onyx design system — exact tokens, component vocabulary, layout shell, form contracts and warehouse-field rules. Use whenever building or changing ANY user-facing screen, form, list or component in this repo, and before adding a new page.
---

# Onyx UI — «Графит + золото»

The single source of truth is `src/app/globals.css` (Tailwind v4 `@theme`; there is **no** `tailwind.config.*`). This file records what that system actually is, plus the rules that keep screens consistent. When code and this file disagree, the code wins — fix this file in the same change.

Read this before touching any screen. Never invent a colour, radius or font size that is not below.

---

## 1. Tokens (exact — use the Tailwind utility, not the hex)

### Surfaces and ink
| Token | Hex | Utility | Use for |
|---|---|---|---|
| `--color-paper` | `#f6f3ee` | `bg-paper` | page background, input fill |
| `--color-paper-2` | `#fdfbf6` | `bg-paper-2` | raised surface (cards, secondary buttons) — **lighter** than the page |
| `--color-ink` | `#211f1b` | `text-ink` | all primary text |
| `--color-line` | `#e8e1d5` | `border-line` | every hairline border |

Text de-emphasis is an opacity ramp on ink, never a new colour: `text-ink/80` → `/70` → `/60` → `/55` → `/40`. Fills: `bg-ink/5`, `bg-ink/8`. Borders: `border-ink/10`, `/15`.

### Dark rail
`--color-side #17161b` · `--color-side-2 #201e25` · `--color-side-ink #cfc7b8` · `--color-side-muted #8b8371`.

### Gold
| Token | Hex | Use for |
|---|---|---|
| `--color-gold` | `#a9832f` | **all focus rings**, active nav, card hover border |
| `--color-gold-soft` | `#c8ab63` | gradient bottom stop, 3px active-nav bar |
| `--color-gold-hi` | `#dabd7a` | gradient top stop |
| `--color-on-gold` | `#2a1e08` | text **on** gold surfaces |
| `--color-gold-deep` | `#7d5e17` | gold as **small text** (≈5.4:1 on paper — AA). Eyebrows, active tab labels |

Gold on light backgrounds as text is **always** `gold-deep`. `gold` is for strokes and fills, not body text.

### Status (each ≥4.5:1 as text on paper)
`--color-success #1f7a4d` (готово) · `--color-warning #9a6b00` (**amber** — «требует проверки», never an error) · `--color-danger #b23b2e` (errors only).

Opacity convention: `/8`–`/12` fills, `/35`–`/40` borders.

> **One highlight per screen.** Amber and gold-tinted panels each claim attention; four tinted sections in a row (today's `/poisk`) means none of them highlights anything. Pick the single most important block and leave the rest neutral.

### Type
Loaded in `src/app/layout.tsx` via `next/font/google`. **Montserrat** 400/500/600/700 = `--font-sans`, all UI and body. **Lora** 600/700 = `--font-serif`, page headings and big display figures only.

Fixed patterns — copy them verbatim, do not re-invent:
```
eyebrow   text-xs font-semibold uppercase tracking-[0.28em] text-gold-deep
h1        mt-2 font-serif text-display font-bold tracking-tight text-ink
subtitle  mt-2 text-lg text-ink/60
h2        font-serif text-xl font-bold text-ink
stat      font-serif text-3xl font-bold tabular-nums
label     text-sm font-semibold text-ink
hint      text-sm text-ink/55
error     text-sm font-medium text-danger
```
`--text-display` = 2rem / lh 1.15 / ls -0.01em.

### Radii, shadow, motion
**Exactly two radii**: `rounded-field` (0.7rem — inputs, buttons, badges) and `rounded-card` (1rem — cards, panels). Do not introduce a third.
Shadows: `shadow-card`, `shadow-gold`, `shadow-gold-lg`, `shadow-pop` — all warm-tinted, never grey.
`prefers-reduced-motion` is already forced globally in the base layer; do not re-implement it per component.

**Light mode only.** There is no dark theme and no `data-theme`. Do not add one screen's worth of dark styling — that is a whole-app decision.

---

## 2. Components — reuse, never re-roll

Everything lives in `src/components/ui/`: `Button`, `Field`, `Alert`, `Card`, `Badge`, `Modal`, `toast`, `Icons`, plus `Ripple`. App-level: `Nav`, `BottomTabBar`, `nav-items`, `NoAccess`, `OfflineBanner`, `WarehouseLocationSelect`, `ConfirmSubmitButton`.

- **Button** — `variant`: `primary` (gold gradient) · `secondary` (bordered paper-2) · `ghost` · `danger` (outline only, never a filled red button). `size`: `md` | `sm`, **both 44px min-height**. Default `type="button"` — a submit button must pass `type="submit"` explicitly. For a link styled as a button use the exported `buttonClass(variant, size, extra)`.
- **Field** — always pass an explicit `id`. Renders label + control + hint + error with `aria-invalid` and `role="alert"` wiring already correct.
- **Alert** — page-level messages. `role="alert"` is built in.
- **Badge** — short status only. Long status goes in text.
- **Modal** — confirmation and focused sub-forms; it owns focus trap and scroll lock.
- **Icons** — stroke SVG. **Never use emoji as an icon** anywhere in the product.

Missing on purpose (build only when a screen truly needs one, then add it here): `Table`, `Tabs`, `EmptyState`, `Skeleton`, `Tooltip`.

---

## 3. Layout shell

`src/app/layout.tsx` is the whole shell: `OfflineBanner` → `Nav` (fixed 256px `md:` and up) → content `min-h-screen pb-20 md:pb-0 md:pl-64` → `BottomTabBar` (`md:hidden`).

**Page width — one rule:** content pages use `max-w-5xl`; forms use `max-w-2xl`. Today there are four different widths (`max-w-6xl / 5xl / 3xl / xl`), which is why `/prodazha` renders a 576px column on a 1440px screen. New pages pick one of the two; when you touch an old page, migrate it.

**Navigation groups.** `Управление` is a flat 12-item dump. Group by meaning: **Склад** (поиск, приёмка, разбить, карта, фотозапросы) · **Продажи** (продажа, бронь, отгрузки, шоу-рум, образцы) · **Справочники** (клиенты, объекты, заявки) · **Учёт и доступ** (сводка, должники, история, сотрудники).

**Mobile reachability.** `bottomTabItems()` shows only 4 of ~17 sections, and logout exists only in the desktop sidebar. Any nav change must keep every role-visible section reachable on a phone — via an «Ещё» tab or drawer — and must keep an account/logout affordance on mobile.

---

## 4. Forms — the contract

These rules exist because each was a real, shipped bug.

1. **Never lose typed input.** React 19 resets uncontrolled fields after every action call. Use the controlled + `useActionState` pattern from `SaleForm` / `IntakeForm` / `SellSampleForm`: values live in one `values` state object; the decision to clear is a pure function of the server result (see `src/app/bron/reserve-form-values.ts`), applied during render — not in an effect.
2. **Render every error you set.** A field error set on a step the user cannot see is the same as silence. Page-level failures go to an `Alert`; field errors go through `Field`.
3. **No optimistic success.** Never toast «готово» from `onSubmit`. Success comes from the server result or the post-redirect banner, never before.
4. **Guard double submission on the server**, not only in the UI. Disable the button while pending (`useFormStatus`) *and* carry a `mutationId` receipt (see `src/app/singan/singan-receipt.ts`, `IntakeForm`). A double tap must never create two rows.
5. **Money and dimensions have one parser each.** Prices go through `parseBoundedDecimal` / `validateSalePayment`; thickness through `parseThicknessCm`. Never `Number(raw)`. Currency and payment method are required — never silently default.
6. **Destructive actions confirm, and reversible ones say so.** Deactivate, delete, purge: confirm in a `Modal` or a two-step reveal, and enforce the confirmation **server-side** so the UI cannot be bypassed. If an action can be undone, ship the undo control in the same change.

---

## 5. Data presentation

1. **Numbers line up or they are useless.** Every quantity, area, price and dimension gets `tabular-nums` (or the `.tnum` utility) and is **right-aligned in its own column**. Never concatenate values into a grey sentence with `·` separators — a manager scanning 30 rows cannot compare numbers that start at a different x on every line.
2. **Lists that grow get a table, not cards.** Cards are for one object; rows of the same shape are a table with column headers. Today the app has exactly one `<table>`.
3. **Lists that grow get keyset pagination.** Compound cursor (sort key + id), page size ~50, «Показать ещё» preserving filters in the URL. A timestamp-only cursor skips rows sharing a timestamp — that bug shipped twice. Reference: `/dolzhniki`, `src/lib/shipments.ts`, `src/lib/leads.ts`.
4. **Totals stay global.** A summary line above a paginated list sums the whole result set, never the current page.
5. **Show the stone.** Any list of stone types carries a photo thumbnail; when there is no photo, show a marked placeholder with the «запросить фото» affordance — never a letter monogram pretending to be an image.
6. **Availability comes from the shared helpers only** — `src/lib/batch-remainders.ts` and `src/lib/volume-holds.ts`. Never re-derive remainder math in a page; a fork silently disagrees with the sale guard.
7. **UZS and USD are never summed.** There is no exchange rate in this system. Group by currency, always.

---

## 6. The warehouse-field rules

The складчик uses this on a phone, outdoors, in sun, sometimes with gloves and dusty hands.

- Touch targets ≥44px; on primary field screens (приёмка, разбит, singan, поиск) aim for 56–60px.
- Numeric fields set `inputMode` (`decimal` / `numeric`), never `type="number"` — the spinner and scroll-wheel edits are hazards.
- One primary action per screen, sticky at the bottom on mobile.
- A long form is a sequence of short steps, not a 3800px scroll (`/priemka` is that today).
- The page masthead (eyebrow + serif h1) costs ~120px above the fold on a phone and repeats what the tab bar already says — keep it compact on mobile.
- Offline state is honest: the existing «нужен интернет» banner is correct behaviour. Do not queue sales or reservations offline — a delayed hold makes a false promise to a client.

---

## 7. Copy (Russian UI)

- Interface language is Russian; code, comments and commits follow the repo's existing mix.
- Name things as the worker says them: «плита», «остаток», «бой», «партия», «ориентир» — not model names.
- Buttons say what happens: «Принять партию», «Оформить продажу», «Снять бронь». Then the confirmation says it happened.
- Errors state what went wrong and what to do: «На эту локацию есть фотозапрос — сначала закройте его», not «Ошибка 500».
- Sentence case in body text; UPPERCASE only for the eyebrow and small label patterns above.

---

## 8. Checklist before you call a screen done

- [ ] Only tokens above — no ad-hoc hex, no third radius
- [ ] `loading.tsx` and `error.tsx` exist for the route
- [ ] Empty state written (not a blank panel)
- [ ] Failed submit keeps every typed value; the error is visible on the step the user is on
- [ ] Submit disabled while pending; server-side idempotency for anything that writes
- [ ] Numbers `tabular-nums`, right-aligned, one column each
- [ ] Growing list: table + keyset pagination + global totals
- [ ] Works at 390px wide; targets ≥44px; nav reachable
- [ ] Focus ring visible on every interactive element (`focus-visible:ring-gold`)
- [ ] Role gate on the page **and** on every server action (deny by default)
