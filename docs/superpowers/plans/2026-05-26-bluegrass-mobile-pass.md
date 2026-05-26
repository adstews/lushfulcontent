# Bluegrass Mobile Optimization Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 6 mobile-first optimizations to the shipped Bluegrass Ultimate Wellness Pack lander: density pass, 2-col comparison table, swipe carousels, rotating announcement bar, sticky bottom CTA, IG-story video rings + custom player modal.

**Architecture:** Single-file iteration on `/Users/nicholasstewart/Claude/bluegrass-landers/index.html`. All CSS appends to the existing inline `<style>` block, all JS appends as new IIFEs to the existing inline `<script>` block, HTML changes target specific existing elements. No new files. The repo is on `main`, currently at HEAD `4115ae6` (real product images swap landed). Vercel auto-deploys on push to main.

**Tech Stack:** Vanilla HTML/CSS/JS. CSS conic-gradient (story rings), scroll-snap-type (carousels), IntersectionObserver (sticky CTA visibility), native HTML5 `<video controls autoplay playsinline>` (modal). No new external dependencies.

**Spec:** See [/Users/nicholasstewart/Claude/lushfulcontent/docs/superpowers/specs/2026-05-26-bluegrass-mobile-pass-design.md](../specs/2026-05-26-bluegrass-mobile-pass-design.md) for design decisions and rationale.

---

## File Structure

```
/Users/nicholasstewart/Claude/bluegrass-landers/
├── index.html      # ALL changes go here (single file lander)
├── README.md       # Task 7 updates the TODOs section
├── vercel.json     # unchanged
└── .gitignore      # unchanged
```

---

## Conventions

- Every CSS append uses an Edit operation against the anchor `  </style>` (the closing tag is preceded by 2 spaces and appears exactly once in the file). New rules are prepended above this anchor with a labeled section comment.
- Every JS IIFE append uses an Edit operation against the anchor `  </script>`. New IIFEs are prepended above this anchor.
- Subscription cart URL (constant, used in multiple places): `https://www.bluegrassvitamins.com/cart/47823287189745:1?selling_plan=5323489521`
- After each task: serve locally with `python3 -m http.server 8000`, curl spot-check the structure, kill the server, commit + push.
- After all tasks ship: `npx vercel --prod` to push to the live production URL `https://bluegrass-landers.vercel.app`.
- Working directory for all commands: `/Users/nicholasstewart/Claude/bluegrass-landers/`

---

## Task 1: Mobile density pass

**Files:** Modify `/Users/nicholasstewart/Claude/bluegrass-landers/index.html`

A single `@media (max-width: 720px)` block at the end of `<style>` overrides typography and spacing for tighter mobile rendering. No copy is removed. Existing mobile rules (which set section padding to 56px and section/.bundle-reveal/.scarcity/.final-cta padding to 64px) cascade-lose to these later rules.

- [ ] **Step 1: Prepend the density-pass CSS block above `</style>`**

Use Edit with these exact strings:

old_string:
```
  </style>
```

new_string:
```
    /* === mobile pass: density tightening === */
    @media (max-width: 720px) {
      section { padding: 44px 0; }
      .hero { padding: 40px 0 48px; }
      .hero h1 { font-size: clamp(28px, 7vw, 38px); }
      .hero .lead { font-size: 17px; }
      .countdown { font-size: 12px; padding: 6px 12px; }
      section h2 { font-size: clamp(26px, 6.4vw, 40px); }
      .spray-content h3 { font-size: clamp(22px, 5.8vw, 32px); }
      .spray-benefits li { font-size: 15px; }
      .spray-benefits { gap: 10px; }
      .problem-card { padding: 22px 18px; }
      .testimonial-card { padding: 22px 18px; }
      .testimonial-card p { font-size: 14.5px; }
      .bundle-reveal { padding: 48px 20px; }
      .scarcity { padding: 52px 20px; }
      .final-cta { padding: 56px 20px; }
      .faq-item summary { font-size: 16px; padding: 18px 20px; }
    }
  </style>
```

- [ ] **Step 2: Verify the file is still well-formed and serves 200**

