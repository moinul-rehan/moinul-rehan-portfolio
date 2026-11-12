<div align="center">

# MOINUL&#8209;REHAN

**The portfolio site of a product designer in Dhaka.**

Five pages of work, process and background — built as a technical document rather than a brochure. Registration marks in the corners, `[01]`-numbered sections, a blueprint column grid behind the hero. No framework, no build step, nothing to install.

`HTML` · `CSS` · `Vanilla JS` · `0 dependencies`

**Live:** [www.moinul-rehan.info](https://www.moinul-rehan.info)

</div>

---

|  |  |  |  |
| --- | --- | --- | --- |
| **PAGES** <br> 5 | **STYLESHEETS** <br> 1 | **SCRIPTS** <br> 1 | **DEPENDENCIES** <br> 0 |
| **CSS** <br> 1,212 lines | **JS** <br> 864 lines | **BUILD STEP** <br> none | **FONTS** <br> Geist, Geist Mono |

---

## `[01]` Run it

Any static server works. There is a PowerShell one in the repo:

```powershell
./serve.ps1          # http://localhost:5500
```

Or bring your own:

```bash
python -m http.server 5500
npx serve .
```

Opening `index.html` from the filesystem mostly works, but the pages pull `css/site.css` and `js/site.js` by relative path — a server is the reliable way.

---

## `[02]` The pages

| | Page | What it holds |
| --- | --- | --- |
| `01` | **`index.html`** | The full scrolling page: hero, selected work, services, process, about, client feedback, contact |
| `02` | **`projects.html`** | All six projects, each with an in-page walkthrough |
| `03` | **`blog.html`** | Writing. Nothing published yet, and the page says so rather than inventing filler |
| `04` | **`about.html`** | Background, work history, education |
| `05` | **`contact.html`** | How to make contact, how a project runs, FAQ |

`index.html` is deliberately the long scroll **and** the other pages exist standalone — some people scroll, some people navigate.

`services.html`, `process.html` and `clients.html` are leftover standalone copies of home-page sections. Nothing links to them.

---

## `[03]` Anatomy

```
├── index.html          the long scroll
├── projects.html       ·
├── about.html          ·  each page is self-contained markup
├── blog.html           ·  sharing one stylesheet and one script
├── contact.html        ·
│
├── css/site.css        every style, tokens first
├── js/site.js          every behaviour, one guarded IIFE
│
├── images/             portraits, project shots, company and tool marks
├── media/              video and poster
├── backup/             earlier versions of the home page
└── serve.ps1           local static server for Windows
```

One stylesheet and one script serve all five pages. **Every block in `site.js` checks for its element before binding**, so the same file is safe on a page that has no carousel, no portrait and no modal.

---

## `[04]` Design tokens

Everything is declared once in `:root`. There is no CSS framework and no hardcoded hex below the token block.

| Surfaces | | Ink | | Accent | |
| --- | --- | --- | --- | --- | --- |
| `--paper` | `#F5F5F3` | `--ink` | `#2A2C2D` | `--accent` | `#C2410C` |
| `--paper-alt` | `#ECEDEB` | `--ink-soft` | `#626667` | `--accent-deep` | `#9A3412` |
| `--surface` | `#FFFFFF` | `--ink-dash` | `#9EA1A1` | `--accent-wash` | `#FBEDE4` |
| `--image-bg` | `#F4F4F2` | `--hairline` | `#B9BBB9` | `--on-accent` | `#FFFFFF` |

Type runs on utility classes rather than element selectors — `.d-xl` `.h-lg` `.h-md` `.h-sm` for display and headings, `.b-lg` `.b-md` `.b-sm` for body, and `.lbl` `.lbl-sm` `.data` for the mono labels that carry the technical-document feel.

Measure is `--content: 1248px` inside a fluid `--gutter: clamp(20px, 6.6vw, 96px)`.

---

## `[05]` What moves, and why

| Element | Behaviour |
| --- | --- |
| **Hero headline** | Split into letters and lifted on a staggered delay. Words stay unbreakable so nothing orphans |
| **Portrait** | A radial lens follows the cursor, revealing the colour photograph through a stipple print |
| **Footer wordmark** | The same lens, inverted — a warm pool of light travelling through a charcoal watermark |
| **Footer clock** | A live Dhaka time in tabular figures, because a frozen "UTC+6" is a dead line |
| **Client feedback** | Panels ride up through a fixed window; the accent rule under the active name *is* the timer |
| **Project walkthrough** | A native `<dialog>`, opened from the work rows |
| **Menu** | A visible row on desktop; a full-screen panel with bold numbered links below 1000px |

---

## `[06]` Decisions worth knowing

The non-obvious things, so the next person does not have to rediscover them.

**The menu panel is a sibling of `<header>`, not a child.** The header carries a `backdrop-filter`, and a filtered ancestor becomes the containing block for its fixed-position descendants. Nested inside, a `position: fixed; inset: 0` panel sizes itself to the header strip instead of the viewport.

**`@property --lens` is what makes the reveals animatable.** A plain custom property cannot be transitioned; registering it with `syntax: "<length>"` means one value can drive a mask radius, a gradient stop and a ring at once, and still ease.

**The footer mark degrades to a flat watermark.** It uses `background-clip: text` over a radial gradient. At rest the lens radius is `0`, every gradient stop collapses onto one point, and the result is the same charcoal watermark it would be without any script — so nothing depends on a pointer ever arriving.

**The carousel does not trust `animationend` alone.** The progress rule firing its own `animationend` is what advances the quote, which is elegant until the event is missed — under a background tab, or a headless render. A timeout guard advances it anyway, and respects the manual and hover-held states.

**`<dialog>` and `<details>` do the structural work.** The project walkthrough and the FAQ accordion are native elements. The FAQ needs no JavaScript at all.

**The footer wordmark is measured, not guessed.** A script sizes it at a 100px reference, measures the glyph run, subtracts the trailing letter-space and scales to the exact column width — then re-runs once webfonts land, because Geist changes the metrics.

---

## `[07]` Responsive

Mobile-first in behaviour even though the CSS reads desktop-down. Six breakpoints, each earning its place:

| Width | What changes |
| --- | --- |
| `≥ 1000px` | Nav links show as a row; the hamburger and its panel step out |
| `≤ 1080px` | Hero, case studies, about and the flow diagram go single-column; the blueprint grid is dropped |
| `≤ 900px` | The walkthrough dialog stacks, hero image first |
| `≤ 860px` | Client feedback stops splitting 65/35; data strips become 2×2; CV rows stack |
| `≤ 640px` | The tag row wraps; avatars and buttons come down a size |
| `≤ 560px` | Footers stack; the corner registration marks are dropped |

---

## `[08]` Accessibility and motion

- Controls are real `<button>` and `<a>` elements — nothing clickable is a `<div>`
- The client-feedback switcher follows the tablist pattern: roving `tabindex`, `aria-selected`, arrow keys, `Home` and `End`
- The menu traps nothing but handles `Escape`, outside clicks, and a resize up to desktop
- Panels fade with `visibility` plus `transition-delay` rather than `display`, so they stay out of the tab order while hidden
- **Every animation is disabled under `prefers-reduced-motion: reduce`**

---

<div align="center">

Design and build by **Moinul Islam Rehan** · Dhaka, Bangladesh

Project imagery belongs to the respective clients.

</div>
