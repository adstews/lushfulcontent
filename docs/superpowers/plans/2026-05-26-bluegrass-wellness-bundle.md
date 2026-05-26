# Bluegrass Ultimate Wellness Pack Landing Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a long-form direct-response landing page for Bluegrass Supplements' Ultimate Wellness Pack ($84.15/mo subscription, $99 one-time), hosted on Vercel for client preview and designed to paste into a Shopify Page.

**Architecture:** Single self-contained `index.html` with inline `<style>` and `<script>` blocks. Vanilla HTML/CSS/JS — no build step, no framework. All buy buttons deeplink to Shopify cart URLs (variant `47823287189745`, selling_plan `5323489521`). Placeholder images via `placehold.co` with `data-replace` attributes for later asset swap-in.

**Tech Stack:**
- Vanilla HTML5 + CSS3 + ES6 (no transpilation)
- Google Fonts CDN (Fraunces serif, Inter sans)
- `placehold.co` for image placeholders
- Vercel for preview hosting (static-only, no build)
- GitHub `adstews/bluegrass-landers` for source control

**Spec:** See `docs/superpowers/specs/2026-05-26-bluegrass-wellness-bundle-design.md` for design context and decisions.

---

## File Structure

```
/Users/nicholasstewart/Claude/bluegrass-landers/
├── index.html      # The full lander (everything inlined)
├── vercel.json     # Tells Vercel to skip build, serve static
├── README.md       # Handoff instructions for Shopify paste-in
└── .gitignore      # Standard ignores
```

Everything lives in one HTML file: CSS inlined in `<style>`, JS inlined in `<script>`. This is deliberate — Shopify Pages accept a single HTML chunk pasted into the source view. Splitting into separate CSS/JS files would force asset hosting and break the paste-in workflow.

---

## Conventions

- **CSS variables** for the entire palette at `:root` — every color reference uses `var(--name)`.
- **Section pattern**: content sections that want the default 88px vertical padding use `<section class="section section-NAME">` with a `.wrap` container inside. Sections with their own padding (hero, trust-strip, bundle-reveal, scarcity, final-cta) just use `<section class="section-NAME">` (no `.section` class).
- **CTA buttons**: always class `btn` (base style is the primary navy button). Subscription CTAs link to `https://www.bluegrassvitamins.com/cart/47823287189745:1?selling_plan=5323489521`. One-time CTAs use `btn btn-secondary` (outlined) and link to `https://www.bluegrassvitamins.com/cart/47823287189745:1`. Urgency CTAs use `btn btn-gold`.
- **Image placeholders**: `<img src="https://placehold.co/{w}x{h}/{bg-hex}/FFFFFF?text={label}" data-replace="{semantic-key}" alt="...">`. The `data-replace` key is a searchable token Nick uses to find-and-replace once real assets land in Shopify CDN.
- **Commits**: after each task, commit with a `feat:`, `chore:`, or `style:` prefix and the section/component name.

---

## Task 1: Scaffold repo, vercel.json, GitHub, Vercel project

**Files:**
- Create: `/Users/nicholasstewart/Claude/bluegrass-landers/.gitignore`
- Create: `/Users/nicholasstewart/Claude/bluegrass-landers/vercel.json`
- Create: `/Users/nicholasstewart/Claude/bluegrass-landers/index.html` (placeholder)

- [ ] **Step 1: Create the directory**

```bash
mkdir -p /Users/nicholasstewart/Claude/bluegrass-landers
cd /Users/nicholasstewart/Claude/bluegrass-landers
```

- [ ] **Step 2: Create `.gitignore`**

```
.DS_Store
.vercel
node_modules
*.log
```

- [ ] **Step 3: Create `vercel.json`**

```json
{
  "installCommand": "echo skipping-install",
  "buildCommand": "echo skipping-build",
  "outputDirectory": "."
}
```

- [ ] **Step 4: Create placeholder `index.html`**

```html
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Bluegrass Ultimate Wellness Pack</title></head>
<body>Coming soon.</body>
</html>
```

- [ ] **Step 5: Initialize git, first commit**

```bash
cd /Users/nicholasstewart/Claude/bluegrass-landers
git init -b main
git add .
git commit -m "chore: scaffold bluegrass-landers repo"
```

- [ ] **Step 6: Create GitHub repo and push**

```bash
gh repo create adstews/bluegrass-landers --private --source=. --remote=origin --push
```

Expected output: repo URL `https://github.com/adstews/bluegrass-landers`

- [ ] **Step 7: Link Vercel project**

```bash
cd /Users/nicholasstewart/Claude/bluegrass-landers
npx vercel link --yes --project bluegrass-landers
```

If the project does not exist, follow the prompts to create it under team `adstews` (or the matching team). Verify `.vercel/project.json` was created.

- [ ] **Step 8: First deploy (preview)**

```bash
npx vercel
```

Expected output: a preview URL like `https://bluegrass-landers-abc123.vercel.app`. Visit it and confirm "Coming soon." renders.

- [ ] **Step 9: Commit Vercel config**

```bash
git add .vercel/project.json
git commit -m "chore: link vercel project"
git push
```

---

## Task 2: HTML skeleton + base CSS variables

**Files:**
- Modify: `/Users/nicholasstewart/Claude/bluegrass-landers/index.html` (full rewrite)

- [ ] **Step 1: Replace `index.html` with the full skeleton**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Ultimate Wellness Pack — Bluegrass Supplements</title>
  <meta name="description" content="4 sublingual sprays. One monthly delivery. Crash-free energy, daily immune defense, restful sleep, and visible hair & nail support — for $84.15/month." />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;0,9..144,700;1,9..144,400;1,9..144,600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --navy: #1B4D8C;
      --blue: #5BA3D9;
      --cream: #FAF8F4;
      --sand: #F0EDE6;
      --ink: #1A2238;
      --muted: #6B6F7A;
      --gold: #D4A853;
      --red: #C75450;
      --line: #E5E0D8;
      --green: #2D8659;
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: var(--ink);
      background: var(--cream);
      line-height: 1.55;
      -webkit-font-smoothing: antialiased;
    }
    h1, h2, h3, h4, .serif {
      font-family: 'Fraunces', Georgia, serif;
      font-weight: 600;
      letter-spacing: -0.01em;
      line-height: 1.1;
    }
    em, .italic { font-style: italic; }
    a { color: inherit; }
    img { max-width: 100%; display: block; }
  </style>
</head>
<body>
  <!-- sections injected by subsequent tasks -->
</body>
</html>
```

- [ ] **Step 2: Verify in browser**

```bash
cd /Users/nicholasstewart/Claude/bluegrass-landers
python3 -m http.server 8000 &
open http://localhost:8000
```

Expected: blank cream-colored page, no console errors. Kill server with `kill %1`.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: HTML skeleton with palette + fonts"
git push
```

---

## Task 3: Reusable component CSS (.wrap, .btn, section, .eyebrow)

**Files:**
- Modify: `/Users/nicholasstewart/Claude/bluegrass-landers/index.html` — append to `<style>` block

- [ ] **Step 1: Add the component CSS inside `<style>` (after the `img` rule)**

```css
    .wrap { max-width: 1120px; margin: 0 auto; padding: 0 24px; }

    section { padding: 88px 0; }
    section h2 {
      font-size: clamp(32px, 4.2vw, 50px);
      margin: 0 0 16px;
      max-width: 820px;
    }
    section .sub {
      font-size: 18px;
      color: var(--muted);
      max-width: 680px;
      margin: 0 0 48px;
    }
    @media (max-width: 720px) {
      section { padding: 56px 0; }
    }

    .eyebrow {
      display: inline-block;
      text-transform: uppercase;
      font-size: 12px;
      letter-spacing: 0.22em;
      color: var(--navy);
      font-weight: 600;
      padding: 6px 14px;
      background: rgba(91,163,217,0.15);
      border-radius: 999px;
      margin-bottom: 20px;
    }

    .btn {
      display: inline-block;
      background: var(--navy);
      color: #fff;
      font-weight: 700;
      padding: 16px 32px;
      border-radius: 999px;
      text-decoration: none;
      font-size: 16px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      transition: transform .15s ease, background .15s ease, box-shadow .15s ease;
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(27,77,140,0.2);
    }
    .btn:hover { background: #143b6e; transform: translateY(-2px); box-shadow: 0 8px 20px rgba(27,77,140,0.3); }
    .btn.big { padding: 20px 40px; font-size: 18px; }
    .btn.btn-secondary {
      background: #fff;
      color: var(--navy);
      border: 2px solid var(--navy);
      box-shadow: none;
    }
    .btn.btn-secondary:hover { background: var(--navy); color: #fff; }
    .btn.btn-gold { background: var(--gold); color: var(--ink); box-shadow: 0 4px 12px rgba(212,168,83,0.3); }
    .btn.btn-gold:hover { background: #b88d3b; }
```

- [ ] **Step 2: Verify in browser** (still blank — components are unused until Task 4+)