```bash
cd /Users/nicholasstewart/Claude/bluegrass-landers
python3 -m http.server 8000 & sleep 1
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000
curl -s http://localhost:8000 | grep -c 'mobile pass: density tightening'
kill %1
```

Expected: `200` and `1`

- [ ] **Step 3: Commit + push**

```bash
git add index.html
git commit -m "feat(mobile): density pass — tighter typography + padding on <720px"
git push
```

---

## Task 2: 2-column comparison table on mobile

**Files:** Modify `/Users/nicholasstewart/Claude/bluegrass-landers/index.html`

The existing mobile rule for `.compare-grid` collapses to 1-col with labels as full-width navy headers — but this hides the comparator column entirely (`{ display: none }` on `.head:not(.you)`), which confuses users on what the red values are being compared against. This task replaces that rule in place with a 2-col layout where the label spans both columns as a row header and both data columns are visible.

- [ ] **Step 1: Replace the existing compare-grid mobile rule in place**

Use Edit with these exact strings:

old_string:
```
    @media (max-width: 720px) {
      .compare-grid { grid-template-columns: 1fr; }
      .compare-grid > .label { background: var(--navy); color: #fff; font-family: 'Fraunces', serif; font-size: 16px; padding: 14px 22px; }
      .compare-grid > .head:not(.you) { display: none; }
    }
```

new_string:
```
    @media (max-width: 720px) {
      .compare-grid { grid-template-columns: 1fr 1fr; }
      .compare-grid > .head:first-child { display: none; }
      .compare-grid > .head { font-size: 13px; padding: 14px 10px; line-height: 1.25; }
      .compare-grid > .label {
        grid-column: 1 / -1;
        background: var(--navy);
        color: #fff;
        font-family: 'Fraunces', serif;
        font-size: 15px;
        padding: 12px 16px;
        text-align: center;
      }
      .compare-grid > .yes, .compare-grid > .no { font-size: 13.5px; padding: 14px 12px; line-height: 1.4; }
    }
```

- [ ] **Step 2: Verify**

```bash
cd /Users/nicholasstewart/Claude/bluegrass-landers
python3 -m http.server 8000 & sleep 1
curl -s http://localhost:8000 | grep -c '.compare-grid > .label'
kill %1
```

Expected: at least `1` (the rule still exists). Now visually confirm by widening/narrowing browser at the compare table section — at <720px it should show 2 columns with the metric label spanning both.

- [ ] **Step 3: Commit + push**

```bash
git add index.html
git commit -m "feat(mobile): 2-col comparison table — preserves comparator context"
git push
```

---

## Task 3: Swipe carousels for testimonials + problem grid

**Files:** Modify `/Users/nicholasstewart/Claude/bluegrass-landers/index.html`

Converts the `.testimonial-grid` (4 cards) and `.problem-grid` (4 cards) from 1-col stack to horizontal scroll-snap carousels at `<720px`. CSS-only (no JS). Cards take 88% of viewport width so the next card peeks visible on the right edge as a swipe affordance. Custom thin scrollbar styling provides a visual hint.

- [ ] **Step 1: Prepend the carousel CSS above `</style>`**

old_string:
```
  </style>
```

new_string:
```
    /* === mobile pass: swipe carousels (testimonials + problem grid) === */
    @media (max-width: 720px) {
      .testimonial-grid, .problem-grid {
        display: flex;
        grid-template-columns: none;
        overflow-x: auto;
        overflow-y: visible;
        scroll-snap-type: x mandatory;
        gap: 14px;
        padding: 4px 4px 16px;
        margin: 0 -4px;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: thin;
        scrollbar-color: var(--blue) transparent;
      }
      .testimonial-grid::-webkit-scrollbar,
      .problem-grid::-webkit-scrollbar { height: 4px; }
      .testimonial-grid::-webkit-scrollbar-thumb,
      .problem-grid::-webkit-scrollbar-thumb { background: var(--blue); border-radius: 4px; }
      .testimonial-card, .problem-card {
        flex: 0 0 88%;
        scroll-snap-align: start;
        min-width: 0;
      }
    }
  </style>
```

- [ ] **Step 2: Verify**

