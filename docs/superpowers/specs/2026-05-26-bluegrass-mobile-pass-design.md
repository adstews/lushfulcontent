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

### 3. IG-story ring overlay on each spray bottle + custom player modal

Adapted from https://join.sendblue.com/ (verified via DevTools inspection). Their pattern uses a row of stories + carousel; ours embeds one ring per spray section and plays each video independently.

**Per-spray story ring** (placed as absolute-positioned overlay on each `.spray-visual`):

Each of the 4 spray deep-dive sections gets a 72px circular IG-story ring overlaid on the bottle image, bottom-right corner with -8px offsets (so it appears to float outside the frame). Tapping the ring opens the modal with that spray's video. No label — context is clear from the surrounding spray section.

```html
<div class="spray-visual">
  <img src="...spray-bottle-placeholder..." data-replace="spray-b12-bottle" alt="...">
  <button class="story-btn" data-video="" data-replace="story-video-b12" aria-label="Watch B-12 story video">
    <span class="story-btn-inner">
      <svg width="18" height="18" fill="#fff" viewBox="0 0 24 24">
        <path d="M8 5.14v13.72a1 1 0 001.5.86l11.04-6.86a1 1 0 000-1.72L9.5 4.28a1 1 0 00-1.5.86z"/>
      </svg>
    </span>
  </button>
</div>
```

