---
title: Bluegrass Ultimate Wellness Pack — Mobile Optimization Pass
date: 2026-05-26
owner: Nick
status: design
---

# Bluegrass Mobile Optimization Pass

## Context

The Ultimate Wellness Pack lander shipped at https://bluegrass-landers.vercel.app (see [spec](2026-05-26-bluegrass-wellness-bundle-design.md) and [plan](../plans/2026-05-26-bluegrass-wellness-bundle.md)). Nick says ~99% of traffic will be mobile. The current page is responsive (every grid has mobile breakpoints) but isn't *optimized* for mobile-first behavior: no sticky CTA, all grids stack to 1-col which can feel monotonous, no video content, comparison table loses the comparator label on small screens, and the announcement bar is dense.

This pass adds 6 mobile-first features in a single iteration on `/Users/nicholasstewart/Claude/bluegrass-landers/index.html`. No new files.

## Goals

- A persistent mobile sticky CTA to capture intent throughout the scroll
- Carousel feel where stacking feels monotonous (testimonials, problem grid)
- Tap-to-play 9:16 video per spray (IG-story aesthetic)
- Moderate density pass — tighter padding, smaller fonts, no copy cuts
- Rotating single-line announcement bar on mobile (vs. 3-message dot-separated on desktop)
- 2-column comparison table on mobile (currently stacks confusingly)

## Non-goals

- No dot indicator JS for carousels (native scroll feel + scroll hints are enough for v1)
- No copy cuts ("moderate" compaction means whitespace + font size, not removing content)
- No analytics events on the new sticky CTA (page has no analytics yet — separate concern)
- No `prefers-reduced-motion` opt-out for the rotating bar (defer to a11y polish)
- No carouseling of the 4 spray deep-dive sections (they stay stacked — the IG videos add the visual variety)

## Features

### 1. Sticky bottom CTA (mobile)

