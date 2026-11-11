# Moinul Islam Rehan — Portfolio

The personal site of a product designer in Dhaka. Five pages of work, process and background, built as plain static files: no framework, no build step, no dependencies to install.

## Running it

Any static server will do. There is a PowerShell one in the repo:

```powershell
./serve.ps1
```

Then open <http://localhost:5500>. Or use whatever you already have:

```bash
python -m http.server 5500
npx serve .
```

Opening `index.html` straight from the filesystem mostly works, but the pages load `css/site.css` and `js/site.js` by relative path, so a server is the reliable way.

## Pages

| File | What it is |
| --- | --- |
| `index.html` | The full scrolling page — hero, work, services, process, about, client feedback, contact |
| `projects.html` | All six projects, each with an in-page walkthrough |
| `about.html` | Background, work experience, education |
| `blog.html` | Writing (nothing published yet) |
| `contact.html` | How to get in touch, how a project runs, FAQ |

`services.html`, `process.html` and `clients.html` are standalone copies of sections that also live on the home page. Nothing links to them.

## How it is put together

```
css/site.css    all styling, including the design tokens in :root
js/site.js      one script, guarded so every page can share it
images/         photography, project shots, company and tool logos
media/          video
backup/         earlier versions of the home page
```

**Styling** runs on CSS custom properties — colours, spacing and type scale are declared once at the top of `site.css`. Layout is CSS Grid with named areas. There is no CSS framework.

**Behaviour** is one vanilla script. Every block checks for its element before binding, so the same file is safe on all pages. It covers the headline reveal, the cursor-following portrait, scroll reveals, the testimonial carousel, the project walkthrough dialog, the menu, and the footer.

Notable bits:

- The portrait reveal and the footer wordmark share a registered `@property --lens` custom property, which is what makes the radial reveal animatable.
- The project walkthrough is a native `<dialog>`; the FAQ is native `<details>`. Neither needs JavaScript to be usable.
- The menu is a visible row above 1000px and a full-screen panel below it. That panel is deliberately a sibling of `<header>`, not a child — the header carries a `backdrop-filter`, and a filtered ancestor becomes the containing block for fixed-position descendants.

## Accessibility and motion

Interactive controls are real buttons and links. The testimonial switcher follows the tablist pattern with arrow-key support. Every animation is disabled under `prefers-reduced-motion: reduce`.

## Credit

Design and build by Moinul Islam Rehan. Project imagery belongs to the respective clients.