```bash
cd /Users/nicholasstewart/Claude/bluegrass-landers
python3 -m http.server 8000 & sleep 1
curl -s http://localhost:8000 | grep -c 'swipe carousels (testimonials + problem grid)'
kill %1
```

Expected: `1`

- [ ] **Step 3: Commit + push**

```bash
git add index.html
git commit -m "feat(mobile): swipe carousels for testimonials + problem grid"
git push
```

---

## Task 4: Rotating single-line announcement bar (mobile)

**Files:** Modify `/Users/nicholasstewart/Claude/bluegrass-landers/index.html`

The existing announcement bar shows 3 messages separated by `·`. On mobile this gets tight. This task restructures the markup (wraps spans in a `.bar-messages` container, removes inline dot separators in favor of CSS pseudo-elements), adds mobile-only fade rotation, and a JS IIFE to cycle every 3 seconds. Desktop behavior unchanged visually (all 3 messages with `·` separators via CSS).

- [ ] **Step 1: Replace the bar HTML with the new wrapped structure**

old_string:
```
  <div class="bar">
    <span>FREE SHIPPING</span>·<span>CANCEL ANYTIME</span>·<span>4 WELLNESS SPRAYS, 1 MONTHLY DELIVERY</span>
  </div>
```

new_string:
```
  <div class="bar">
    <div class="bar-messages">
      <span class="active">FREE SHIPPING</span>
      <span>CANCEL ANYTIME</span>
      <span>4 WELLNESS SPRAYS, 1 MONTHLY DELIVERY</span>
    </div>
  </div>
```

- [ ] **Step 2: Prepend the bar-messages CSS above `</style>`**

old_string:
```
  </style>
```

new_string:
```
    /* === mobile pass: rotating announcement bar === */
    .bar-messages { display: inline-block; }
    .bar-messages span { margin: 0; }
    .bar-messages span:not(:last-child)::after { content: '·'; margin: 0 14px; opacity: 0.5; }
    @media (max-width: 720px) {
      .bar-messages { position: relative; display: inline-block; height: 14px; min-width: 280px; vertical-align: middle; }
      .bar-messages span {
        position: absolute; top: 0; left: 50%; transform: translateX(-50%);
        white-space: nowrap;
        opacity: 0;
        transition: opacity .3s ease;
      }
      .bar-messages span.active { opacity: 1; }
      .bar-messages span:not(:last-child)::after { content: none; }
    }
  </style>
```

- [ ] **Step 3: Prepend the rotation IIFE above `</script>`**

old_string:
```
  </script>
```

new_string:
```
    // Mobile announcement bar — rotate messages every 3s
    (function () {
      const spans = document.querySelectorAll('.bar-messages span');
      if (spans.length < 2) return;
      let idx = 0;
      setInterval(() => {
        spans[idx].classList.remove('active');
        idx = (idx + 1) % spans.length;
        spans[idx].classList.add('active');
      }, 3000);
    })();
  </script>
```

- [ ] **Step 4: Verify**

```bash
cd /Users/nicholasstewart/Claude/bluegrass-landers
python3 -m http.server 8000 & sleep 1
curl -s http://localhost:8000 | grep -c 'class="bar-messages"'
curl -s http://localhost:8000 | grep -c 'rotate messages every 3s'
kill %1
```

Expected: `1` and `1`

- [ ] **Step 5: Commit + push**

```bash
git add index.html
git commit -m "feat(mobile): rotating single-message announcement bar (3s cycle)"
git push
```

---

## Task 5: Sticky bottom CTA (mobile)

**Files:** Modify `/Users/nicholasstewart/Claude/bluegrass-landers/index.html`

Adds a gold bottom-fixed CTA that appears once the hero scrolls out of view and hides when the pricing block (`#offer`) enters view. Mobile-only via `@media (max-width: 720px)` (hidden on desktop via a separate min-width rule).

- [ ] **Step 1: Add the sticky CTA element just before the `<script>` block**

The existing script begins with `  <script>` on its own line. Insert the new `<a>` element immediately before.

old_string:
```
  <script>
    // Rolling 24h countdown so the page always shows urgency
```