```bash
python3 -m http.server 8000 &
open http://localhost:8000
kill %1
```

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: shared component styles (wrap, btn, section, eyebrow)"
git push
```

---

## Task 4: Announcement bar (Section 0)

**Files:**
- Modify: `/Users/nicholasstewart/Claude/bluegrass-landers/index.html` — append CSS + add to `<body>`

- [ ] **Step 1: Append CSS to `<style>` block**

```css
    .bar {
      background: var(--navy);
      color: #fff;
      font-size: 13px;
      text-align: center;
      padding: 11px 16px;
      letter-spacing: 0.12em;
      font-weight: 600;
      text-transform: uppercase;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .bar span { margin: 0 14px; opacity: 0.95; }
    @media (max-width: 720px) {
      .bar { font-size: 11px; padding: 9px 12px; }
      .bar span { margin: 0 6px; }
    }
```

- [ ] **Step 2: Replace the body comment with the announcement bar**

```html
<body>
  <div class="bar">
    <span>FREE SHIPPING</span>·<span>CANCEL ANYTIME</span>·<span>4 WELLNESS SPRAYS, 1 MONTHLY DELIVERY</span>
  </div>

  <!-- sections injected by subsequent tasks -->
</body>
```

- [ ] **Step 3: Verify**

```bash
python3 -m http.server 8000 &
open http://localhost:8000
kill %1
```

Expected: navy bar at top with the three pipe-separated messages, sticky on scroll.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: sticky announcement bar"
git push
```

---

## Task 5: Hero (Section 1)

**Files:**
- Modify: `/Users/nicholasstewart/Claude/bluegrass-landers/index.html` — append CSS + add section to `<body>`

- [ ] **Step 1: Append CSS**

```css
    .hero {
      padding: 60px 0 72px;
      background: linear-gradient(180deg, var(--cream) 0%, #EEF4FA 100%);
    }
    .hero-grid {
      display: grid;
      grid-template-columns: 1.1fr 1fr;
      gap: 56px;
      align-items: center;
    }
    @media (max-width: 880px) {
      .hero-grid { grid-template-columns: 1fr; gap: 32px; }
    }
    .hero h1 {
      font-size: clamp(38px, 5.4vw, 64px);
      margin: 0 0 20px;
    }
    .hero h1 em { color: var(--navy); font-style: italic; }
    .hero .lead {
      font-size: 19px;
      color: #2c3140;
      margin: 0 0 28px;
      max-width: 560px;
    }
    .hero-cta { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
    .trust-row {
      display: flex; gap: 18px; align-items: center; margin-top: 28px; font-size: 14px; color: var(--muted); flex-wrap: wrap;
    }
    .trust-row b { color: var(--ink); font-weight: 600; }
    .star-row { color: var(--gold); letter-spacing: 2px; font-size: 16px; }
    .hero-visual {
      background: #fff;
      border-radius: 18px;
      overflow: hidden;
      aspect-ratio: 4 / 5;
      box-shadow: 0 30px 60px -20px rgba(27,77,140,0.25);
    }
    .hero-visual img { width: 100%; height: 100%; object-fit: cover; }
    .countdown {
      display: inline-flex; gap: 12px; align-items: center;
      background: rgba(212,168,83,0.15);
      border: 1px solid rgba(212,168,83,0.4);
      color: #6b5320;
      padding: 8px 16px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 18px;
    }
    .countdown b { color: var(--ink); font-variant-numeric: tabular-nums; }
```

- [ ] **Step 2: Insert hero section into `<body>` after the announcement bar**

```html
  <section class="hero">
    <div class="wrap">
      <div class="hero-grid">
        <div>
          <div class="countdown">
            ⏰ Today's allocation ends in <b id="countdown-display">0d 13h 06m</b>
          </div>
          <span class="eyebrow">10K+ Happy Customers</span>
          <h1>STOP Choking Down <em>12 Pills A Day</em> That Your Body Barely Absorbs</h1>
          <p class="lead">
            Get all 4 sublingual wellness sprays for <b>$84.15/month</b> — less than $21 per spray.
            <br>Save <b>$71.85</b> vs. buying them separately.
          </p>
          <div class="hero-cta">
            <a class="btn big" href="https://www.bluegrassvitamins.com/cart/47823287189745:1?selling_plan=5323489521">Claim My Starter Pack</a>
          </div>
          <div class="trust-row">
            <span class="star-row">★★★★★</span>
            <span><b>4.9/5</b> · 50,000+ bottles shipped</span>
          </div>
        </div>
        <div class="hero-visual">
          <img src="https://placehold.co/800x1000/1B4D8C/FFFFFF?text=4+Bottles+Hero" data-replace="hero-4-bottles" alt="Ultimate Wellness Pack — 4 sublingual spray bottles">
        </div>
      </div>
    </div>
  </section>
```

- [ ] **Step 3: Append a tiny countdown script inside a new `<script>` at the bottom of `<body>`**

```html
  <script>
    // Rolling 24h countdown so the page always shows urgency
    (function () {
      const el = document.getElementById('countdown-display');
      if (!el) return;
      function tick() {
        const now = new Date();
        const end = new Date(now);
        end.setHours(23, 59, 59, 999);
        const diff = end - now;
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        el.textContent = `0d ${String(h).padStart(2,'0')}h ${String(m).padStart(2,'0')}m`;
      }
      tick();
      setInterval(tick, 30000);
    })();
  </script>
```

- [ ] **Step 4: Verify**

```bash
python3 -m http.server 8000 &
open http://localhost:8000
kill %1
```

Expected: full hero with countdown badge, headline, subhead with bold numbers, blue Claim button, star row, and a tall blue placeholder image on the right.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: hero section with countdown + primary CTA"
git push
```

---

## Task 6: Trust strip (Section 2)

**Files:**
- Modify: `/Users/nicholasstewart/Claude/bluegrass-landers/index.html`

- [ ] **Step 1: Append CSS**

```css
    .trust-strip { background: #fff; padding: 36px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
    .trust-strip .wrap { display: flex; gap: 32px; align-items: center; justify-content: space-around; flex-wrap: wrap; }
    .trust-item { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 600; color: var(--ink); letter-spacing: 0.05em; text-transform: uppercase; }
    .trust-item .ic { width: 28px; height: 28px; background: var(--navy); color: #fff; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; }
```

- [ ] **Step 2: Insert section after the hero**

```html
  <section class="trust-strip">
    <div class="wrap">
      <div class="trust-item"><span class="ic">✓</span>Physician-Formulated</div>
      <div class="trust-item"><span class="ic">✓</span>Lab-Tested</div>
      <div class="trust-item"><span class="ic">✓</span>Third-Party Tested</div>
      <div class="trust-item"><span class="ic">✓</span>Made in USA</div>
    </div>
  </section>
```

- [ ] **Step 3: Verify + commit**

```bash
python3 -m http.server 8000 & sleep 1 && open http://localhost:8000 && sleep 2 && kill %1
git add index.html
git commit -m "feat: trust strip (4 badges, no HSA/FSA per client direction)"
git push
```

---

## Task 7: Testimonial scroller (Section 3)

**Files:**
- Modify: `/Users/nicholasstewart/Claude/bluegrass-landers/index.html`

- [ ] **Step 1: Append CSS**

```css
    .testimonials { background: var(--sand); }
    .testimonial-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
    @media (max-width: 980px) { .testimonial-grid { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 560px) { .testimonial-grid { grid-template-columns: 1fr; } }
    .testimonial-card {
      background: #fff;
      padding: 28px 24px;
      border-radius: 14px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.04);
      display: flex;
      flex-direction: column;
    }
    .testimonial-card .stars { color: var(--gold); letter-spacing: 2px; margin-bottom: 12px; font-size: 14px; }
    .testimonial-card p { margin: 0 0 18px; font-size: 15px; line-height: 1.55; color: #2c3140; flex: 1; }
    .testimonial-card .who { display: flex; align-items: center; gap: 10px; margin-top: auto; }
    .testimonial-card .avatar { width: 38px; height: 38px; border-radius: 50%; overflow: hidden; flex-shrink: 0; background: var(--blue); }
    .testimonial-card .avatar img { width: 100%; height: 100%; object-fit: cover; }
    .testimonial-card .who b { font-size: 14px; }
    .testimonial-card .who span { display: block; font-size: 12px; color: var(--muted); }
    .testimonials .disclaimer { text-align: center; font-size: 12px; color: var(--muted); margin-top: 32px; }
```

- [ ] **Step 2: Insert section**

```html
  <section class="section testimonials">
    <div class="wrap">
      <span class="eyebrow">Real Customers, Real Results</span>
      <h2>What people say after their first month</h2>
      <div class="testimonial-grid">
        <div class="testimonial-card">
          <div class="stars">★★★★★</div>
          <p>"Drift Away is a life saver when I need it. I work a very stressful job and I'm happy to know it's full of good safe ingredients."</p>
          <div class="who">
            <div class="avatar"><img src="https://placehold.co/80x80/5BA3D9/FFFFFF?text=J" data-replace="testimonial-jason-avatar" alt="Jason"></div>
            <div><b>Jason</b><span>Verified buyer · Drift Away</span></div>
          </div>
        </div>
        <div class="testimonial-card">
          <div class="stars">★★★★★</div>
          <p>"The B-12 spray hits in minutes — I dropped my afternoon coffee and haven't crashed once in 3 weeks. Honestly didn't believe a spray would do anything."</p>
          <div class="who">
            <div class="avatar"><img src="https://placehold.co/80x80/5BA3D9/FFFFFF?text=M" data-replace="testimonial-2-avatar" alt="Maria"></div>
            <div><b>Maria L.</b><span>Verified buyer · B Boost B-12</span></div>
          </div>
        </div>
        <div class="testimonial-card">
          <div class="stars">★★★★★</div>
          <p>"I take all 4 sprays daily. Sleep is deeper, nails are stronger, and I haven't been sick all winter. The whole pack is now part of my routine."</p>
          <div class="who">
            <div class="avatar"><img src="https://placehold.co/80x80/5BA3D9/FFFFFF?text=K" data-replace="testimonial-3-avatar" alt="Katie"></div>
            <div><b>Katie R.</b><span>Verified buyer · Ultimate Wellness Pack</span></div>
          </div>
        </div>
        <div class="testimonial-card">
          <div class="stars">★★★★★</div>
          <p>"I hated swallowing horse-pill multivitamins. The spray format is the only reason I actually take them every day now."</p>
          <div class="who">
            <div class="avatar"><img src="https://placehold.co/80x80/5BA3D9/FFFFFF?text=D" data-replace="testimonial-4-avatar" alt="Dan"></div>
            <div><b>Dan T.</b><span>Verified buyer · Immune Response</span></div>
          </div>
        </div>
      </div>
      <p class="disclaimer">Individual results vary. Testimonials reflect personal experience and are not a guarantee of outcomes.</p>
    </div>
  </section>
```

- [ ] **Step 3: Verify + commit**

```bash
python3 -m http.server 8000 & sleep 1 && open http://localhost:8000 && sleep 2 && kill %1
git add index.html
git commit -m "feat: testimonial scroller (Jason + 3 placeholders)"
git push
```

---

## Task 8: Problem grid (Section 4)

**Files:**
- Modify: `/Users/nicholasstewart/Claude/bluegrass-landers/index.html`

- [ ] **Step 1: Append CSS**

```css
    .problem { background: var(--cream); }
    .problem-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
    @media (max-width: 980px) { .problem-grid { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 560px) { .problem-grid { grid-template-columns: 1fr; } }
    .problem-card {
      background: #fff;
      border-left: 4px solid var(--red);
      padding: 28px 24px;
      border-radius: 10px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    }
    .problem-card .icon { font-size: 30px; margin-bottom: 12px; }
    .problem-card h4 {
      font-family: 'Fraunces', serif;
      font-size: 20px;
      margin: 0 0 8px;
      line-height: 1.25;
    }
    .problem-card p { font-size: 14.5px; color: var(--muted); margin: 0; line-height: 1.55; }
```

- [ ] **Step 2: Insert section**

```html
  <section class="section problem">
    <div class="wrap">
      <span class="eyebrow">If you're nodding along to any of this…</span>
      <h2>You're not "low energy." Your routine is broken.</h2>
      <p class="sub">Most people are doing the right thing — taking vitamins, drinking water, trying to sleep more. The problem isn't effort. It's the delivery system.</p>
      <div class="problem-grid">
        <div class="problem-card">
          <div class="icon">💊</div>
          <h4>You forget half your pills by 10am</h4>
          <p>Five bottles on the counter, three different schedules, one cup of coffee — and the routine collapses by Wednesday.</p>
        </div>
        <div class="problem-card">
          <div class="icon">🌀</div>
          <h4>Capsules barely make it past your stomach</h4>
          <p>Research suggests a large portion of what's printed on the label never actually reaches your bloodstream. You're paying full price for partial absorption.</p>
        </div>
        <div class="problem-card">
          <div class="icon">🍬</div>
          <h4>Gummies are basically candy</h4>
          <p>Sugar, dye, a sprinkle of vitamins, $40 a month. Tastes great. Does almost nothing.</p>
        </div>
        <div class="problem-card">
          <div class="icon">😩</div>
          <h4>$200/month in bottles. Still tired.</h4>
          <p>You're stacking energy + immune + sleep + hair brands and your supplement shelf looks like a CVS aisle — and the needle hasn't moved.</p>
        </div>
      </div>
    </div>
  </section>
```

- [ ] **Step 3: Verify + commit**

```bash
python3 -m http.server 8000 & sleep 1 && open http://localhost:8000 && sleep 2 && kill %1
git add index.html
git commit -m "feat: problem agitate-pain grid (4 cards)"
git push
```

---

## Task 9: Bundle reveal (Section 5)

**Files:**
- Modify: `/Users/nicholasstewart/Claude/bluegrass-landers/index.html`

- [ ] **Step 1: Append CSS**

```css
    .bundle-reveal { background: var(--navy); color: #fff; text-align: center; padding: 110px 24px; }
    .bundle-reveal h2 { color: #fff; margin: 0 auto 16px; max-width: 760px; font-size: clamp(36px, 5vw, 56px); }
    .bundle-reveal .tagline { font-family: 'Fraunces', serif; font-style: italic; font-size: clamp(20px, 2.4vw, 28px); color: rgba(255,255,255,0.85); margin: 0 0 48px; }
    .bundle-hero { max-width: 920px; margin: 0 auto 48px; border-radius: 18px; overflow: hidden; box-shadow: 0 30px 60px -20px rgba(0,0,0,0.5); }
    .bundle-hero img { width: 100%; height: auto; display: block; }
    .bundle-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; max-width: 900px; margin: 0 auto 40px; }
    @media (max-width: 720px) { .bundle-summary { grid-template-columns: repeat(2, 1fr); } }
    .bundle-summary div { font-size: 14px; color: rgba(255,255,255,0.85); padding: 16px 12px; background: rgba(255,255,255,0.06); border-radius: 10px; }
    .bundle-summary b { display: block; color: #fff; font-size: 16px; margin-bottom: 4px; font-family: 'Fraunces', serif; }
    .bundle-anchor { font-size: 18px; color: rgba(255,255,255,0.9); margin-bottom: 24px; }
    .bundle-anchor s { color: rgba(255,255,255,0.55); }
    .bundle-anchor b { color: #fff; font-size: 24px; }
```

- [ ] **Step 2: Insert section**

```html
  <section class="bundle-reveal">
    <span class="eyebrow" style="background: rgba(255,255,255,0.12); color: #fff;">The Bundle</span>
    <h2>Meet the Ultimate Wellness Pack</h2>
    <p class="tagline">Morning to night. One spray each. Four results.</p>
    <div class="bundle-hero">
      <img src="https://placehold.co/1400x900/5BA3D9/FFFFFF?text=4+Bottles+Lifestyle" data-replace="bundle-hero-4-bottles-lifestyle" alt="Ultimate Wellness Pack — 4 sprays arranged on a surface">
    </div>
    <div class="bundle-summary">
      <div><b>B Boost B-12</b>Morning energy</div>
      <div><b>Immune Response</b>Daily defense</div>
      <div><b>Drift Away</b>Bedtime calm</div>
      <div><b>Hair & Nail</b>Visible glow-up</div>
    </div>
    <div class="bundle-anchor"><s>$156 if bought separately</s>&nbsp;&nbsp;<b>$84.15/month</b> as a pack</div>
    <a class="btn btn-gold big" href="https://www.bluegrassvitamins.com/cart/47823287189745:1?selling_plan=5323489521">Claim My Starter Pack</a>
  </section>
```

- [ ] **Step 3: Verify + commit**

```bash
python3 -m http.server 8000 & sleep 1 && open http://localhost:8000 && sleep 2 && kill %1
git add index.html
git commit -m "feat: bundle reveal section (navy full-bleed)"
git push
```

---

## Task 10: B Boost B-12 deep dive + spray-section template CSS (Section 6)

**Files:**
- Modify: `/Users/nicholasstewart/Claude/bluegrass-landers/index.html`

- [ ] **Step 1: Append CSS (the spray-section template is reused for sections 7, 8, 9)**

```css
    .spray { background: var(--cream); }
    .spray.alt { background: var(--sand); }
    .spray-grid {
      display: grid;
      grid-template-columns: 1fr 1.1fr;
      gap: 60px;
      align-items: center;
    }
    .spray.reverse .spray-grid { grid-template-columns: 1.1fr 1fr; }
    .spray.reverse .spray-visual { order: 2; }
    @media (max-width: 880px) {
      .spray-grid, .spray.reverse .spray-grid { grid-template-columns: 1fr; gap: 32px; }
      .spray.reverse .spray-visual { order: 0; }
    }
    .spray-visual {
      background: #fff;
      border-radius: 18px;
      overflow: hidden;
      aspect-ratio: 4 / 5;
      box-shadow: 0 20px 50px -16px rgba(27,77,140,0.18);
    }
    .spray-visual img { width: 100%; height: 100%; object-fit: cover; }
    .spray-content h3 {
      font-size: clamp(28px, 3.6vw, 42px);
      margin: 12px 0 18px;
      line-height: 1.15;
    }
    .spray-content .sub-eyebrow {
      font-size: 13px; text-transform: uppercase; letter-spacing: 0.16em; color: var(--navy); font-weight: 700; margin-bottom: 4px;
    }
    .spray-content .flavors { font-size: 13px; color: var(--muted); margin: 0 0 24px; font-style: italic; }
    .spray-benefits { list-style: none; padding: 0; margin: 0 0 28px; display: grid; gap: 12px; }
    .spray-benefits li {
      display: flex; align-items: flex-start; gap: 12px;
      font-size: 16px; line-height: 1.5;
    }
    .spray-benefits .check {
      flex-shrink: 0; width: 24px; height: 24px; border-radius: 50%;
      background: var(--green); color: #fff;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 13px; font-weight: 700; margin-top: 2px;
    }
    .mechanism-pill {
      display: inline-block;
      background: rgba(91,163,217,0.12);
      border: 1px solid rgba(91,163,217,0.3);
      color: var(--navy);
      padding: 10px 16px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      margin: 0 0 24px;
    }
    .spray-cta { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
    .spray-cta .micro { font-size: 13px; color: var(--muted); }
```

- [ ] **Step 2: Insert section after Bundle Reveal**

```html
  <section class="section spray">
    <div class="wrap">
      <div class="spray-grid">
        <div class="spray-visual">
          <img src="https://placehold.co/800x1000/D4A853/FFFFFF?text=B+Boost+B-12" data-replace="spray-b12-bottle" alt="B Boost B-12 sublingual spray bottle">
        </div>
        <div class="spray-content">
          <div class="sub-eyebrow">Spray 1 of 4 · Morning</div>
          <h3>Crash-Free Energy That Actually Lasts</h3>
          <p class="flavors">Available in orange, raspberry, vanilla, mint</p>
          <ul class="spray-benefits">
            <li><span class="check">✓</span>Supports natural energy production without a caffeine crash</li>
            <li><span class="check">✓</span>Supports a healthy metabolism, day in and day out</li>
            <li><span class="check">✓</span>Promotes mental clarity and focus — no afternoon fog</li>
            <li><span class="check">✓</span>Helps reduce occasional fatigue so you're not running on fumes by 3pm</li>
          </ul>
          <div class="mechanism-pill">8 sprays under the tongue · sublingual absorption · no pills to swallow</div>
          <div class="spray-cta">
            <a class="btn" href="https://www.bluegrassvitamins.com/cart/47823287189745:1?selling_plan=5323489521">Add the Pack</a>
            <span class="micro">Included in your monthly delivery</span>
          </div>
        </div>
      </div>
    </div>
  </section>
```

- [ ] **Step 3: Verify + commit**

```bash
python3 -m http.server 8000 & sleep 1 && open http://localhost:8000 && sleep 2 && kill %1
git add index.html
git commit -m "feat: B Boost B-12 deep dive + reusable spray-section template"
git push
```

---

## Task 11: Immune Response deep dive (Section 7) — alt background, reversed layout

**Files:**
- Modify: `/Users/nicholasstewart/Claude/bluegrass-landers/index.html`

- [ ] **Step 1: Insert section after the B-12 section (no new CSS needed — uses template from Task 10)**

```html
  <section class="section spray alt reverse">
    <div class="wrap">
      <div class="spray-grid">
        <div class="spray-content">
          <div class="sub-eyebrow">Spray 2 of 4 · Daytime</div>
          <h3>Your Year-Round Defense System</h3>
          <p class="flavors">Available in orange, raspberry, vanilla, mint</p>
          <ul class="spray-benefits">
            <li><span class="check">✓</span>Supports immune system function so you stay one step ahead</li>
            <li><span class="check">✓</span>Promotes year-round immune resilience, not just during cold season</li>
            <li><span class="check">✓</span>Provides antioxidant support against everyday oxidative stress</li>
            <li><span class="check">✓</span>Supports overall wellness as part of a daily routine</li>
          </ul>
          <div class="mechanism-pill">8 sprays under the tongue · bypasses digestion · daily defense in 10 seconds</div>
          <div class="spray-cta">
            <a class="btn" href="https://www.bluegrassvitamins.com/cart/47823287189745:1?selling_plan=5323489521">Add the Pack</a>
            <span class="micro">Included in your monthly delivery</span>
          </div>
        </div>
        <div class="spray-visual">
          <img src="https://placehold.co/800x1000/2D8659/FFFFFF?text=Immune+Response" data-replace="spray-immune-bottle" alt="Immune Response sublingual spray bottle">
        </div>
      </div>
    </div>
  </section>
```

- [ ] **Step 2: Verify + commit**

```bash
python3 -m http.server 8000 & sleep 1 && open http://localhost:8000 && sleep 2 && kill %1
git add index.html
git commit -m "feat: Immune Response deep dive (reversed layout, sand bg)"
git push
```

---

## Task 12: Drift Away Sleep Spray deep dive (Section 8)

**Files:**
- Modify: `/Users/nicholasstewart/Claude/bluegrass-landers/index.html`

- [ ] **Step 1: Insert section**

```html
  <section class="section spray">
    <div class="wrap">
      <div class="spray-grid">
        <div class="spray-visual">
          <img src="https://placehold.co/800x1000/1B4D8C/FFFFFF?text=Drift+Away" data-replace="spray-drift-bottle" alt="Drift Away Sleep Spray bottle">
        </div>
        <div class="spray-content">
          <div class="sub-eyebrow">Spray 3 of 4 · Nighttime</div>
          <h3>Fall Asleep Without the Hangover</h3>
          <p class="flavors">With GABA, melatonin, and valerian root</p>
          <ul class="spray-benefits">
            <li><span class="check">✓</span>Supports relaxation and calmness as your day winds down</li>
            <li><span class="check">✓</span>Promotes restful, restorative sleep — not knocked-out groggy sleep</li>
            <li><span class="check">✓</span>Helps ease occasional sleeplessness when your mind won't quit</li>
            <li><span class="check">✓</span>Supports a healthy sleep cycle so 7 hours actually feels like 7 hours</li>
          </ul>
          <div class="mechanism-pill">8 sprays before bed · sublingual absorption · faster onset than capsules</div>
          <div class="spray-cta">
            <a class="btn" href="https://www.bluegrassvitamins.com/cart/47823287189745:1?selling_plan=5323489521">Add the Pack</a>
            <span class="micro">Included in your monthly delivery</span>
          </div>
        </div>
      </div>
    </div>
  </section>
```

- [ ] **Step 2: Verify + commit**

```bash
python3 -m http.server 8000 & sleep 1 && open http://localhost:8000 && sleep 2 && kill %1
git add index.html
git commit -m "feat: Drift Away deep dive (with Jason testimonial ingredients)"
git push
```

---

## Task 13: Hair & Nail Support Spray deep dive (Section 9)

**Files:**
- Modify: `/Users/nicholasstewart/Claude/bluegrass-landers/index.html`

- [ ] **Step 1: Insert section**

```html
  <section class="section spray alt reverse">
    <div class="wrap">
      <div class="spray-grid">
        <div class="spray-content">
          <div class="sub-eyebrow">Spray 4 of 4 · Daily</div>
          <h3>The Glow-Up You'll See in the Mirror</h3>
          <p class="flavors">Available in peppermint or french vanilla</p>
          <ul class="spray-benefits">
            <li><span class="check">✓</span>Delivers biotin to support keratin production at the source</li>
            <li><span class="check">✓</span>Supports healthy hair growth and strand strength</li>
            <li><span class="check">✓</span>Supports nail integrity and resilience — fewer chips, faster growth</li>
            <li><span class="check">✓</span>Supports cellular energy metabolism involved in hair and nail health</li>
          </ul>
          <div class="mechanism-pill">8 sprays daily · sublingual absorption · works alongside the other 3 sprays</div>
          <div class="spray-cta">
            <a class="btn" href="https://www.bluegrassvitamins.com/cart/47823287189745:1?selling_plan=5323489521">Add the Pack</a>
            <span class="micro">Included in your monthly delivery</span>
          </div>
        </div>
        <div class="spray-visual">
          <img src="https://placehold.co/800x1000/D4A853/FFFFFF?text=Hair+%26+Nail" data-replace="spray-hairnail-bottle" alt="Hair & Nail Support Spray bottle">
        </div>
      </div>
    </div>
  </section>
```

- [ ] **Step 2: Verify + commit**

```bash
python3 -m http.server 8000 & sleep 1 && open http://localhost:8000 && sleep 2 && kill %1
git add index.html
git commit -m "feat: Hair & Nail deep dive (reversed layout, sand bg)"
git push
```

---

## Task 14: Why Sprays Beat Pills science section (Section 10)

**Files:**
- Modify: `/Users/nicholasstewart/Claude/bluegrass-landers/index.html`

- [ ] **Step 1: Append CSS**

```css
    .science { background: var(--cream); }
    .science h2 { max-width: 900px; }
    .science-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 56px; align-items: center; }
    @media (max-width: 880px) { .science-grid { grid-template-columns: 1fr; gap: 32px; } }
    .science-diagram {
      background: #fff;
      border-radius: 18px;
      overflow: hidden;
      aspect-ratio: 4 / 3;
      box-shadow: 0 20px 50px -16px rgba(27,77,140,0.18);
    }
    .science-diagram img { width: 100%; height: 100%; object-fit: cover; }
    .science-claims { list-style: none; padding: 0; margin: 0 0 24px; display: grid; gap: 16px; }
    .science-claims li { font-size: 16.5px; line-height: 1.55; padding-left: 32px; position: relative; }
    .science-claims li::before {
      content: '→'; position: absolute; left: 0; color: var(--navy); font-weight: 700; font-size: 20px;
    }
    .science-footnote { font-size: 12px; color: var(--muted); margin-top: 28px; font-style: italic; }
```

- [ ] **Step 2: Insert section**

```html
  <section class="section science">
    <div class="wrap">
      <span class="eyebrow">The Science of Absorption</span>
      <h2>Why Sublingual Sprays Outperform Every Pill in Your Cabinet</h2>
      <p class="sub">A pill that doesn't absorb is a pill you didn't take. Here's why the delivery method matters more than the label.</p>
      <div class="science-grid">
        <div class="science-diagram">
          <img src="https://placehold.co/1000x750/5BA3D9/FFFFFF?text=Absorption+Diagram" data-replace="science-absorption-diagram" alt="Diagram comparing sublingual absorption vs oral capsule pathway">
        </div>
        <div>
          <ul class="science-claims">
            <li><b>Studies suggest sublingual absorption can be significantly faster than oral capsules</b> — nutrients enter the bloodstream through the mouth lining, not the stomach.</li>
            <li><b>Research indicates a large portion of what's in a capsule may be lost to first-pass metabolism</b> — your liver filters it before it can do anything.</li>
            <li><b>Sprays bypass the digestive system entirely</b> — no stomach acid, no breakdown, no waiting 45 minutes to feel anything.</li>
            <li><b>Daily compliance jumps when there's nothing to swallow</b> — and the supplement that works is the one you actually take.</li>
          </ul>
          <p class="science-footnote">Statements have not been evaluated by the FDA. These products are not intended to diagnose, treat, cure, or prevent any disease.</p>
        </div>
      </div>
    </div>
  </section>
```

- [ ] **Step 3: Verify + commit**

```bash
python3 -m http.server 8000 & sleep 1 && open http://localhost:8000 && sleep 2 && kill %1
git add index.html
git commit -m "feat: science section — why sprays beat pills (hedged claims)"
git push
```

---

## Task 15: What to Expect timeline (Section 11)

**Files:**
- Modify: `/Users/nicholasstewart/Claude/bluegrass-landers/index.html`

- [ ] **Step 1: Append CSS**

```css
    .timeline { background: var(--sand); }
    .timeline-rail { position: relative; max-width: 760px; margin: 0 auto; padding: 16px 0; }
    .timeline-rail::before {
      content: ''; position: absolute; left: 28px; top: 24px; bottom: 24px; width: 3px; background: linear-gradient(180deg, var(--blue), var(--navy));
      border-radius: 3px;
    }
    .timeline-item { position: relative; padding: 14px 0 14px 76px; }
    .timeline-item .dot {
      position: absolute; left: 12px; top: 18px; width: 36px; height: 36px;
      background: var(--navy); color: #fff; border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 12px; font-weight: 700; letter-spacing: 0.05em;
      box-shadow: 0 0 0 6px var(--sand);
    }
    .timeline-item h4 { font-size: 20px; margin: 0 0 6px; font-family: 'Fraunces', serif; }
    .timeline-item p { font-size: 15px; color: var(--muted); margin: 0; line-height: 1.55; }
    .timeline-disclaimer { text-align: center; font-size: 12px; color: var(--muted); margin-top: 32px; font-style: italic; }
```

- [ ] **Step 2: Insert section**

```html
  <section class="section timeline">
    <div class="wrap">
      <span class="eyebrow">What to expect</span>
      <h2>Your first 6 months on the Pack</h2>
      <p class="sub">Real change is compounding. Here's the cadence most subscribers describe.</p>
      <div class="timeline-rail">
        <div class="timeline-item"><span class="dot">D1</span><h4>Day 1 — B-12 hits within minutes</h4><p>First spray under the tongue, first energy lift. No coffee crash later.*</p></div>
        <div class="timeline-item"><span class="dot">W1</span><h4>Week 1 — Sleep stabilizes</h4><p>Drift Away starts to anchor a consistent wind-down. Immune Response primed daily.*</p></div>
        <div class="timeline-item"><span class="dot">M1</span><h4>Month 1 — Energy stays even</h4><p>The afternoon dip flattens out. You stop reaching for a second cup.*</p></div>
        <div class="timeline-item"><span class="dot">M3</span><h4>Month 3 — Hair and nails visibly change</h4><p>Stronger nails, fewer breakages. Hair feels thicker in your hands.*</p></div>
        <div class="timeline-item"><span class="dot">M6</span><h4>Month 6 — Compounding benefits</h4><p>Clearer skin, deeper rest, fewer sick days. The full effect of consistent absorption.*</p></div>
      </div>
      <p class="timeline-disclaimer">*Individual results vary. Statements have not been evaluated by the FDA.</p>
    </div>
  </section>
```

- [ ] **Step 3: Verify + commit**

```bash
python3 -m http.server 8000 & sleep 1 && open http://localhost:8000 && sleep 2 && kill %1
git add index.html
git commit -m "feat: 6-month expectations timeline"
git push
```

---

## Task 16: Comparison table (Section 12)

**Files:**
- Modify: `/Users/nicholasstewart/Claude/bluegrass-landers/index.html`

- [ ] **Step 1: Append CSS**

```css
    .compare { background: var(--cream); }
    .compare-grid {
      display: grid;
      grid-template-columns: 1.2fr 1fr 1fr;
      background: #fff;
      border-radius: 14px;
      overflow: hidden;
      box-shadow: 0 10px 30px -10px rgba(27,77,140,0.15);
      max-width: 920px;
      margin: 0 auto;
    }
    .compare-grid > div { padding: 18px 22px; border-bottom: 1px solid var(--line); font-size: 15px; }
    .compare-grid > .head { background: var(--navy); color: #fff; font-weight: 700; text-align: center; border-bottom: none; padding: 22px 18px; font-family: 'Fraunces', serif; font-size: 17px; }
    .compare-grid > .head.you { background: var(--gold); color: var(--ink); }
    .compare-grid > .label { font-weight: 600; background: var(--sand); }
    .compare-grid > .yes { color: var(--green); font-weight: 600; }
    .compare-grid > .no { color: var(--red); }
    .compare-grid > div:nth-last-child(-n+3) { border-bottom: none; }
    @media (max-width: 720px) {
      .compare-grid { grid-template-columns: 1fr; }
      .compare-grid > .label { background: var(--navy); color: #fff; font-family: 'Fraunces', serif; font-size: 16px; padding: 14px 22px; }
      .compare-grid > .head:not(.you) { display: none; }
    }
    .compare .cta-row { text-align: center; margin-top: 40px; }
```

- [ ] **Step 2: Insert section**

```html
  <section class="section compare">
    <div class="wrap">
      <span class="eyebrow">Side by side</span>
      <h2>Ultimate Wellness Pack vs. stacking 4 brands of pills</h2>
      <p class="sub">Same goals. Wildly different math.</p>
      <div class="compare-grid">
        <div class="head">&nbsp;</div>
        <div class="head you">Ultimate Wellness Pack</div>
        <div class="head">Stack 4 brands of pills</div>

        <div class="label">Monthly cost</div>
        <div class="yes">$84.15 (subscribed)</div>
        <div class="no">$156+ across 4 bottles</div>

        <div class="label">Absorption</div>
        <div class="yes">Sublingual — studies suggest faster onset</div>
        <div class="no">Capsule — much may be lost to digestion</div>

        <div class="label">Daily hassle</div>
        <div class="yes">4 sprays, 30 seconds</div>
        <div class="no">4 reorders, 4 dosing schedules</div>

        <div class="label">Sourcing</div>
        <div class="yes">Physician-formulated, third-party tested</div>
        <div class="no">Varies by brand</div>

        <div class="label">Subscription flexibility</div>
        <div class="yes">Cancel, skip, or pause in 2 clicks</div>
        <div class="no">4 separate subscriptions to manage</div>
      </div>
      <div class="cta-row">
        <a class="btn big" href="https://www.bluegrassvitamins.com/cart/47823287189745:1?selling_plan=5323489521">Claim My Starter Pack</a>
      </div>
    </div>
  </section>
```

- [ ] **Step 3: Verify + commit**

```bash
python3 -m http.server 8000 & sleep 1 && open http://localhost:8000 && sleep 2 && kill %1
git add index.html
git commit -m "feat: comparison table (pack vs 4 brands)"
git push
```

---

## Task 17: The Bluegrass Promise badges (Section 13)

**Files:**
- Modify: `/Users/nicholasstewart/Claude/bluegrass-landers/index.html`

- [ ] **Step 1: Append CSS**

```css
    .promise { background: var(--sand); text-align: center; }
    .promise .wrap > h2, .promise .wrap > .sub { text-align: center; margin-left: auto; margin-right: auto; }
    .promise-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 18px; margin-top: 16px; }
    @media (max-width: 980px) { .promise-grid { grid-template-columns: repeat(3, 1fr); } }
    @media (max-width: 560px) { .promise-grid { grid-template-columns: repeat(2, 1fr); } }
    .promise-badge {
      background: #fff; border-radius: 14px; padding: 24px 14px;
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.04);
    }
    .promise-badge .ic { width: 44px; height: 44px; background: var(--navy); color: #fff; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 700; }
    .promise-badge b { font-size: 13px; line-height: 1.3; text-align: center; }
```

- [ ] **Step 2: Insert section**

```html
  <section class="section promise">
    <div class="wrap">
      <span class="eyebrow">The Bluegrass Promise</span>
      <h2>What's in every bottle, every batch, every delivery</h2>
      <div class="promise-grid">
        <div class="promise-badge"><span class="ic">✓</span><b>Physician-Formulated</b></div>
        <div class="promise-badge"><span class="ic">✓</span><b>Third-Party Tested</b></div>
        <div class="promise-badge"><span class="ic">✓</span><b>Lab-Tested</b></div>
        <div class="promise-badge"><span class="ic">✓</span><b>Made in USA</b></div>
        <div class="promise-badge"><span class="ic">✓</span><b>No Artificial Fillers</b></div>
        <div class="promise-badge"><span class="ic">✓</span><b>Free Shipping Always</b></div>
      </div>
    </div>
  </section>
```

- [ ] **Step 3: Verify + commit**

```bash
python3 -m http.server 8000 & sleep 1 && open http://localhost:8000 && sleep 2 && kill %1
git add index.html
git commit -m "feat: Bluegrass promise (6 quality badges)"
git push
```

---

## Task 18: Who it's for / NOT for (Section 14)

**Files:**
- Modify: `/Users/nicholasstewart/Claude/bluegrass-landers/index.html`

- [ ] **Step 1: Append CSS**

```css
    .who-for { background: var(--cream); }
    .who-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }
    @media (max-width: 760px) { .who-grid { grid-template-columns: 1fr; } }
    .who-col {
      background: #fff; padding: 36px 32px; border-radius: 14px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.04);
    }
    .who-col.yes { border-top: 6px solid var(--green); }
    .who-col.no { border-top: 6px solid var(--red); }
    .who-col h3 { font-size: 24px; margin: 0 0 18px; font-family: 'Fraunces', serif; }
    .who-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 12px; }
    .who-list li { font-size: 16px; line-height: 1.5; display: flex; gap: 12px; align-items: flex-start; }
    .who-list li::before { content: ''; flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%; margin-top: 1px; }
    .who-col.yes .who-list li::before { background: var(--green); content: '✓'; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; }
    .who-col.no .who-list li::before { background: var(--red); content: '✕'; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; }
```

- [ ] **Step 2: Insert section**

```html
  <section class="section who-for">
    <div class="wrap">
      <span class="eyebrow">Honest gut-check</span>
      <h2>This pack is for some people. Not everyone.</h2>
      <div class="who-grid">
        <div class="who-col yes">
          <h3>For you if…</h3>
          <ul class="who-list">
            <li>You're tired of forgetting your pills by mid-morning</li>
            <li>You want clean morning energy without coffee crashes</li>
            <li>You need help winding down — not knocking yourself out</li>
            <li>You want visible improvement in hair and nails (not "we'll see")</li>
            <li>You actually care about absorption, not just what's on a label</li>
          </ul>
        </div>
        <div class="who-col no">
          <h3>NOT for you if…</h3>
          <ul class="who-list">
            <li>You love swallowing horse-pill capsules</li>
            <li>You think sugar-loaded gummies are "good enough"</li>
            <li>You're not willing to take 4 quick sprays daily</li>
            <li>You expect overnight transformation in 7 days</li>
          </ul>
        </div>
      </div>
    </div>
  </section>
```

- [ ] **Step 3: Verify + commit**

```bash
python3 -m http.server 8000 & sleep 1 && open http://localhost:8000 && sleep 2 && kill %1
git add index.html
git commit -m "feat: who it's for / NOT for (exclusion device)"
git push
```

---

## Task 19: Scarcity callout (Section 15)

**Files:**
- Modify: `/Users/nicholasstewart/Claude/bluegrass-landers/index.html`

- [ ] **Step 1: Append CSS**

```css
    .scarcity { background: var(--navy); color: #fff; text-align: center; padding: 72px 24px; }
    .scarcity h2 { color: #fff; margin: 0 auto 14px; max-width: 760px; font-size: clamp(28px, 4vw, 42px); }
    .scarcity p { font-size: 18px; color: rgba(255,255,255,0.85); max-width: 620px; margin: 0 auto 28px; }
    .scarcity .warn { display: inline-block; background: rgba(212,168,83,0.18); border: 1px solid rgba(212,168,83,0.4); color: #ffd17a; padding: 8px 18px; border-radius: 999px; font-size: 13px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 22px; }
```

- [ ] **Step 2: Insert section**

```html
  <section class="scarcity">
    <span class="warn">⚠ Limited monthly allocation</span>
    <h2>This month's subscription slots are almost gone</h2>
    <p>We open a fixed allocation of Ultimate Wellness Pack subscriptions each month so every order ships fresh from the same batch. When May fills up, the queue rolls to June.</p>
    <a class="btn btn-gold big" href="https://www.bluegrassvitamins.com/cart/47823287189745:1?selling_plan=5323489521">Lock In May's Allocation</a>
  </section>
```

- [ ] **Step 3: Verify + commit**

```bash
python3 -m http.server 8000 & sleep 1 && open http://localhost:8000 && sleep 2 && kill %1
git add index.html
git commit -m "feat: scarcity callout (soft monthly allocation framing)"
git push
```

---

## Task 20: Pricing block with subscription toggle (Section 16)

**Files:**
- Modify: `/Users/nicholasstewart/Claude/bluegrass-landers/index.html`

- [ ] **Step 1: Append CSS**

```css
    .pricing { background: var(--cream); }
    .pricing .wrap > h2, .pricing .wrap > .sub { text-align: center; margin-left: auto; margin-right: auto; }
    .pricing-card { max-width: 560px; margin: 0 auto; background: #fff; border-radius: 18px; box-shadow: 0 30px 60px -20px rgba(27,77,140,0.2); overflow: hidden; }
    .pricing-tabs { display: grid; grid-template-columns: 1fr 1fr; }
    .pricing-tabs button {
      background: var(--sand); border: none; padding: 18px 16px; font-family: inherit; font-size: 14px; font-weight: 700;
      letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); cursor: pointer;
      transition: background .15s ease, color .15s ease;
    }
    .pricing-tabs button.active { background: #fff; color: var(--navy); border-bottom: 3px solid var(--navy); }
    .pricing-tabs button:hover:not(.active) { color: var(--navy); }
    .pricing-pane { padding: 36px 32px; display: none; }
    .pricing-pane.active { display: block; }
    .price-row { display: flex; align-items: baseline; gap: 14px; margin-bottom: 6px; flex-wrap: wrap; }
    .price-row .big-price { font-family: 'Fraunces', serif; font-size: 46px; font-weight: 700; color: var(--navy); line-height: 1; }
    .price-row .per { font-size: 16px; color: var(--muted); }
    .price-row .badge { background: var(--gold); color: var(--ink); padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; }
    .price-anchor { color: var(--muted); font-size: 15px; margin-bottom: 18px; }
    .price-anchor s { color: #b6b1a8; }
    .price-features { list-style: none; padding: 0; margin: 0 0 24px; display: grid; gap: 10px; }
    .price-features li { font-size: 14.5px; padding-left: 26px; position: relative; line-height: 1.5; }
    .price-features li::before { content: '✓'; position: absolute; left: 0; top: 0; color: var(--green); font-weight: 700; }
    .price-cta { display: block; text-align: center; }
    .price-micro { font-size: 12px; color: var(--muted); text-align: center; margin-top: 14px; line-height: 1.5; }
```

- [ ] **Step 2: Insert section**

```html
  <section class="section pricing" id="offer">
    <div class="wrap">
      <span class="eyebrow" style="display: block; text-align: center;">The Offer</span>
      <h2 style="text-align: center;">Pick your plan</h2>
      <p class="sub" style="text-align: center;">Subscribe and save 15% — or grab the pack one-time.</p>
      <div class="pricing-card">
        <div class="pricing-tabs">
          <button class="active" data-tab="sub">Subscribe & Save</button>
          <button data-tab="once">One-Time</button>
        </div>
        <div class="pricing-pane active" data-pane="sub">
          <div class="price-row">
            <span class="big-price">$84.15</span>
            <span class="per">/ month</span>
            <span class="badge">Save 15%</span>
          </div>
          <div class="price-anchor"><s>$156 if bought separately</s> · saves $71.85</div>
          <ul class="price-features">
            <li>All 4 sublingual wellness sprays, every month</li>
            <li>Cancel anytime — 2 clicks in your account</li>
            <li>Skip a month or pause anytime</li>
            <li>Free shipping always</li>
          </ul>
          <a class="btn big price-cta" href="https://www.bluegrassvitamins.com/cart/47823287189745:1?selling_plan=5323489521">Start My Monthly Delivery</a>
          <p class="price-micro">Ships within 24h · Cancel subscription anytime in 2 clicks</p>
        </div>
        <div class="pricing-pane" data-pane="once">
          <div class="price-row">
            <span class="big-price">$99</span>
            <span class="per">one-time</span>
            <span class="badge">Save $57</span>
          </div>
          <div class="price-anchor"><s>$156 if bought separately</s></div>
          <ul class="price-features">
            <li>All 4 sublingual wellness sprays, one-time</li>
            <li>No subscription, no recurring charge</li>
            <li>Free shipping</li>
          </ul>
          <a class="btn btn-secondary big price-cta" href="https://www.bluegrassvitamins.com/cart/47823287189745:1">Buy The Bundle</a>
          <p class="price-micro">Ships within 24h · One-time purchase</p>
        </div>
      </div>
    </div>
  </section>
```

- [ ] **Step 3: Append toggle JS to the existing `<script>` block at end of body**

```html
  <script>
    // Pricing tab toggle
    (function () {
      const tabs = document.querySelectorAll('.pricing-tabs button[data-tab]');
      const panes = document.querySelectorAll('.pricing-pane[data-pane]');
      tabs.forEach(t => t.addEventListener('click', () => {
        const key = t.dataset.tab;
        tabs.forEach(b => b.classList.toggle('active', b.dataset.tab === key));
        panes.forEach(p => p.classList.toggle('active', p.dataset.pane === key));
      }));
    })();
  </script>
```

- [ ] **Step 4: Verify**

```bash
python3 -m http.server 8000 & sleep 1 && open http://localhost:8000 && sleep 2 && kill %1
```

Expected: Pricing card centered, two tabs at top, Subscribe pane shown by default at $84.15/mo with green Start button. Clicking "One-Time" switches to $99 pane with white outlined button.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: pricing block with subscription/one-time toggle"
git push
```

---

## Task 21: FAQ with accordion (Section 17)

**Files:**
- Modify: `/Users/nicholasstewart/Claude/bluegrass-landers/index.html`

- [ ] **Step 1: Append CSS**

```css
    .faq { background: var(--sand); }
    .faq-list { max-width: 820px; margin: 0 auto; }
    .faq-item { background: #fff; border-radius: 12px; margin-bottom: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
    .faq-item summary {
      cursor: pointer; padding: 22px 24px; font-size: 17px; font-weight: 600;
      list-style: none; display: flex; justify-content: space-between; align-items: center;
      font-family: 'Fraunces', serif;
    }
    .faq-item summary::-webkit-details-marker { display: none; }
    .faq-item summary::after { content: '+'; font-size: 28px; color: var(--navy); line-height: 1; transition: transform .2s ease; font-weight: 400; }
    .faq-item[open] summary::after { transform: rotate(45deg); }
    .faq-item .answer { padding: 0 24px 24px; font-size: 15.5px; line-height: 1.6; color: #2c3140; }
    .faq-item .answer p { margin: 0 0 10px; }
    .faq-item .answer p:last-child { margin: 0; }
```

- [ ] **Step 2: Insert section**

```html
  <section class="section faq">
    <div class="wrap">
      <span class="eyebrow">Common questions</span>
      <h2>Everything you might be wondering</h2>
      <div class="faq-list">
        <details class="faq-item" open><summary>How do I cancel my subscription?</summary><div class="answer"><p>Log into your account on bluegrassvitamins.com and hit cancel. No emails, no hold music, no questions. Two clicks and you're out.</p></div></details>
        <details class="faq-item"><summary>How does the subscription work?</summary><div class="answer"><p>You get all 4 sprays delivered every month at the discounted $84.15 price. Same delivery date each month. We charge your card, ship the pack, and you take it from there.</p></div></details>
        <details class="faq-item"><summary>Can I skip a month or pause?</summary><div class="answer"><p>Yes — both from your account. Skip a month if you're stocked up, pause indefinitely if you're traveling or just want a break. Restart any time.</p></div></details>
        <details class="faq-item"><summary>Why sprays instead of pills?</summary><div class="answer"><p>Two reasons: absorption and adherence. Sublingual sprays enter through your mouth lining and bypass the digestive system, so research suggests more of what you take actually gets used. And nothing kills a supplement routine faster than swallowing 12 capsules a day — sprays take 30 seconds.</p></div></details>
        <details class="faq-item"><summary>When will I feel a difference?</summary><div class="answer"><p>B-12 typically hits within minutes the first day. Sleep usually stabilizes within the first week. Hair and nail changes show up around month 1–3 (that's just how fast hair and nails grow). The compounding stuff — energy consistency, clearer skin, fewer sick days — usually shows by month 3–6.*</p></div></details>
        <details class="faq-item"><summary>Can I take all 4 sprays at once?</summary><div class="answer"><p>Yes — the pack is designed for daily layered use. Typical routine: B-12 + Immune + Hair & Nail in the morning, Drift Away before bed.</p></div></details>
        <details class="faq-item"><summary>Are they safe with my medications?</summary><div class="answer"><p>We can't give medical advice. Talk to your doctor before starting any new supplement, especially if you're on prescription medication, pregnant, or nursing.</p></div></details>
        <details class="faq-item"><summary>Where are they made?</summary><div class="answer"><p>All Bluegrass sprays are formulated and manufactured in the USA in a facility that meets cGMP standards. Every batch is third-party tested.</p></div></details>
        <details class="faq-item"><summary>What flavors do they come in?</summary><div class="answer"><p>B-12, Immune Response, and Drift Away come in orange, raspberry, vanilla, or mint. Hair & Nail comes in peppermint or french vanilla. All flavoring is natural.</p></div></details>
        <details class="faq-item"><summary>What if I'm allergic to an ingredient?</summary><div class="answer"><p>Full ingredient lists are on each spray's individual product page on bluegrassvitamins.com. Check there before ordering if you have known sensitivities.</p></div></details>
      </div>
      <p style="text-align: center; font-size: 12px; color: var(--muted); margin-top: 24px;">*Individual results vary. Statements have not been evaluated by the FDA.</p>
    </div>
  </section>
```

- [ ] **Step 3: Verify** (no JS needed — `<details>` is native)

```bash
python3 -m http.server 8000 & sleep 1 && open http://localhost:8000 && sleep 2 && kill %1
```

Expected: First FAQ open by default, others collapsed. Clicking any item opens/closes it. Plus rotates to ✕ when open.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: FAQ accordion (10 items, no MBG/HSA references)"
git push
```

---

## Task 22: Final CTA + Low-Commitment Promise + footer (Section 18)

**Files:**
- Modify: `/Users/nicholasstewart/Claude/bluegrass-landers/index.html`

- [ ] **Step 1: Append CSS**

```css
    .final-cta { background: linear-gradient(180deg, #EEF4FA 0%, var(--cream) 100%); text-align: center; padding: 100px 24px; }
    .final-cta h2 { max-width: 760px; margin: 0 auto 16px; font-size: clamp(34px, 4.6vw, 52px); }
    .final-cta .sub { max-width: 620px; margin: 0 auto 32px; font-size: 18px; color: var(--muted); }
    .promise-box {
      max-width: 720px; margin: 40px auto 0; background: #fff; border-radius: 14px;
      padding: 28px 32px; box-shadow: 0 8px 24px rgba(27,77,140,0.12);
      text-align: left;
    }
    .promise-box h4 { font-family: 'Fraunces', serif; font-size: 19px; margin: 0 0 14px; text-align: center; }
    .promise-list { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 12px 18px; }
    @media (max-width: 560px) { .promise-list { grid-template-columns: 1fr; } }
    .promise-list li { font-size: 14.5px; padding-left: 26px; position: relative; line-height: 1.5; }
    .promise-list li::before { content: '✓'; position: absolute; left: 0; top: 0; color: var(--green); font-weight: 700; }
    footer { background: var(--ink); color: rgba(255,255,255,0.7); padding: 40px 24px 32px; font-size: 13px; }
    footer .wrap { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px; }
    footer a { color: rgba(255,255,255,0.85); text-decoration: none; margin: 0 10px; }
    footer a:hover { color: #fff; text-decoration: underline; }
    footer .legal { font-size: 11px; max-width: 700px; margin: 18px auto 0; color: rgba(255,255,255,0.45); text-align: center; line-height: 1.5; }
```

- [ ] **Step 2: Insert section**

```html
  <section class="final-cta">
    <span class="eyebrow">Ready when you are</span>
    <h2>Stop stacking bottles. Start a routine that absorbs.</h2>
    <p class="sub">The Ultimate Wellness Pack covers morning energy, daily defense, restful sleep, and visible hair & nail support — for less than $21 per spray.</p>
    <a class="btn btn-gold big" href="https://www.bluegrassvitamins.com/cart/47823287189745:1?selling_plan=5323489521">Claim My Starter Pack</a>
    <div class="promise-box">
      <h4>Our low-commitment promise</h4>
      <ul class="promise-list">
        <li>Cancel subscription anytime, no questions</li>
        <li>Skip or pause from your account in 2 clicks</li>
        <li>Free shipping, every order</li>
        <li>Third-party tested · Physician-formulated · Made in USA</li>
      </ul>
    </div>
  </section>

  <footer>
    <div class="wrap">
      <div>© 2026 Bluegrass Supplements</div>
      <div>
        <a href="https://www.bluegrassvitamins.com/policies/refund-policy">Refund Policy</a>
        <a href="https://www.bluegrassvitamins.com/policies/terms-of-service">Terms</a>
        <a href="https://www.bluegrassvitamins.com/policies/privacy-policy">Privacy</a>
        <a href="mailto:online@theBPWshop.com">Contact</a>
      </div>
    </div>
    <p class="legal">*These statements have not been evaluated by the Food and Drug Administration. These products are not intended to diagnose, treat, cure, or prevent any disease. Individual results vary.</p>
  </footer>
```

- [ ] **Step 3: Verify + commit**

```bash
python3 -m http.server 8000 & sleep 1 && open http://localhost:8000 && sleep 2 && kill %1
git add index.html
git commit -m "feat: final CTA + low-commitment promise + footer (no MBG)"
git push
```

---

## Task 23: Mobile responsive QA pass

**Files:** None modified initially — diagnostic step

- [ ] **Step 1: Open page in Chrome and test 3 viewports**

```bash
cd /Users/nicholasstewart/Claude/bluegrass-landers
python3 -m http.server 8000 &
open -a "Google Chrome" http://localhost:8000
```

Open Chrome DevTools (`Cmd+Opt+I`), toggle device toolbar (`Cmd+Shift+M`), and test at:
- iPhone SE (375 × 667)
- iPhone 14 Pro Max (430 × 932)
- iPad (768 × 1024)

- [ ] **Step 2: Check each section against this checklist**

For each viewport, scroll the full page and verify:
- [ ] Announcement bar text readable, doesn't overflow
- [ ] Hero headline scales down, image stays above the fold
- [ ] Trust strip wraps to multiple lines without cropping
- [ ] Testimonials stack 1-col on small, 2-col on medium
- [ ] Problem grid stacks 1-col on small
- [ ] Bundle reveal image scales, summary grid stacks 2-col on small
- [ ] Each spray section: image and content stack vertically on mobile
- [ ] Comparison table renders 1-col layout on small (label headers visible)
- [ ] Promise badges wrap to 2-col on small
- [ ] Who-for cols stack
- [ ] Pricing card stays centered, tabs readable
- [ ] FAQ items full-width
- [ ] Final CTA promise list stacks
- [ ] Footer wraps gracefully

- [ ] **Step 3: Fix any layout issues found**

Common fixes (apply only if needed):
- `font-size: clamp(...)` for any headings that don't scale
- Additional `@media (max-width: 560px)` rules for any grid that doesn't collapse
- `flex-wrap: wrap` on any flex row that overflows

Kill server: `kill %1`

- [ ] **Step 4: Commit any fixes (if any were made)**

```bash
git add index.html
git commit -m "fix: mobile responsive polish across viewports"
git push
```

If no fixes needed, skip the commit.

---

## Task 24: CTA deeplink verification

**Files:** None modified — verification step

- [ ] **Step 1: Extract all anchor hrefs from index.html**

```bash
cd /Users/nicholasstewart/Claude/bluegrass-landers
grep -oE 'href="https://www\.bluegrassvitamins\.com[^"]*"' index.html | sort -u
```

Expected output (exactly these two URLs):
```
href="https://www.bluegrassvitamins.com/cart/47823287189745:1"
href="https://www.bluegrassvitamins.com/cart/47823287189745:1?selling_plan=5323489521"
```

If any other URL appears, find the typo with `grep -n` and fix it.

- [ ] **Step 2: Click-through test — subscription URL**

```bash
open "https://www.bluegrassvitamins.com/cart/47823287189745:1?selling_plan=5323489521"
```

Verify on the Shopify cart page:
- Ultimate Wellness Pack is in cart, quantity 1
- "Subscribe & save" is selected (not one-time)
- Price shows $84.15 (or close after tax/shipping calc)

- [ ] **Step 3: Click-through test — one-time URL**

```bash
open "https://www.bluegrassvitamins.com/cart/47823287189745:1"
```

Verify:
- Ultimate Wellness Pack in cart, quantity 1
- "One-time" is selected (or whatever default Shopify lands on without `selling_plan` param)
- Price shows $99

If subscription is forced even on the one-time URL, the SKU may be subscription-only — note this in the README handoff as a known constraint and recommend the client confirm one-time is available before launch.

- [ ] **Step 4: Document findings in commit (no code change unless URLs were wrong)**

If a URL was wrong:

```bash
git add index.html
git commit -m "fix: correct CTA deeplink to variant 47823287189745"
git push
```

Otherwise, no commit. Move to Task 25.

---

## Task 25: Shopify full-bleed CSS, README handoff, final deploy

**Files:**
- Modify: `/Users/nicholasstewart/Claude/bluegrass-landers/index.html` (append Shopify scope CSS)
- Create: `/Users/nicholasstewart/Claude/bluegrass-landers/README.md`

- [ ] **Step 1: Append Shopify full-bleed CSS to `<style>` block**

```css
    /*
      SHOPIFY FULL-BLEED HIDES
      ========================
      When this page is pasted into a Shopify Page, the theme's header and footer
      will wrap our content. These rules hide them so the lander is full-bleed.
      TODO: replace the generic selectors below with the actual selectors used
      by Bluegrass's active theme. Common ones:
        - Dawn: .header-wrapper, .footer
        - Impulse: .site-header, .site-footer
        - Custom: inspect the page and grab the wrapping element class
      The body class `template-page-<slug>` lets us scope these hides to ONLY this
      lander, so other pages on the site keep their header/footer.
    */
    body.template-page-ultimate-wellness-pack .header-wrapper,
    body.template-page-ultimate-wellness-pack .site-header,
    body.template-page-ultimate-wellness-pack header.section-header,
    body.template-page-ultimate-wellness-pack .footer,
    body.template-page-ultimate-wellness-pack .site-footer,
    body.template-page-ultimate-wellness-pack footer.section-footer { display: none !important; }
    body.template-page-ultimate-wellness-pack main { padding: 0 !important; }
```

- [ ] **Step 2: Create README.md**

```markdown
# Bluegrass Supplements — Ultimate Wellness Pack Landing Page

Long-form direct-response landing page for the Ultimate Wellness Pack (4 sublingual sprays, $84.15/mo subscription or $99 one-time).

- **Preview:** https://bluegrass-landers.vercel.app (Vercel)
- **Target product:** https://www.bluegrassvitamins.com/products/ultimate-wellness-bundle-1
- **Reference inspiration:** https://primalqueen.com/pages/tiktok (structure only — not copied)
- **Spec:** [bluegrass-wellness-bundle-design.md](../lushfulcontent/docs/superpowers/specs/2026-05-26-bluegrass-wellness-bundle-design.md)

## Repo structure

```
bluegrass-landers/
├── index.html      # The full lander (HTML + inline CSS + inline JS)
├── vercel.json     # Static-only deploy config
├── README.md       # This file
└── .gitignore
```

## How to deploy a preview update

```bash
cd /Users/nicholasstewart/Claude/bluegrass-landers
git push
# Vercel auto-deploys on push. Preview URL stays the same.
```

## How to publish to Shopify

1. Open Shopify admin → Online Store → Pages → Add page
2. Title: `Ultimate Wellness Pack`
3. URL handle: `ultimate-wellness-pack` (matches the `template-page-ultimate-wellness-pack` selector in our CSS)
4. In the content editor, switch to source-code view (`<>` icon)
5. Open `index.html` in this repo, copy everything between `<body>` and `</body>` (inclusive of the content but excluding the body tags themselves)
6. ALSO copy the `<style>` block from inside `<head>` and paste it at the top of the page body
7. Paste into the Shopify source view
8. Save the page

### Full-bleed (hide theme header/footer)

The CSS includes scoped hides for theme chrome. You may need to update the selectors to match Bluegrass's active theme:

- Open the published page on the live site
- Right-click the header → Inspect
- Note the outermost wrapping element class (e.g. `.header-wrapper` for Dawn, `.site-header` for Impulse)
- In `index.html`, update the selectors under the `SHOPIFY FULL-BLEED HIDES` comment to match
- Re-paste the updated CSS into the Shopify Page

## Asset replacement workflow

All images use `placehold.co` placeholders with `data-replace="key"` attributes. To swap in real images:

1. Upload final images to Shopify admin → Settings → Files
2. Copy each image's CDN URL
3. In the Shopify Page source view, find the placeholder by its `data-replace` key:
   - `hero-4-bottles` — main hero image
   - `bundle-hero-4-bottles-lifestyle` — bundle reveal full-width image
   - `spray-b12-bottle`, `spray-immune-bottle`, `spray-drift-bottle`, `spray-hairnail-bottle` — individual bottles
   - `science-absorption-diagram` — sprays-vs-pills diagram
   - `testimonial-jason-avatar`, `testimonial-2-avatar`, `testimonial-3-avatar`, `testimonial-4-avatar` — customer photos
4. Replace the `src=` value with the Shopify CDN URL

## Outstanding TODOs (before launch)

- [ ] Confirm brand hex codes with client (current palette is best-guess from site inspection)
- [ ] Swap 4 placeholder testimonials for real Bluegrass reviews
- [ ] Source-check the absorption claims in Section 10 — currently hedged with "studies suggest"; replace with sourced citations OR keep hedged
- [ ] Upload real product photography (hero, bundle, 4 individual bottles, absorption diagram)
- [ ] Update Shopify theme selectors in the full-bleed CSS once we know the active theme
- [ ] Verify the one-time `/cart/47823287189745:1` URL actually allows one-time purchase (some SKUs are subscription-only)

## Reference IDs

- **Product handle:** `ultimate-wellness-bundle-1`
- **Variant ID:** `47823287189745`
- **Selling Plan ID:** `5323489521` (monthly subscription, 15% off)
- **Subscription URL:** `https://www.bluegrassvitamins.com/cart/47823287189745:1?selling_plan=5323489521`
- **One-time URL:** `https://www.bluegrassvitamins.com/cart/47823287189745:1`

## Constraints (DO NOT change without revisiting)

- No money-back guarantee copy (Bluegrass policy doesn't support it)
- No HSA/FSA emphasis (per client direction)
- No founder story (Bluegrass doesn't have one)
- No `selling_plan` other than 5323489521 (only monthly is exposed by the product API)
```

- [ ] **Step 3: Deploy + verify preview**

```bash
cd /Users/nicholasstewart/Claude/bluegrass-landers
git add index.html README.md
git commit -m "feat: README handoff + Shopify full-bleed CSS scope"
git push
npx vercel --prod
```

Expected: production deploy succeeds, URL prints. Open URL and verify page renders correctly with all 18 sections.

- [ ] **Step 4: Share preview URL**

Send the final Vercel URL to the client for review. Done.

---

## Self-review (run before claiming complete)

After the engineer finishes all tasks, run through this checklist:

- [ ] All 18 content sections present and in spec order
- [ ] Announcement bar sticky at top
- [ ] Hero countdown ticking
- [ ] All 6 primary CTAs deeplink to the subscription URL (variant + selling_plan)
- [ ] One-time CTA in pricing block links to variant-only URL
- [ ] Pricing toggle switches between Subscribe ($84.15) and One-Time ($99)
- [ ] FAQ accordion opens/closes
- [ ] No "money-back guarantee", "satisfaction guaranteed", or "365-day" anywhere
- [ ] No "HSA/FSA" in announcement bar, trust strip, hero, or pricing block
- [ ] No founder story / fabricated person
- [ ] 10K+ customers + 50K+ bottles social proof numbers used (not 1M+ or 10,000)
- [ ] Absorption claims hedged ("studies suggest", "research indicates" — no "9x" or "10x")
- [ ] Mobile renders cleanly at 375px wide
- [ ] All image placeholders use `data-replace="..."` attribute
- [ ] README handoff exists with TODO list
- [ ] Vercel preview URL works