(Each spray section's `.story-btn` has its own `data-video=""` placeholder and unique `data-replace` key: `story-video-b12`, `story-video-immune`, `story-video-drift`, `story-video-hairnail`.)

**Story-ring CSS** (the IG conic gradient — exact match to SendBlue's colors):
```css
.spray-visual { position: relative; }
.story-btn {
  position: absolute;
  bottom: -8px; right: -8px;
  width: 72px; height: 72px; border-radius: 50%;
  background: conic-gradient(from 180deg,
    #f58529, #dd2a7b, #8134af, #515bd4,
    #8134af, #dd2a7b, #f58529);
  padding: 3px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; border: 0;
  transition: transform 0.2s, box-shadow 0.2s;
  z-index: 2;
}
.story-btn:hover { transform: scale(1.08); box-shadow: 0 0 20px rgba(221,42,123,0.4); }
.story-btn:focus-visible { outline: 2px solid var(--gold); outline-offset: 4px; }
.story-btn-inner {
  width: 100%; height: 100%; border-radius: 50%;
  border: 3px solid var(--cream);
  background: var(--navy);
  display: flex; align-items: center; justify-content: center;
  position: relative; overflow: hidden;
}
.story-btn-inner svg {
  filter: drop-shadow(0 1px 3px rgba(0,0,0,0.5));
  z-index: 1;
}
```

On mobile (`<880px`), the spray-grid stacks, putting the image full-width above the content. The story button stays at bottom-right of the image (still pops nicely on mobile because it overhangs the image edge).

Optional poster image inside the inner circle (so the ring shows a still preview, like a real IG story): we'll skip for v1 since the bottle placeholder behind the play button is fine, but the design supports it later via `background-image` on `.story-btn-inner`.

**Custom player modal** (one shared element appended at end of `<body>` — simpler than SendBlue's because no carousel):

```html
<div class="video-overlay" id="video-overlay">
  <button class="video-overlay-close" id="video-overlay-close" aria-label="Close video">
    <svg width="20" height="20" fill="none" stroke="#fff" stroke-width="2" viewBox="0 0 24 24">
      <path d="M18 6L6 18M6 6l12 12"/>
    </svg>
  </button>
  <div id="video-player-wrap">
    <video id="video-overlay-player" controls autoplay playsinline></video>
  </div>
  <div class="video-overlay-bottom">
    <a class="video-overlay-cta" href="https://www.bluegrassvitamins.com/cart/47823287189745:1?selling_plan=5323489521">Get the Pack — $84.15/mo</a>
    <div class="video-overlay-proof"><span class="stars">★★★★★</span> 4.9/5 · 50,000+ bottles shipped</div>
  </div>
</div>
```

**Modal CSS** (adapted from SendBlue's):
```css
.video-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.92);
  backdrop-filter: blur(4px);
  z-index: 9999;
  display: none;
  align-items: center; justify-content: center; flex-direction: column;
  overflow: hidden;
}
.video-overlay.active { display: flex; }
.video-overlay video {
  width: 90vw; max-width: 540px;  /* tighter than SendBlue's 900px since our videos are 9:16 portrait */
  max-height: 70vh;
  border-radius: 12px;
  outline: 0;
  background: #000;
}
.video-overlay-close {
  position: absolute; top: 20px; right: 24px;
  width: 40px; height: 40px; border-radius: 50%;
  background: rgba(255,255,255,0.1); border: 0;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: background 0.2s;
  z-index: 10000;
}
.video-overlay-close:hover { background: rgba(255,255,255,0.2); }
.video-overlay-bottom {
  z-index: 10000;
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  margin-top: 20px;
  flex-shrink: 0;
}
.video-overlay-cta {
  padding: 14px 36px;
  border-radius: 999px;
  background: var(--gold);
  color: var(--ink);
  font-size: 16px; font-weight: 700;
  letter-spacing: 0.04em; text-transform: uppercase;
  text-decoration: none;
  white-space: nowrap;
  animation: ctaPulse 2s ease 0.7s infinite;
  box-shadow: 0 8px 24px rgba(212,168,83,0.4);
}
.video-overlay-cta:hover { background: #b88d3b; }
@keyframes ctaPulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.04); }
}
.video-overlay-proof {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; color: rgba(255,255,255,0.7);
}
.video-overlay-proof .stars { color: var(--gold); font-size: 13px; letter-spacing: 1px; }
```

No counter, no prev/next nav zones — solo videos only.

**JS pattern** (added as a new IIFE in the existing `<script>` block):
```javascript
(function () {
  const overlay = document.getElementById('video-overlay');
  const player = document.getElementById('video-overlay-player');
  const closeBtn = document.getElementById('video-overlay-close');
  if (!overlay || !player) return;

  function open(src) {
    if (!src) return;  // empty placeholder; do nothing
    player.src = src;
    overlay.classList.add('active');
    document.documentElement.style.overflow = 'hidden';
    player.play().catch(() => {});  // ignore autoplay-block on some browsers
  }
  function close() {
    overlay.classList.remove('active');
    player.pause();
    player.removeAttribute('src');
    player.load();  // unload buffered video
    document.documentElement.style.overflow = '';
  }

  document.querySelectorAll('.story-btn').forEach(btn => {
    btn.addEventListener('click', () => open(btn.dataset.video));
  });
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.classList.contains('active')) close();
  });
})();
```

**Placeholders (for now):**
- All 4 `.story-btn` elements ship with `data-video=""` (empty string). The `open()` function no-ops on empty values, so clicking does nothing harmful until real video URLs are filled in.
- Nick swaps real URLs into the `data-video=""` attributes via the README's `data-replace` workflow (4 new keys: `story-video-b12`, `story-video-immune`, `story-video-drift`, `story-video-hairnail`).
- README updated to call out: until videos are added, the rings render but don't do anything when tapped. Add this to the "Blockers — MUST fix before any public traffic" section since paid-traffic users will tap and see nothing.

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

1. **Real IG-story videos** for each spray (4 placeholders ship with the pass — `data-replace` keys: `story-video-b12`, `story-video-immune`, `story-video-drift`, `story-video-hairnail`). MP4 format, vertical 9:16 ideally, hosted on Shopify Files or external CDN.
2. **Story poster images** for each spray (4 placeholders default to existing bottle images — same `data-replace` keys but for the `data-poster` attribute).
3. **Verify on a real iPhone** — modal video `autoplay` + `playsinline` behavior and scroll-snap carousel feel can only be confirmed on hardware, not desktop devtools.

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