new_string:
```
  <a class="sticky-cta" id="sticky-cta" href="https://www.bluegrassvitamins.com/cart/47823287189745:1?selling_plan=5323489521">
    <span>Get the Pack — $84.15/mo</span>
    <span class="arrow">›</span>
  </a>

  <script>
    // Rolling 24h countdown so the page always shows urgency
```

- [ ] **Step 2: Prepend the sticky-cta CSS above `</style>`**

old_string:
```
  </style>
```

new_string:
```
    /* === mobile pass: sticky bottom CTA === */
    .sticky-cta { display: none; }
    @media (max-width: 720px) {
      .sticky-cta {
        position: fixed; bottom: 8px; left: 8px; right: 8px;
        background: var(--gold); color: var(--ink);
        padding: 16px 22px; border-radius: 999px;
        display: flex; align-items: center; justify-content: space-between;
        font-size: 15.5px; font-weight: 700;
        letter-spacing: 0.04em; text-transform: uppercase;
        text-decoration: none;
        box-shadow: 0 8px 24px rgba(212,168,83,0.55);
        z-index: 95;
        transform: translateY(140%);
        transition: transform .25s ease-out;
      }
      .sticky-cta.visible { transform: translateY(0); }
      .sticky-cta .arrow { font-size: 22px; line-height: 1; margin-left: 12px; }
    }
  </style>
```

- [ ] **Step 3: Prepend the sticky-CTA visibility IIFE above `</script>`**

old_string:
```
  </script>
```

new_string:
```
    // Mobile sticky CTA — show after hero scrolls out, hide when pricing block in view
    (function () {
      const cta = document.getElementById('sticky-cta');
      const hero = document.querySelector('.hero');
      const offer = document.getElementById('offer');
      if (!cta || !hero || !offer) return;
      let pastHero = false;
      let inOffer = false;
      function update() {
        cta.classList.toggle('visible', pastHero && !inOffer);
      }
      new IntersectionObserver(([e]) => {
        pastHero = !e.isIntersecting;
        update();
      }, { threshold: 0 }).observe(hero);
      new IntersectionObserver(([e]) => {
        inOffer = e.isIntersecting;
        update();
      }, { threshold: 0 }).observe(offer);
    })();
  </script>
```

- [ ] **Step 4: Verify**

```bash
cd /Users/nicholasstewart/Claude/bluegrass-landers
python3 -m http.server 8000 & sleep 1
curl -s http://localhost:8000 | grep -c 'id="sticky-cta"'
curl -s http://localhost:8000 | grep -c 'Mobile sticky CTA'
kill %1
```

Expected: `1` and `1`

- [ ] **Step 5: Commit + push**

```bash
git add index.html
git commit -m "feat(mobile): sticky bottom CTA (gold, price-led, hide on #offer)"
git push
```

---

## Task 6: IG-story video rings + custom player modal

**Files:** Modify `/Users/nicholasstewart/Claude/bluegrass-landers/index.html`

The biggest task — adds 5 coordinated pieces:
1. A `<button class="story-btn">` overlay inside each of the 4 `.spray-visual` elements
2. CSS for story-btn (conic-gradient IG ring + 3px inner cream border + play SVG)
3. CSS for the shared `.video-overlay` modal (black-92 backdrop + blur + gold CTA + pulse animation)
4. A single `.video-overlay` modal element appended near end of `<body>` (just before the `<script>`)
5. A JS IIFE for open/close (click, ESC, click-outside)

The `data-video=""` attributes ship empty — the open() function no-ops on empty values, so clicking does nothing until Nick fills in real video URLs via the README workflow.

- [ ] **Step 1: Add story-btn inside B Boost B-12 spray-visual**

old_string:
```
          <img src="https://cdn.shopify.com/s/files/1/0712/4867/5057/files/1-BBoostB-12-Front_3fe38a39-3d82-4e12-b12b-20653264bd63.png?v=1778809230" data-replace="spray-b12-bottle" alt="B Boost B-12 sublingual spray bottle">
```