- Fixed bottom, mobile only (`max-width: 720px`)
- Single full-width gold button with a small margin gutter
- Copy: **"Get the Pack — $84.15/mo"** with a "›" arrow glyph
- Subscription cart deeplink: `https://www.bluegrassvitamins.com/cart/47823287189745:1?selling_plan=5323489521`
- **Show:** when an invisible sentinel placed at the end of the hero section (right after `</section>` for `.hero`) scrolls out of viewport
- **Hide:** when the pricing block (`#offer`) enters the viewport — even partially (prevents double-CTA when user can already see the in-page pricing buttons)
- Slide-up entrance (`transform: translateY(100%)` → `0`, 200ms ease)
- Implemented with `IntersectionObserver` watching two sentinel elements: end-of-hero and `#offer`
- Sits above bottom nav, `z-index: 95` (below the announcement bar's `z-index: 100`)

### 2. Carousels (testimonials + problem grid)

At `max-width: 720px`, convert these grids from stacked to horizontal swipe:

- **`.testimonial-grid`** — currently 1-col at 560px → swipe carousel
- **`.problem-grid`** — currently 1-col at 560px → swipe carousel

CSS-only via:
- Container: `display: flex; overflow-x: auto; scroll-snap-type: x mandatory; gap: 14px; padding: 0 24px 8px; scroll-padding-left: 24px; -webkit-overflow-scrolling: touch`
- Cards: `flex: 0 0 88%; scroll-snap-align: start; min-width: 0`
- Custom scrollbar styling (thin, brand-color thumb, or hidden)
- Small "← swipe →" hint below each carousel on first paint (CSS-only fade-out after a few seconds via animation, optional)

Other grids stay as they are (promise badges already 2-col compact, bundle summary already 2-col, compare table gets its own treatment per #6).

### 3. IG-story video modal (per spray)

Each of the 4 spray sections (B-12, Immune, Drift Away, Hair & Nail) gets a tap-to-play 9:16 video.

**UI:**
- A circular **▶ play badge** overlay on each spray-visual image (bottom-right corner, ~64px circle, navy bg with white triangle, semi-transparent until hover/active)
- Tapping the badge OR the image opens a fullscreen modal
- Modal: full-viewport black backdrop with `<video>` element centered, max-width 480px (so it looks like an IG story on tablet+), 9:16 aspect ratio enforced via `aspect-ratio: 9 / 16`
- Close button: X top-right (white on transparent, 44px hit area)
- Tap outside the video closes; ESC key closes
- Body scroll locked while open (toggle `overflow: hidden` on `<html>`)
- Video element: `controls` attribute (native controls — simplest), `playsinline` (no fullscreen takeover on iOS), `preload="metadata"` (don't download until requested)

**Markup:**
- One shared modal element appended at end of `<body>`, hidden by default
- JS opens it by populating `<video>`'s `src` + `poster` from clicked badge's `data-video-src` + `data-video-poster` attributes
- Each spray-visual gets `data-video-src="..."` and `data-video-poster="..."` placeholder attributes — Nick swaps to real URLs later (same `data-replace` pattern as images)

**Placeholders (for now):**
- All 4 sprays use `data-video-src="https://placehold.co/720x1280/1B4D8C/FFFFFF.mp4?text=Story+Video"` (this returns 404; modal will show a "video not yet uploaded" message via native video error event — acceptable for preview)
- Poster: existing bottle placeholder image
- Real videos swap in via the README workflow

**On desktop:** badges + modal still work (same UX on click). No mobile-only restriction — the modal just looks more like an IG story on phone aspect ratios.

### 4. Moderate density pass (mobile)

All changes in a single `@media (max-width: 720px)` block (or extend existing mobile rules):

| Element | Desktop | Mobile (new) |
|---|---|---|
| `section` padding | 88px 0 | **44px 0** (was 56px) |
| Hero h1 clamp | `clamp(38px, 5.4vw, 64px)` | extend to `clamp(30px, 6vw, 64px)` |
| Hero `.lead` | 19px | **17px** mobile |
| Hero `.countdown` | font-size 13px | **12px** mobile |
| `section h2` clamp | `clamp(32px, 4.2vw, 50px)` | extend lower bound to **26px** |
| `.spray-content h3` clamp | `clamp(28px, 3.6vw, 42px)` | extend lower bound to **22px** |
| `.spray-content` benefit `li` | 16px | **15px** mobile |
| `.spray-benefits` gap | 12px | **10px** mobile |
| `.problem-card` padding | 28px 24px | **22px 18px** mobile |
| `.testimonial-card` padding | 28px 24px | **22px 18px** mobile |
| `.testimonial-card p` | 15px | **14.5px** mobile |
| `.bundle-reveal` padding (current mobile) | 64px 20px | **48px 20px** (tighter) |
| `.scarcity` padding (current mobile) | 64px 20px | **52px 20px** |
| `.final-cta` padding (current mobile) | 64px 20px | **56px 20px** |
| `.faq-item summary` font-size | 17px | **16px** mobile |
| `.bar` font-size (current mobile) | 11px | stays 11px but copy rotates (see #5) |

Goal: reduce wasted vertical space without making any text feel cramped. No copy is removed.

### 5. Rotating announcement bar (mobile)

At `max-width: 720px`:
- Hide all spans except one at a time (CSS `display: none` on inactive)
- JS rotation every 3000ms: `Free Shipping` → `Cancel Anytime` → `4 Wellness Sprays, 1 Monthly Delivery` → loop
- Fade transition: 250ms opacity 0 → 250ms swap + opacity 1

**Implementation:**
- Add a wrapper inside `.bar`: `<div class="bar-messages"><span>...</span><span>...</span><span>...</span></div>`
- On desktop, all spans visible with current `·` separators (achievable via `::before` content on spans 2+)
- On mobile, only one span visible at a time, JS toggles `.active` class
- Tiny IIFE inside the existing `<script>` block
- Desktop CSS keeps the dot-separator behavior; mobile CSS hides all spans except `.bar .active`

**Edge case:** if JS doesn't run (extreme edge), CSS fallback shows the first span only — never broken.

### 6. Comparison table mobile rebuild

At `max-width: 720px`, switch `.compare-grid` from 1-col stack to **2-col side-by-side**:

**Layout:**
```
┌────────────────┬────────────────┐
│ Wellness Pack  │ Stack 4 brands │  ← gold header + navy header (row 1)
├────────────────┴────────────────┤
│       Monthly cost              │  ← label spans both cols (row header)
├────────────────┬────────────────┤
│ $84.15 (green) │ $156+ (red)    │  ← yes | no values
├────────────────┴────────────────┤
│       Absorption                │
├────────────────┬────────────────┤
│ Sublingual...  │ Capsule...     │
└────────────────┴────────────────┘
```

**CSS changes at `max-width: 720px`:**
- `.compare-grid { grid-template-columns: 1fr 1fr; }` (was 1fr)
- `.compare-grid > .head:first-child { display: none; }` (hide the blank first head)
- `.compare-grid > .head:not(.you) { display: block; }` (UNHIDE the comparator head — currently `display: none`)
- `.compare-grid > .label { grid-column: 1 / -1; background: var(--navy); color: #fff; font-family: 'Fraunces', serif; text-align: center; padding: 12px 16px; font-size: 15px; }`
- Yes/no cells: smaller padding, slightly smaller font

Resolves both the layout-weird issue AND the Phase 5 reviewer's accessibility concern about losing comparator context.

## Architecture

All 6 features live in `/Users/nicholasstewart/Claude/bluegrass-landers/index.html`:

- **CSS** appended to the existing `<style>` block, grouped at the end under a `/* === mobile pass === */` comment marker for easy navigation. Where existing rules need to change (e.g., compare-grid mobile, bar mobile), edit in place.
- **HTML changes:** add sticky-CTA element near end of `<body>` (before script); add `▶` play badge HTML inside each `.spray-visual`; add bar-messages wrapper inside `.bar`; add shared video modal at end of `<body>`.
- **JS:** append 3 new IIFEs to the existing `<script>` block (already has 2: countdown + pricing toggle). New IIFEs: (a) sticky-CTA visibility, (b) bar message rotation, (c) video modal open/close.

No new external dependencies. No new files.

## Browser support

- `IntersectionObserver` — supported everywhere modern (Safari 12.1+, Chrome 51+). For the sticky CTA visibility.
- `scroll-snap-type: x mandatory` — supported everywhere modern. For carousels.
- `<details>` — already in use. Unchanged.
- `aspect-ratio` — already in use. Unchanged.
- `playsinline` on video — required for iOS Safari to not force fullscreen on play.
- `position: fixed; bottom: 0` — universal. For sticky CTA.

## CTA mechanics (no change)

Sticky bottom CTA uses the existing subscription URL — no new IDs or params. Brings total cart deeplinks from 11 to 12 (one new sticky CTA), still 10 subscription + 1 one-time + 1 new subscription = 11 sub + 1 one-time.

## Open items / TODOs (for Nick's README handoff list)

The README's "Blockers — MUST fix" and "Outstanding TODOs" lists get amended:

1. **Real IG-story videos** for each spray (4 placeholders ship with the pass). Add to TODOs.
2. **Brand IG-story poster images** for each spray (4 placeholders, default to existing bottle images).
3. **Verify on a real iPhone** — the modal video `playsinline` behavior and scroll-snap feel can only be confirmed on hardware, not desktop devtools.

## Definition of done

- [ ] Sticky CTA appears after hero scroll on mobile, hides when pricing block is in view, slides up smoothly
- [ ] Testimonials + problem grid swipeable horizontally on `<720px` viewports
- [ ] Each spray has a ▶ badge; tapping opens a fullscreen video modal; close button + tap-outside + ESC all work
- [ ] Mobile text sizes/padding match the table in #4; no horizontal overflow at 375px width
- [ ] Announcement bar shows 1 message at a time on mobile, rotates every 3s
- [ ] Comparison table renders 2-col on mobile with row-header labels spanning both columns
- [ ] All existing functionality (countdown, pricing toggle, FAQ accordion) still works
- [ ] README updated with the 3 new TODOs above
- [ ] Production deploy succeeds + Vercel preview verified
