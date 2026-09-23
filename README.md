# TropiHug™

> The art of holding on. The Indonesian *guling*, reimagined.

An editorial, conversion-focused landing page for **TropiHug™** — a premium direct-to-consumer sleep brand built around the Indonesian *guling* (bolster / body pillow). The page is styled as a real, live storefront reserving its first production batch, with the actual conversion routed to a **waitlist / soft-preorder** capture (no payment backend).

> **Note:** TropiHug™ is a fictional brand created as a design/portfolio piece. No real products are sold and no payments are collected. Material and certification claims are written to be FTC-plausible for realism, not as endorsements.

## Preview

**Live:** [tropihug.pages.dev](https://tropihug.pages.dev)

![TropiHug™ — hero](docs/preview-hero.jpg)

**Full-page capture** (all 16 sections, top to bottom): [`docs/preview-full.jpg`](docs/preview-full.jpg)

---

## What it is

- A single-page storefront that **feels like a real brand**: price, variants, ratings & reviews, trust badges, batch scarcity, FAQ.
- Primary action: **reserve a numbered guling** → email capture → a thank-you page that acts as a **referral growth loop** (queue position + share link).
- Research-informed: waitlist conversion best-practice, premium sleep-DTC teardowns, and Mobbin visual patterns.

---

## Tech stack

- **Pure HTML5 / CSS3 / vanilla JS** — no framework; the Pages workflow stages the deployable files in `dist/`.
- **[Motion.dev](https://motion.dev)** (CDN) for scroll reveals & parallax — the page degrades gracefully and works fully without it.
- Fonts: **Fraunces** (serif display), **Inter** (body), **JetBrains Mono** (labels).
- Accessibility & performance: semantic markup, `prefers-reduced-motion` guard, lazy images, no horizontal scroll, mobile drawer nav, `Product` JSON-LD.

---

## Sections

1. **Announce bar** — batch scarcity marquee
2. **Nav** — transparent → solid on scroll, mobile drawer
3. **Hero** — cinematic, context chip, dual CTA, social proof
4. **Trust strip** — trial / shipping / certification / guarantee
5. **The Ritual** — slow-scroll narrative
6. **Origin** — guling heritage (cooling-by-airflow, kapok)
7. **The Guling (PDP)** — benefits, price, swatches, reserve, live stock
8. **Material label** — spec grid + certification cluster (FTC-safe copy)
9. **Stack vs. Hug** — spine-alignment education
10. **Colours of the Earth** — horizontal cover collection with prices
11. **The Journey Home** — shipping steps
12. **Real rituals** — UGC masonry + testimonial
13. **Reviews** — rating summary + verified reviews
14. **FAQ** — preempts real objections
15. **Reserve** — email capture with inline success swap
16. **Footer** — link columns, socials, payment badges, oversized wordmark

---

## Design tokens (excerpt)

```css
--paper:  #f6f1e8;   /* warm cream background — no pure white */
--ink:    #211b14;   /* warm near-black text */
--forest: #29332b;   /* dark sections */
--clay:   #b0533a;   /* primary accent / CTAs (~5% of surface) */
--sage:   #8fa89b;   /* product accent */
```

Palette is deliberately warm/earthy (avoids the blue-purple "AI default" band); a paper-grain overlay and restrained motion reinforce a hand-made, editorial feel.

---

## Getting started

```bash
# any static server
python -m http.server 8000
# then open http://localhost:8000
```

## Cloudflare Pages deployment

To deploy automatically from Git, create a **new Git-integrated Pages project** in Cloudflare and connect it to this repository. The existing live `tropihug.pages.dev` project uses Direct Upload; Cloudflare does not let you add Git integration to that project later. To retain the same `pages.dev` address, you may need to migrate or rename the existing Pages project when setting up the new one.

Use these build settings in Cloudflare:

- Production branch: `main`
- Framework preset: `None`
- Build command: `npm run build:pages`
- Build output directory: `dist`

The build copies the two HTML pages, CSS, JavaScript, and `assets/` into `dist/`; local tools, docs, and environment files are excluded. Cloudflare will deploy new commits to `main` automatically. To prepare and inspect the output locally, run `npm run build:pages`.

---

## Form handling

The reserve form (`main.js`) validates email client-side, stores reservations in `localStorage`, assigns a mock queue position, and redirects to `thank-you.html?pos=…`. The thank-you page reads the position and generates a shareable referral link. To connect a real backend, replace the mock persistence block in `WaitlistForm`/`initForm` with a `fetch()` to your endpoint.

---

## Project structure

```text
tropihug/
├── index.html             # Landing page — 16 sections, semantic HTML5
├── thank-you.html         # Post-reserve: queue position + referral share loop
├── styles.css             # Design tokens + all styling (~780 lines, no framework)
├── main.js                # Motion.dev reveals, nav, swatches, form (progressive)
├── assets/                # Self-hosted images (hero, covers, product, gallery)
├── docs/
│   ├── preview-hero.jpg   # Above-the-fold capture
│   ├── preview-full.jpg   # Full-page capture
│   └── design-reference/  # Original Google Stitch export (v0 provenance)
├── AGENTS.md              # How this was built — human × AI process log
├── LICENSE                # MIT
└── README.md
```

---

## License

MIT — see [LICENSE](LICENSE).

**Built as a portfolio piece.** [lemburlab.com](https://lemburlab.com) · [@lemburlab](https://github.com/lemburlab)

---

## Local Higgsfield agent tool

The local Node.js CLI can generate images with Marketing Studio Image (2.5 Sunburst), generate prompt-to-video clips with Seedance 2.5, poll saved requests, and download results. It uses direct REST calls so request IDs and status URLs are journaled locally between agent runs. It does not add API credentials to browser code.

### Configure credentials

Use Node.js 22.6 or newer. Copy `.env.example` to `.env.local`, then add the API key ID and secret from [Higgsfield Console](https://console.higgsfield.ai) as one `key-id:key-secret` pair. `.env.local` and the local job journal are ignored by Git. Do not paste API credentials into chat, prompts, or committed files.

```powershell
Copy-Item .env.example .env.local
# Edit .env.local locally and fill in HF_CREDENTIALS.
node tools/higgsfield.mjs help
```

### Replace the site photos

Preview the eight prompts for the images currently referenced by the site:

```powershell
node tools/higgsfield.mjs site-images --dry-run
```

After configuring `.env.local`, generate and install replacements:

```powershell
node tools/higgsfield.mjs site-images
```

The command submits one image at a time, stores each `request_id`, polls with backoff, and downloads completed results into `assets/`. Existing images are backed up under the ignored `.higgsfield/backups/` directory. Results are installed only after a successful download. Generation uses your Higgsfield account and may incur charges; check the current model pricing in Console.

### Generate site videos

The video manifest contains the silent Seedance 2.5 hero and bedroom clips, plus six presenter-led Kling 3.0 Pro clips: three introduce the guling story and three showcase the pillow. Preview every prompt and model setting before submitting:

```powershell
node tools/higgsfield.mjs site-videos --dry-run
```

After configuring valid Higgsfield credentials, generate and save the manifest clips into `assets/`:

```powershell
node tools/higgsfield.mjs site-videos
```

The command stores each request ID, polls with backoff, and downloads only completed videos. Existing successful outputs are reused unless `--force` is supplied. Generation uses your Higgsfield account and may incur charges.

### Generate other media

```powershell
node tools/higgsfield.mjs image --prompt "A quiet bedroom with a sage guling at first light" --output assets/extra-image --wait
node tools/higgsfield.mjs video --prompt "A slow cinematic dolly across a sunlit bedroom and long bolster" --output .higgsfield/output/brand-film --duration 5 --wait
```

Without `--wait`, generation returns the request ID for later use. Resume with `node tools/higgsfield.mjs wait <request_id>`, inspect with `status <request_id>`, list owned jobs with `jobs`, or save a completed result with `download <request_id> --output <project-relative-path>`. The journal is local to the current OS user; unknown request IDs are not polled.

The tool uses the currently documented [Marketing Studio Image 2.5 Sunburst](https://open.higgsfield.ai/models/marketing-studio/image/sunburst/api-reference), [Seedance 2.5 Text-to-Video](https://open.higgsfield.ai/models/bytedance/seedance-2.5/text-to-video/api-reference), and [Kling 3.0 Pro Text-to-Video](https://open.higgsfield.ai/models/kling-video/v3.0/pro/text-to-video/api-reference) endpoints. It follows Higgsfield's [request lifecycle](https://docs.higgsfield.ai/docs/concepts/requests.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), and [error handling](https://docs.higgsfield.ai/docs/concepts/errors.md) guidance. Kling clips include on-camera English dialogue and native audio; their player controls let visitors choose when to hear the presenter.

### Official SDK Seedance 2.5 example

The SDK smoke example uses the official `@higgsfield/client` package and Node.js 22.6 or newer. Add a matching key ID and secret locally to the ignored `.env.local` file:

```text
HF_CREDENTIALS=key-id:key-secret
```

Run the one-shot, billable request with:

```powershell
npm install
npm run higgsfield:seedance
```

The example submits `A cinematic scene at sunset` for 5 seconds at 720p and 16:9, waits using the SDK's polling, and prints a URL only for a completed video. Failed, canceled, moderated, incomplete, and authentication-error results exit without reporting success. Keep `.env.local` on your machine; never paste or commit its contents.