new_string:
```
          <img src="https://cdn.shopify.com/s/files/1/0712/4867/5057/files/1-BBoostB-12-Front_3fe38a39-3d82-4e12-b12b-20653264bd63.png?v=1778809230" data-replace="spray-b12-bottle" alt="B Boost B-12 sublingual spray bottle">
          <button class="story-btn" data-video="" data-replace="story-video-b12" aria-label="Watch B Boost B-12 story video">
            <span class="story-btn-inner">
              <svg width="18" height="18" fill="#fff" viewBox="0 0 24 24"><path d="M8 5.14v13.72a1 1 0 001.5.86l11.04-6.86a1 1 0 000-1.72L9.5 4.28a1 1 0 00-1.5.86z"/></svg>
            </span>
          </button>
```

- [ ] **Step 2: Add story-btn inside Immune Response spray-visual**

old_string:
```
          <img src="https://cdn.shopify.com/s/files/1/0712/4867/5057/files/1-ImmuneResponse-FrontImage.png?v=1778809452" data-replace="spray-immune-bottle" alt="Immune Response sublingual spray bottle">
```

new_string:
```
          <img src="https://cdn.shopify.com/s/files/1/0712/4867/5057/files/1-ImmuneResponse-FrontImage.png?v=1778809452" data-replace="spray-immune-bottle" alt="Immune Response sublingual spray bottle">
          <button class="story-btn" data-video="" data-replace="story-video-immune" aria-label="Watch Immune Response story video">
            <span class="story-btn-inner">
              <svg width="18" height="18" fill="#fff" viewBox="0 0 24 24"><path d="M8 5.14v13.72a1 1 0 001.5.86l11.04-6.86a1 1 0 000-1.72L9.5 4.28a1 1 0 00-1.5.86z"/></svg>
            </span>
          </button>
```

- [ ] **Step 3: Add story-btn inside Drift Away spray-visual**

old_string:
```
          <img src="https://cdn.shopify.com/s/files/1/0712/4867/5057/files/1-DriftAwaySleepSpray-FrontImage_95dd10a5-544d-43c9-8a69-90b888db814a.png?v=1778809364" data-replace="spray-drift-bottle" alt="Drift Away Sleep Spray bottle">
```

new_string:
```
          <img src="https://cdn.shopify.com/s/files/1/0712/4867/5057/files/1-DriftAwaySleepSpray-FrontImage_95dd10a5-544d-43c9-8a69-90b888db814a.png?v=1778809364" data-replace="spray-drift-bottle" alt="Drift Away Sleep Spray bottle">
          <button class="story-btn" data-video="" data-replace="story-video-drift" aria-label="Watch Drift Away story video">
            <span class="story-btn-inner">
              <svg width="18" height="18" fill="#fff" viewBox="0 0 24 24"><path d="M8 5.14v13.72a1 1 0 001.5.86l11.04-6.86a1 1 0 000-1.72L9.5 4.28a1 1 0 00-1.5.86z"/></svg>
            </span>
          </button>
```

- [ ] **Step 4: Add story-btn inside Hair & Nail spray-visual**

old_string:
```
          <img src="https://cdn.shopify.com/s/files/1/0712/4867/5057/files/1-HairandNailSupportSpray-FrontImage.png?v=1778809187" data-replace="spray-hairnail-bottle" alt="Hair &amp; Nail Support Spray bottle">
```

new_string:
```
          <img src="https://cdn.shopify.com/s/files/1/0712/4867/5057/files/1-HairandNailSupportSpray-FrontImage.png?v=1778809187" data-replace="spray-hairnail-bottle" alt="Hair &amp; Nail Support Spray bottle">
          <button class="story-btn" data-video="" data-replace="story-video-hairnail" aria-label="Watch Hair &amp; Nail story video">
            <span class="story-btn-inner">
              <svg width="18" height="18" fill="#fff" viewBox="0 0 24 24"><path d="M8 5.14v13.72a1 1 0 001.5.86l11.04-6.86a1 1 0 000-1.72L9.5 4.28a1 1 0 00-1.5.86z"/></svg>
            </span>
          </button>
```

- [ ] **Step 5: Add the video-overlay modal HTML before the sticky-cta element (which precedes the script block from Task 5)**

If Task 5 has already landed, the anchor includes `<a class="sticky-cta"`. Otherwise the anchor is just `  <script>`. Use whichever exists.

