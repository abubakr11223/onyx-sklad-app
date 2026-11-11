---
name: onyx-ui
description: Onyx design system — exact tokens, component vocabulary, layout shell, form contracts and warehouse-field rules. Use whenever building or changing ANY user-facing screen, form, list or component in this repo, and before adding a new page.
---

# Onyx UI — «Оникс» (ТЗ №20 «Редизайн интерфейса»)

The single source of truth is `src/app/globals.css` (Tailwind v4 `@theme`; there is **no** `tailwind.config.*`). This file records what that system actually is, plus the rules that keep screens consistent. When code and this file disagree, the code wins — fix this file in the same change.

Read this before touching any screen. Never invent a colour, radius or font size that is not below.

---

## 1. Tokens (exact — use the Tailwind utility, not the hex)

Spec: ТЗ №20 «Редизайн интерфейса Onyx» (2026-11-11). Palette is taken from the stone itself: black onyx for the menu and buttons, travertine and marble for the background, and honey onyx as the ONLY accent. Prefer the TZ names in new code. The old names (`paper`, `ink`, `line`, `side*`, `gold*`) remain as aliases.

| Token | Hex | Use for |
|---|---|---|
| `onyx-950` / `side` | `#16130F` | sidebar, login background |
| `onyx-900` | `#211D18` | menu item hover |
| `onyx-800` / `side-2` | `#2E2822` | active menu item, primary-button hover |
| `ink` | `#1C1915` | text, headings, **primary button background** |
| `ink-2` | `#6B6359` | secondary text, field labels, column headers |
| `ink-3` | `#9A9184` | placeholders and disabled only |
| `side-text` | `#B5AC9F` | inactive menu items |
| `travertine` / `paper` | `#F4F1EC` | page background |
| `marble` / `paper-2` | `#FFFFFF` | cards, tables, inputs |
| `stone-100` | `#EDE8E0` | table header, row hover, segment-control track |
| `line` | `#E2DCD2` | every border and divider |
| `line-strong` | `#CFC6B8` | input border, secondary-button border |
| `honey` / `gold` | `#D4A24C` | active marker, tab underline, focus ring, selected-row strip |
| `honey-soft` | `#F6EBD3` | selected-row / selected-segment background, focus halo |
| `honey-ink` / `gold-deep` | `#8A5A14` | text links, accent figure |

Text on honey is always `ink`, never white. **Buttons are never honey.**

Statuses come as a text + tint pair (`bg-*-bg text-*`):
- `malachite` `#2F6B3F` / `#E5F0E4`: в наличии, отгружено, оплачено.
- `amber` `#8A5A14` / `#F8ECD4`: к отгрузке, бронь, частично.
- `carnelian` `#9B3426` / `#F6E2DD`: долг, просрочка, ошибки, удаление, бой.
- `slate` `#345A78` / `#E3ECF3`: шоу-рум, образец, подсказки.
- `neutral` `#6B6359` / `#EDE8E0`: закрыто, архив.

The aliases `success`, `warning` and `danger` point at malachite, amber and carnelian.

**Type.** IBM Plex Sans is used everywhere (`font-sans`; `font-serif` is the same face, with no serif anywhere). IBM Plex Mono (`font-mono`) is for block codes, batch numbers and dimensions (`A1 · 5`, `118 × 64 × 2 см`). Weights are 400/500/600, and all figures use tabular-nums.
- Page title: `text-display font-semibold` (24/32).
- Block heading: 16/24 semibold.
- KPI: 28/36 medium.
- Body: 14/20.
- Dense table: 13/18.
- Label: 12 medium `ink-2`.

Do not use uppercase or italics, except the 11px menu-group labels.

**Grid.** Spacing is 4, 8, 12, 16, 24, 32 or 48 px.
- Page gutter: 32px at ≥1280, 24px at 768–1279, 16px below.
- Content max width is 1440; forms are at most 760.
- Radii: `rounded-field` 6px (inputs, buttons), `rounded-badge` 4px, `rounded-card` 10px (cards, modals, photos).

Use lines instead of shadows: `shadow-card` is `none`. `shadow-pop` is only for menus, modals and toasts. Transitions run 150ms and change only background and border colour.

**Forbidden** (TZ §2):
- gradients, glass, glow and coloured shadows
- emoji, ✦ sparkles and "AI" badges
- radius above 12px and pill buttons
- sparklines and invented percentages
- avatar placeholders and greetings
- Inter, blue `#3B82F6` and the slate/indigo palettes
- decorative animation

There is no dark theme: only the sidebar is dark.

## 2. Components — reuse, never re-roll

Everything lives in `src/components/ui/`: `Button`, `Field`, `Alert`, `Card`, `Badge`, `Modal`, `toast`, `Icons`, plus `Ripple`. App-level: `Nav`, `BottomTabBar`, `nav-items`, `NoAccess`, `OfflineBanner`, `WarehouseLocationSelect`, `ConfirmSubmitButton`.

- **Button** — `variant`: `primary` (solid blue) · `secondary` (bordered paper-2) · `ghost` · `danger` (outline only, never a filled red button). `size`: `md` | `sm`, **both 44px min-height**. Default `type="button"` — a submit button must pass `type="submit"` explicitly. For a link styled as a button use the exported `buttonClass(variant, size, extra)`.
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
