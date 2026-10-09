# Moinul Islam Rehan, portfolio

A small static site. `build.py` turns the content files into web pages in `dist/`. It needs only Python 3, which macOS and Vercel already have, so there is nothing to install.

## Preview on this Mac

```sh
python3 build.py --serve
```

Then open http://127.0.0.1:5500/. Run it again after changing anything.

## Edit content

Use the admin, Pages CMS, at https://app.pagescms.org (or `/admin` on the live site). Sign in with GitHub and open this repository. Every save is a commit, and Vercel rebuilds the site by itself.

| In the admin | File | Page |
|---|---|---|
| Projects | `content/projects/<name>.json` | `/projects/<name>/` (featured ones also on the home page) |
| Blog posts | `content/posts/<name>.json` | `/blog/<name>/` (only when "Publish on the site" is on) |
| About page | `content/about.json` | `/about/` |

Images live in `public/images/`. Use JPG or WebP, about 1600 px wide and under 500 KB.

## Folders

```
content/          what the admin edits (projects, blog posts, About)
public/           copied into the site as is (images/, admin/)
src/templates/    page layouts
src/assets/       site.css and site.js
build.py          the site builder
.pages.yml        the admin's forms
vercel.json       Vercel settings: build with python3 build.py, publish dist/
dist/             the built site (made by build.py; not stored in git)
```

## Deploy on Vercel

1. Import this GitHub repository at https://vercel.com/new.
2. Leave the settings as they are. `vercel.json` already sets the build command and the output folder.
3. Click Deploy. After that, every push or admin save deploys again.

Link previews use the site's full address, which `build.py` reads from Vercel. For a custom domain, add a `SITE_URL` environment variable in Vercel, for example `https://example.com`.