Try first (post-Task-5 anchor):

old_string:
```
  <a class="sticky-cta" id="sticky-cta" href="https://www.bluegrassvitamins.com/cart/47823287189745:1?selling_plan=5323489521">
```

new_string:
```
  <div class="video-overlay" id="video-overlay" aria-hidden="true">
    <button class="video-overlay-close" id="video-overlay-close" aria-label="Close video">
      <svg width="20" height="20" fill="none" stroke="#fff" stroke-width="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
    </button>
    <video id="video-overlay-player" controls autoplay playsinline></video>
    <div class="video-overlay-bottom">
      <a class="video-overlay-cta" href="https://www.bluegrassvitamins.com/cart/47823287189745:1?selling_plan=5323489521">Get the Pack — $84.15/mo</a>
      <div class="video-overlay-proof"><span class="stars">★★★★★</span> 4.9/5 · 50,000+ bottles shipped</div>
    </div>
  </div>

  <a class="sticky-cta" id="sticky-cta" href="https://www.bluegrassvitamins.com/cart/47823287189745:1?selling_plan=5323489521">
```

- [ ] **Step 6: Prepend the story-btn + video-overlay CSS above `</style>`**

old_string:
```
  </style>
```

new_string:
```
    /* === mobile pass: IG story rings + video modal === */
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
    .story-btn-inner svg { filter: drop-shadow(0 1px 3px rgba(0,0,0,0.5)); z-index: 1; }

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
      width: 90vw; max-width: 540px;
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
      background: var(--gold); color: var(--ink);
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
  </style>
```

- [ ] **Step 7: Prepend the video-modal IIFE above `</script>`**

old_string:
```
  </script>
```

new_string:
```
    // Story ring video modal — open/close
    (function () {
      const overlay = document.getElementById('video-overlay');
      const player = document.getElementById('video-overlay-player');
      const closeBtn = document.getElementById('video-overlay-close');
      if (!overlay || !player) return;
      function open(src) {
        if (!src) return;
        player.src = src;
        overlay.classList.add('active');
        overlay.setAttribute('aria-hidden', 'false');
        document.documentElement.style.overflow = 'hidden';
        player.play().catch(() => {});
      }
      function close() {
        overlay.classList.remove('active');
        overlay.setAttribute('aria-hidden', 'true');
        player.pause();
        player.removeAttribute('src');
        player.load();
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
  </script>
```

- [ ] **Step 8: Verify**

```bash
cd /Users/nicholasstewart/Claude/bluegrass-landers
python3 -m http.server 8000 & sleep 1
echo "story-btn count (expect 4):" && curl -s http://localhost:8000 | grep -c 'class="story-btn"'
echo "video-overlay element (expect 1):" && curl -s http://localhost:8000 | grep -c 'id="video-overlay"'
echo "Story ring video modal IIFE (expect 1):" && curl -s http://localhost:8000 | grep -c 'Story ring video modal'
kill %1
```

Expected: `4`, `1`, `1`

- [ ] **Step 9: Commit + push**

```bash
git add index.html
git commit -m "feat(mobile): IG-story rings per spray + custom player modal"
git push
```

---

## Task 7: README update + production deploy

**Files:**
- Modify `/Users/nicholasstewart/Claude/bluegrass-landers/README.md`

Add 4 new TODOs to the "Blockers" + "Outstanding TODOs" sections covering the IG video placeholders, and trigger a production deploy.

- [ ] **Step 1: Update the Blockers section in README.md to add the IG-video TODO**

Use Edit:

old_string:
```
## Blockers — MUST fix before any public traffic

- [ ] **Replace 3 placeholder testimonials with real Bluegrass reviews.** Only the Jason / Drift Away quote is verified. The other 3 cards (Maria L., Katie R., Dan T.) are plausible drafts labeled "Verified buyer" — running these against paid traffic violates FTC endorsement guides. Either swap with real reviews or remove the "Verified buyer" label.
```

new_string:
```
## Blockers — MUST fix before any public traffic

- [ ] **Add 4 real IG-story videos for the spray rings.** Each spray (B Boost B-12, Immune Response, Drift Away, Hair & Nail) has a circular IG-story ring overlay on its bottle image. The `data-video=""` attribute on each `<button class="story-btn">` is currently empty — tapping a ring is a no-op until real video URLs are filled in. Use the `data-replace` keys: `story-video-b12`, `story-video-immune`, `story-video-drift`, `story-video-hairnail`. Recommended: 9:16 portrait MP4s hosted on Shopify Files or external CDN.
- [ ] **Replace 3 placeholder testimonials with real Bluegrass reviews.** Only the Jason / Drift Away quote is verified. The other 3 cards (Maria L., Katie R., Dan T.) are plausible drafts labeled "Verified buyer" — running these against paid traffic violates FTC endorsement guides. Either swap with real reviews or remove the "Verified buyer" label.
```

- [ ] **Step 2: Update the asset replacement workflow section to include the new video keys**

Use Edit:

old_string:
```
3. In the Shopify Page source view, find the placeholder by its `data-replace` key:
   - `hero-4-bottles` — main hero image
   - `bundle-hero-4-bottles-lifestyle` — bundle reveal full-width image
   - `spray-b12-bottle`, `spray-immune-bottle`, `spray-drift-bottle`, `spray-hairnail-bottle` — individual bottles
   - `science-absorption-diagram` — sprays-vs-pills diagram
   - `testimonial-jason-avatar`, `testimonial-2-avatar`, `testimonial-3-avatar`, `testimonial-4-avatar` — customer photos
4. Replace the `src=` value with the Shopify CDN URL
```

new_string:
```
3. In the Shopify Page source view, find the placeholder by its `data-replace` key:
   - `hero-4-bottles` — main hero image
   - `bundle-hero-4-bottles-lifestyle` — bundle reveal full-width image
   - `spray-b12-bottle`, `spray-immune-bottle`, `spray-drift-bottle`, `spray-hairnail-bottle` — individual bottles
   - `science-absorption-diagram` — sprays-vs-pills diagram
   - `testimonial-jason-avatar`, `testimonial-2-avatar`, `testimonial-3-avatar`, `testimonial-4-avatar` — customer photos
   - `story-video-b12`, `story-video-immune`, `story-video-drift`, `story-video-hairnail` — IG-story video URLs (set as `data-video=""` value on each `<button class="story-btn">`, not as `src`)
4. Replace the `src=` value with the Shopify CDN URL (or the `data-video=""` value for story videos)
```

- [ ] **Step 3: Commit, push, and deploy to production**

```bash
cd /Users/nicholasstewart/Claude/bluegrass-landers
git add README.md
git commit -m "docs: README — add IG-story video TODOs from mobile pass"
git push
npx vercel --prod
```

Expected: `npx vercel --prod` succeeds with a production URL printed. Aliased URL `https://bluegrass-landers.vercel.app` reflects the changes.

- [ ] **Step 4: Verify production reflects all mobile-pass changes**

```bash
curl -s https://bluegrass-landers.vercel.app | grep -c 'class="story-btn"'
curl -s https://bluegrass-landers.vercel.app | grep -c 'id="sticky-cta"'
curl -s https://bluegrass-landers.vercel.app | grep -c 'class="bar-messages"'
curl -s https://bluegrass-landers.vercel.app | grep -c 'mobile pass: density tightening'
```

Expected: `4`, `1`, `1`, `1`

---

## Self-Review Checklist (run after all tasks ship)

- [ ] All 6 features from the spec implemented:
  - [ ] #1 Sticky bottom CTA (Task 5)
  - [ ] #2 Carousels for testimonials + problem grid (Task 3)
  - [ ] #3 IG-story rings + video modal (Task 6)
  - [ ] #4 Mobile density pass (Task 1)
  - [ ] #5 Rotating announcement bar (Task 4)
  - [ ] #6 2-col comparison table on mobile (Task 2)
- [ ] 7 commits landed, pushed to main
- [ ] Production deploy succeeded, `bluegrass-landers.vercel.app` updated
- [ ] README's Blockers list now includes the 4 IG-video TODO
- [ ] No regressions: existing countdown timer, pricing toggle, FAQ accordion all still work
- [ ] Production curl grep counts match expected values
