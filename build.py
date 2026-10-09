#!/usr/bin/env python3
"""Builds Rehan's portfolio site into dist/.

    python3 build.py                 build once into dist/
    python3 build.py --serve         build, then preview at http://127.0.0.1:5500/
    python3 build.py --serve --port 5600

Where things live:
    content/projects/*.json   one file per project; the admin (Pages CMS) edits these.
                              The file name is the web address:
                              content/projects/handynaija.json -> /projects/handynaija/
    content/about.json        the About page; content/posts/*.json the blog posts.
    public/                   copied into the site as is: public/images/ (every image; admin
                              uploads land here too) and public/admin/ (the admin shortcut).
    src/templates/            the page layouts (home, shared page shell).
    src/assets/               the shared stylesheet and script.
    vercel.json               tells Vercel to run this file and publish dist/.

Pages it writes:
    /                         home: the canvas cover, up to three featured projects, notes,
                              record, comments and contact.
    /projects/                every published project.
    /projects/<name>/         one page per project.
    /about/                   from content/about.json.
    /contact/                 email, booking link, profiles and the brief builder.
    /blog/                    every published post (content/posts/*.json), newest first.
    /blog/<name>/             one page per post.
    /404.html                 shown for an address that does not exist.

Only the Python standard library is used, so there is nothing to install. Link previews need
the site's full address: on Vercel it is read automatically (VERCEL_PROJECT_PRODUCTION_URL);
anywhere else, set SITE_URL (for example https://example.com).
"""

import argparse
import datetime
import functools
import hashlib
import html
import html.parser
import http.server
import json
import os
import re
import shutil
import struct
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
CONTENT = os.path.join(ROOT, "content", "projects")
PUBLIC = os.path.join(ROOT, "public")
IMAGES = os.path.join(PUBLIC, "images")
SRC = os.path.join(ROOT, "src")
DIST = os.path.join(ROOT, "dist")
SITE_URL = (os.environ.get("SITE_URL") or (
    "https://" + os.environ["VERCEL_PROJECT_PRODUCTION_URL"] if os.environ.get("VERCEL_PROJECT_PRODUCTION_URL") else "")).rstrip("/")
MAX_FEATURED = 3
SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
POSTS = os.path.join(ROOT, "content", "posts")

EMAIL = "rehan.moinul.10@gmail.com"
# The "Let's Talk" booking link from Rehan's Framer site.
CALENDAR_URL = ("https://calendar.google.com/calendar/u/0/appointments/schedules/"
                "AcZssZ2QbzyoDwjBuUYyxzE1Ub669_j_sG9cuGV9FV6rZvZ9WZurZrcpnp8MHyuvRgJd4PpZ5dYOR1No")
PROFILES = (("LinkedIn", "https://www.linkedin.com/in/moinul-rehan/", "linkedin.com/in/moinul-rehan"),
            ("Behance", "https://www.behance.net/moinul_rehan", "behance.net/moinul_rehan"),
            ("Dribbble", "https://dribbble.com/moinul-rehan", "dribbble.com/moinul-rehan"),
            ("GitHub", "https://github.com/moinul-rehan", "github.com/moinul-rehan"),
            ("X", "https://x.com/moinul_rehan", "x.com/moinul_rehan"),
            ("Instagram", "https://www.instagram.com/moinul_rehan/", "instagram.com/moinul_rehan"))
# Set by build(): the Blog link only appears once there is a published post to read.
SITE = {"blog": False}

warnings = []


def warn(msg):
    warnings.append(msg)


def esc(value):
    return html.escape("" if value is None else str(value), quote=True)


def text(value):
    """A trimmed string from any JSON value (missing, null and numbers included)."""
    if value is None:
        return ""
    return str(value).strip()


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def fill(template, values):
    """Replaces every {{name}} in the template. A name with no value is an error, not a blank."""
    def swap(m):
        key = m.group(1)
        if key not in values:
            raise KeyError("template placeholder {{%s}} has no value" % key)
        return values[key]
    return re.sub(r"\{\{([a-z_]+)\}\}", swap, template)


# ---------------------------------------------------------------- images

def image_size(path):
    """Width and height of a JPEG, PNG, GIF or WebP file, read from its header; None if unknown."""
    try:
        with open(path, "rb") as f:
            head = f.read(64)
            if head[:8] == b"\x89PNG\r\n\x1a\n":
                return struct.unpack(">II", head[16:24])
            if head[:6] in (b"GIF87a", b"GIF89a"):
                return struct.unpack("<HH", head[6:10])
            if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
                kind = head[12:16]
                if kind == b"VP8 ":
                    w, h = struct.unpack("<HH", head[26:30])
                    return w & 0x3FFF, h & 0x3FFF
                if kind == b"VP8L":
                    b = head[21:25]
                    w = 1 + (((b[1] & 0x3F) << 8) | b[0])
                    h = 1 + (((b[3] & 0x0F) << 10) | (b[2] << 2) | ((b[1] & 0xC0) >> 6))
                    return w, h
                if kind == b"VP8X":
                    w = 1 + int.from_bytes(head[24:27], "little")
                    h = 1 + int.from_bytes(head[27:30], "little")
                    return w, h
                return None
            if head[:2] == b"\xff\xd8":
                f.seek(2)
                while True:
                    marker = f.read(2)
                    if len(marker) < 2 or marker[0] != 0xFF:
                        return None
                    code = marker[1]
                    if code in (0xD8, 0x01) or 0xD0 <= code <= 0xD7:
                        continue
                    length = struct.unpack(">H", f.read(2))[0]
                    if 0xC0 <= code <= 0xCF and code not in (0xC4, 0xC8, 0xCC):
                        h, w = struct.unpack(">xHH", f.read(5))
                        return w, h
                    f.seek(length - 2, 1)
    except (OSError, struct.error):
        return None
    return None


def image(src, where):
    """Checks an image path from the content. Returns (src, width, height) or None."""
    src = text(src)
    if not src:
        return None
    if not src.startswith("/images/") or ".." in src:
        warn("%s: image %r is not inside /images/, so it was left out" % (where, src))
        return None
    path = os.path.join(IMAGES, *src[len("/images/"):].split("/"))
    if not os.path.isfile(path):
        warn("%s: image %s was not found in public/images/, so it was left out" % (where, src))
        return None
    size = image_size(path)
    if not size:
        warn("%s: could not read the size of %s" % (where, src))
        return (src, None, None)
    if os.path.getsize(path) > 800 * 1024:
        warn("%s: %s is %d KB; under 500 KB loads faster" % (where, src, os.path.getsize(path) // 1024))
    return (src, size[0], size[1])


def img_tag(img, alt, cls="", lazy=True, priority=False):
    src, w, h = img
    attrs = ['src="%s"' % esc(src)]
    if w and h:
        attrs.append('width="%d" height="%d"' % (w, h))
    attrs.append('alt="%s"' % esc(alt))
    if cls:
        attrs.append('class="%s"' % cls)
    if priority:
        attrs.append('fetchpriority="high"')
    elif lazy:
        attrs.append('loading="lazy"')
    attrs.append('decoding="async"')
    return "<img %s>" % " ".join(attrs)


# ---------------------------------------------------------------- content

def safe_url(url, where):
    url = text(url)
    if re.match(r"^(https?://|mailto:|/)", url, re.I) and not re.match(r"^/[/\\\s]", url) and not re.search(r"[\x00-\x1f]", url):
        return url
    if url:
        warn("%s: link %r was left out (it must start with https://, mailto: or /)" % (where, url))
    return ""


def load_projects():
    projects = []
    if not os.path.isdir(CONTENT):
        return projects
    for name in sorted(os.listdir(CONTENT)):
        if not name.endswith(".json"):
            continue
        path = os.path.join(CONTENT, name)
        where = "content/projects/" + name
        try:
            data = json.loads(read(path))
        except ValueError as e:
            # A broken file stops the build, so the live site keeps its last good version.
            sys.exit("Build stopped: %s is not valid JSON (%s)" % (where, e))
        if not isinstance(data, dict):
            sys.exit("Build stopped: %s must hold one project (a JSON object)" % where)
        slug = name[:-5]
        if not SLUG.match(slug):
            warn("%s: rename the file to lowercase letters, numbers and dashes (e.g. my-project.json); skipped" % where)
            continue
        p = {
            "slug": slug,
            "where": where,
            "title": text(data.get("title")),
            "published": data.get("published", True) is not False,
            "featured": data.get("featured") is True,
            "order": data.get("order"),
            "headline": text(data.get("headline")),
            "category": text(data.get("category")),
            "summary": text(data.get("summary")),
            "cover_alt": text(data.get("cover_alt")),
            "cover_caption": text(data.get("cover_caption")),
            "cover_focus": text(data.get("cover_focus")).lower(),
            "role": text(data.get("role")),
            "credit": text(data.get("credit")),
            "client": text(data.get("client")),
            "year": text(data.get("year")),
            "status": text(data.get("status")),
            "platform": text(data.get("platform")),
            "tools": [text(t) for t in (data.get("tools") or []) if text(t)],
            "decision": text(data.get("decision")),
        }
        if not p["published"]:
            continue
        if not p["title"] or not p["headline"]:
            warn("%s: needs a project name and a headline; skipped" % where)
            continue
        p["cover"] = image(data.get("cover"), where)
        if not p["cover"]:
            warn("%s: has no cover image, so its frame shows empty" % where)
        elif not p["cover_alt"]:
            warn("%s: add a cover description (alt text)" % where)
        if p["cover_focus"] not in ("top", "center", "bottom"):
            p["cover_focus"] = "center"
        if not isinstance(p["order"], (int, float)) or isinstance(p["order"], bool):
            p["order"] = None
        p["links"] = []
        for link in data.get("links") or []:
            if not isinstance(link, dict):
                continue
            url = safe_url(link.get("url"), where)
            label = text(link.get("label")) or url
            if url:
                p["links"].append((label, url))
        p["story"] = [b for b in (data.get("story") or []) if isinstance(b, dict)]
        projects.append(p)
    projects.sort(key=lambda p: (p["order"] is None, p["order"] or 0, p["title"].lower()))
    return projects


def featured_of(projects):
    picked = [p for p in projects if p["featured"]]
    if len(picked) > MAX_FEATURED:
        warn("%d projects are featured; the home page shows the first %d by order (%s)" % (
            len(picked), MAX_FEATURED, ", ".join(p["title"] for p in picked[:MAX_FEATURED])))
    if not picked:
        picked = projects
    return picked[:MAX_FEATURED]


# ---------------------------------------------------------------- pieces

ARROW = '<svg class="i-arrow" aria-hidden="true"><use href="#i-arrow"/></svg>'
ARROW_OUT = '<svg class="i-arrow i-out" aria-hidden="true"><use href="#i-arrow"/></svg>'
FRAME = '<svg class="i-frame" aria-hidden="true"><use href="#i-frame"/></svg>'
SEL_DECO = ('<span class="sel-deco" aria-hidden="true"><span class="sel-drag"></span><span class="sel-box">'
            '<span class="sel-handle"></span><span class="sel-handle"></span><span class="sel-handle"></span>'
            '<span class="sel-handle"></span></span><span class="sel-cursor"><svg class="sel-arrow">'
            '<use href="#i-cursor"/></svg></span></span>')


def url_of(p):
    return "/projects/%s/" % p["slug"]


def status_pill(p):
    if not p["status"]:
        return ""
    cls = "status status--shipped" if p["status"].lower() == "shipped" else "status"
    return '<span class="%s">%s</span>' % (cls, esc(p["status"]))


def credit_line(p):
    return " · ".join(x for x in (p["role"] or p["credit"], p["year"]) if x)


def card(p, level="h3"):
    """One project as a Figma frame: name and status, the cover, the headline, credit and year."""
    if p["cover"]:
        picture = img_tag(p["cover"], "")
    else:
        picture = ""
    meta = credit_line(p)
    return "\n".join([
        '        <li class="pcard">',
        '          <p class="pcard-head"><span class="frame-label">%s%s</span>%s</p>' % (FRAME, esc(p["title"]), status_pill(p)),
        '          <div class="pcard-frame" data-pcard-frame data-focus="%s">' % p["cover_focus"],
        '            <div class="pcard-img">%s</div>' % picture,
        '            <span class="pcard-sel" aria-hidden="true"><span class="sel-box"><span class="sel-handle"></span>'
        '<span class="sel-handle"></span><span class="sel-handle"></span><span class="sel-handle"></span></span>'
        '<span class="sel-badge"></span></span>',
        '          </div>',
        '          <div class="pcard-body">',
        '            <%s class="pcard-title"><a class="pcard-link" href="%s"><span class="vh">%s: </span>%s</a></%s>' % (
            level, url_of(p), esc(p["title"]), esc(p["headline"]), level),
        ('            <p class="pcard-meta">%s</p>' % esc(meta)) if meta else "",
        '            <!-- DRAFT COPY for Rehan\'s approval -->',
        '            <span class="pcard-cta" aria-hidden="true">Case study%s</span>' % ARROW,
        '            <!-- /DRAFT COPY -->',
        '          </div>',
        '        </li>',
    ]).replace("\n\n", "\n")


def paragraphs(body):
    parts = [x.strip() for x in re.split(r"\n\s*\n", text(body)) if x.strip()]
    return "".join("<p>%s</p>" % "<br>".join(esc(line) for line in part.split("\n")) for part in parts)


def framed(img, alt):
    return '<div class="pframe">%s</div>' % img_tag(img, alt)


def block_html(b, where):
    kind = text(b.get("type") or b.get("_block")).lower()
    if kind == "text":
        body = paragraphs(b.get("body"))
        heading = text(b.get("heading"))
        if not body and not heading:
            return ""
        cls = "st-text" if heading else "st-text st-text--plain"
        head = '<h2 class="st-h">%s</h2>' % esc(heading) if heading else ""
        return '      <section class="%s">%s<div class="st-body">%s</div></section>' % (cls, head, body)
    if kind == "image":
        img = image(b.get("image"), where)
        if not img:
            return ""
        cap = text(b.get("caption"))
        return '      <figure class="pfig">%s%s</figure>' % (
            framed(img, text(b.get("alt"))), "<figcaption>%s</figcaption>" % esc(cap) if cap else "")
    if kind == "gallery":
        items = []
        for it in b.get("images") or []:
            if isinstance(it, dict):
                img = image(it.get("image"), where)
                if img:
                    items.append('<li>%s</li>' % framed(img, text(it.get("alt"))))
        if not items:
            return ""
        cls = "st-grid st-grid--3" if len(items) % 3 == 0 else "st-grid"
        cap = text(b.get("caption"))
        return '      <figure class="st-gallery"><ul class="%s">%s</ul>%s</figure>' % (
            cls, "".join(items), '<figcaption class="st-caption">%s</figcaption>' % esc(cap) if cap else "")
    if kind == "before_after":
        before = image(b.get("before"), where)
        after = image(b.get("after"), where)
        if not before or not after:
            return ""
        cap = text(b.get("caption"))
        # DRAFT COPY for Rehan's approval: the "Before" and "After" labels.
        return ('      <figure class="st-ba"><div class="st-grid">'
                '<div><span class="label">Before</span>%s</div><div><span class="label">After</span>%s</div>'
                '</div>%s</figure>') % (
            framed(before, text(b.get("before_alt"))), framed(after, text(b.get("after_alt"))),
            '<figcaption class="st-caption">%s</figcaption>' % esc(cap) if cap else "")
    if kind == "quote":
        quote = text(b.get("text"))
        if not quote:
            return ""
        name, role = text(b.get("name")), text(b.get("role"))
        cite = ""
        if name or role:
            cite = '<figcaption class="st-cite">%s%s</figcaption>' % (
                "<strong>%s</strong>" % esc(name) if name else "", (", " if name and role else "") + esc(role))
        return '      <figure class="st-quote"><blockquote>%s</blockquote>%s</figure>' % (paragraphs(quote), cite)
    if kind == "numbers":
        items = []
        for it in b.get("items") or []:
            if isinstance(it, dict) and text(it.get("value")):
                items.append('<li><span class="st-value">%s</span><span class="st-label">%s</span></li>' % (
                    esc(text(it.get("value"))), esc(text(it.get("label")))))
        if not items:
            return ""
        return '      <ul class="st-numbers">%s</ul>' % "".join(items)
    warn("%s: story block type %r is not known; skipped" % (where, kind))
    return ""


# ---------------------------------------------------------------- page shell

def nav(home, here="work"):
    """The masthead links. `here` marks the current section on pages other than home."""
    rows = [("Work", "/projects/", "work"), ("About", "/about/", "about")]
    if SITE["blog"]:
        rows.append(("Blog", "/blog/", "blog"))
    rows.append(("Contact", "/contact/", "contact"))
    out = []
    for label, href, key in rows:
        current = ' aria-current="page"' if (not home and key == here) else ""
        out.append('        <li><a class="nav-link" href="%s" data-nav-link="%s"%s>%s</a></li>' % (href, key, current, label))
    return "\n".join(out)


def num(n):
    return "%02d" % n


def toc_home(featured):
    rows = []
    for i, p in enumerate(featured, 1):
        rows.append('          <li><a href="%s"><span class="toc-num">%s</span>%s</a></li>' % (url_of(p), num(i), esc(p["title"])))
    # DRAFT COPY for Rehan's approval
    rows.append('          <li><a href="/projects/"><span class="toc-num"></span>All projects</a></li>')
    rows.append('          <li><a href="/about/"><span class="toc-num"></span>About</a></li>')
    if SITE["blog"]:
        rows.append('          <li><a href="/blog/"><span class="toc-num"></span>Blog</a></li>')
    n = len(featured)
    for i, (key, label) in enumerate((("notes", "Notes"), ("record", "Record"), ("words", "Comments"), ("contact", "Contact")), 1):
        rows.append('          <li><a href="#%s" data-toc-link="%s"><span class="toc-num">%s</span>%s</a></li>' % (key, key, num(n + i), label))
    return "\n".join(rows)


def toc_page():
    # DRAFT COPY for Rehan's approval
    rows = [("/", "Home"), ("/projects/", "All projects"), ("/about/", "About"), ("/#notes", "Notes")]
    if SITE["blog"]:
        rows.append(("/blog/", "Blog"))
    rows.append(("/contact/", "Contact"))
    return "\n".join('          <li><a href="%s"><span class="toc-num"></span>%s</a></li>' % (h, l) for h, l in rows)


def meta_tags(title, description, path, image_src=None, kind="website"):
    tags = ['<meta name="description" content="%s">' % esc(description),
            '<meta property="og:type" content="%s">' % kind,
            '<meta property="og:title" content="%s">' % esc(title),
            '<meta property="og:description" content="%s">' % esc(description)]
    if SITE_URL:
        tags.insert(0, '<link rel="canonical" href="%s%s">' % (esc(SITE_URL), esc(path)))
        tags.append('<meta property="og:url" content="%s%s">' % (esc(SITE_URL), esc(path)))
    if image_src and SITE_URL:
        tags.append('<meta property="og:image" content="%s%s">' % (esc(SITE_URL), esc(image_src)))
        tags.append('<meta name="twitter:card" content="summary_large_image">')
    else:
        tags.append('<meta name="twitter:card" content="summary">')
    return "\n".join(tags)


def page(shell, version, title, meta, main, home=False, toc="", head_script="", here="work"):
    return fill(shell, {
        "title": esc(title),
        "meta": meta,
        "head_script": head_script or "<script>document.documentElement.classList.add('js');</script>",
        "version": version,
        "skip_href": "#work" if home else "#main",
        # DRAFT COPY for Rehan's approval
        "skip_text": "Skip to work" if home else "Skip to content",
        "home_href": "#top" if home else "/",
        "nav_items": nav(home, here),
        "toc_label": "Contents" if home else "Menu",
        "toc_aria": "Sections" if home else "Site",
        "toc_items": toc,
        "contact_href": "/contact/",
        "main": main,
    })


# ---------------------------------------------------------------- pages

def home_page(shell, version, projects):
    featured = featured_of(projects)
    n = len(featured)
    rows = []
    for i, p in enumerate(featured, 1):
        meta = status_pill(p) or esc(p["credit"])
        rows.append('          <li><a class="contents-row" href="%s"><span class="c-num">%s</span><span class="c-name">%s</span>'
                    '<span class="c-title">%s</span><span class="c-meta">%s</span>%s</a></li>' % (
                        url_of(p), num(i), esc(p["title"]), esc(p["headline"]), meta, ARROW))
    sections = (("notes", "Notes", "How I work"), ("record", "Record", "Where the experience comes from"),
                ("words", "Comments", "Abdullah, Shampa Banik, Starlove Annulysse"),
                ("contact", "Contact", "rehan.moinul.10@gmail.com"))
    for i, (key, name, line) in enumerate(sections, 1):
        rows.append('          <li><a class="contents-row" href="#%s"><span class="c-num">%s</span><span class="c-name">%s</span>'
                    '<span class="c-title">%s</span><span class="c-meta"></span>%s</a></li>' % (key, num(n + i), name, line, ARROW))
    if featured:
        work = "\n".join([
            '  <!-- WORK: the featured projects, as frames on the canvas. -->',
            '  <section class="section" id="work" data-spy="Work" data-nav="work" aria-labelledby="work-title">',
            '    <div class="wrap">',
            '      <div class="frame-head" aria-hidden="true">',
            '        <p class="frame-label">%sWork</p>' % FRAME,
            '      </div>',
            '      <!-- DRAFT COPY for Rehan\'s approval -->',
            '      <h2 class="section-h2" id="work-title">Selected work</h2>',
            '      <!-- /DRAFT COPY -->',
            '      <ul class="work-grid work-grid--lead">',
            "\n".join(card(p) for p in featured),
            '      </ul>',
            '      <!-- DRAFT COPY for Rehan\'s approval -->',
            '      <p class="work-more"><a class="btn btn-ghost" href="/projects/">See all projects%s</a></p>' % ARROW,
            '      <!-- /DRAFT COPY -->',
            '    </div>',
            '  </section>',
        ])
    else:
        work = '  <div id="work"></div>'
    main = fill(read(os.path.join(SRC, "templates", "home.html")), {
        "contents_rows": "\n".join(rows),
        "work_section": work,
        "num_notes": num(n + 1), "num_record": num(n + 2), "num_comments": num(n + 3), "num_contact": num(n + 4),
    })
    # DRAFT COPY for Rehan's approval
    meta = meta_tags("Moinul Islam Rehan · UI/UX Designer at TulipTech · Dhaka",
                     "Moinul Islam Rehan, UI/UX Designer at TulipTech in Dhaka. I turn messy product ideas into clear, usable products.",
                     "/", "/images/site/rehan-portrait-870.png")
    return page(shell, version, "Moinul Islam Rehan · UI/UX Designer at TulipTech · Dhaka", meta, main,
                home=True, toc=toc_home(featured), head_script=read(os.path.join(SRC, "templates", "home-head.html")).strip())


def projects_page(shell, version, projects):
    count = len(projects)
    if projects:
        listing = '      <ul class="work-grid">\n%s\n      </ul>' % "\n".join(card(p, "h2") for p in projects)
    else:
        # DRAFT COPY for Rehan's approval
        listing = '      <p class="empty-note">Projects are on their way.</p>'
    main = "\n".join([
        '  <section class="section" data-spy="Projects" data-nav="work" aria-labelledby="projects-title">',
        '    <div class="wrap">',
        '      <div class="frame-head">',
        '        <p class="frame-label" aria-hidden="true">%sProjects</p>' % FRAME,
        '        <p class="frame-meta">%d %s</p>' % (count, "project" if count == 1 else "projects"),
        '      </div>',
        '      <!-- DRAFT COPY for Rehan\'s approval -->',
        '      <h1 class="section-h2" id="projects-title">All projects</h1>',
        '      <!-- /DRAFT COPY -->',
        listing,
        '    </div>',
        '  </section>',
    ])
    # DRAFT COPY for Rehan's approval
    meta = meta_tags("Projects · Moinul Islam Rehan",
                     "Every project by Moinul Islam Rehan, UI/UX Designer at TulipTech in Dhaka.", "/projects/")
    return page(shell, version, "Projects · Moinul Islam Rehan", meta, main, toc=toc_page())


def project_page(shell, version, p, nxt):
    facts = []
    # DRAFT COPY for Rehan's approval: the fact labels.
    for label, value in (("Role", p["role"]), ("Credit", p["credit"]), ("Client", p["client"]), ("Year", p["year"]),
                         ("Status", p["status"]), ("Platform", p["platform"]), ("Tools", ", ".join(p["tools"]))):
        if value:
            facts.append('          <div><dt class="label">%s</dt><dd>%s</dd></div>' % (label, esc(value)))
    if p["links"]:
        links = "".join('<a class="ext-link" href="%s"%s>%s%s</a>' % (
            esc(url), ' target="_blank" rel="noopener"' if url.startswith("http") else "", esc(label),
            (ARROW_OUT + '<span class="vh"> (opens in a new tab)</span>') if url.startswith("http") else ARROW)
            for label, url in p["links"])
        facts.append('          <div class="facts-links"><dt class="label">Links</dt><dd class="ext-links">%s</dd></div>' % links)
    label = p["title"] + (" · " + p["category"] if p["category"] else "")
    hero = [
        '  <article class="project" aria-labelledby="project-title">',
        '    <header class="section project-hero" data-spy="%s" data-nav="work">' % esc(p["title"]),
        '      <div class="wrap">',
        '        <div class="frame-head">',
        '          <nav class="crumbs" aria-label="Breadcrumb"><a href="/projects/">%sProjects</a><span aria-hidden="true">/</span><span aria-current="page">%s</span></nav>' % (FRAME, esc(p["title"])),
        '          %s' % status_pill(p),
        '        </div>',
        '        <p class="label">%s</p>' % esc(label),
        '        <h1 class="ch-h2" id="project-title">%s</h1>' % esc(p["headline"]),
    ]
    if p["summary"]:
        hero.append('        <p class="ch-desc">%s</p>' % esc(p["summary"]))
    if p["cover"]:
        cap = '<figcaption>%s</figcaption>' % esc(p["cover_caption"]) if p["cover_caption"] else ""
        hero.append('        <figure class="pfig"><div class="pframe">%s</div>%s</figure>' % (
            img_tag(p["cover"], p["cover_alt"], priority=True), cap))
    if facts:
        hero += ['        <dl class="facts">'] + facts + ['        </dl>']
    if p["decision"]:
        hero += [
            '        <div class="decision">',
            '          <!-- DRAFT COPY for Rehan\'s approval (the label) -->',
            '          <p class="label">Decision</p>',
            '          <p class="decision-line"><span class="sel sel-block" data-sign>%s%s</span></p>' % (esc(p["decision"]), SEL_DECO),
            '        </div>',
        ]
    hero += ['      </div>', '    </header>']
    story = [x for x in (block_html(b, p["where"]) for b in p["story"]) if x]
    if story:
        hero += ['    <div class="story wrap" data-spy="%s" data-nav="work">' % esc(p["title"])] + story + ['    </div>']
    hero.append('  </article>')
    if nxt:
        hero += [
            '  <nav class="section next-project" aria-labelledby="next-title" data-spy="%s" data-nav="work">' % esc(p["title"]),
            '    <div class="wrap">',
            '      <div class="frame-head">',
            '        <!-- DRAFT COPY for Rehan\'s approval -->',
            '        <h2 class="frame-label" id="next-title">%sNext project</h2>' % FRAME,
            '        <a class="ext-link work-head-link" href="/projects/">All projects%s</a>' % ARROW,
            '        <!-- /DRAFT COPY -->',
            '      </div>',
            '      <ul class="work-grid work-grid--lead">',
            card(nxt),
            '      </ul>',
            '    </div>',
            '  </nav>',
        ]
    title = "%s: %s · Moinul Islam Rehan" % (p["title"], p["headline"])
    description = p["summary"] or p["headline"]
    meta = meta_tags(title, description, url_of(p), p["cover"][0] if p["cover"] else None, "article")
    return page(shell, version, title, meta, "\n".join(hero), toc=toc_page())


def load_about():
    """content/about.json, the About page's text (the admin edits it). None when the file is missing."""
    path = os.path.join(ROOT, "content", "about.json")
    if not os.path.isfile(path):
        return None
    try:
        data = json.loads(read(path))
    except ValueError as e:
        sys.exit("Build stopped: content/about.json is not valid JSON (%s)" % e)
    if not isinstance(data, dict) or not text(data.get("headline")):
        warn("content/about.json: needs a headline; the About page was left out")
        return None
    return data


def rows_of(data, key):
    return [r for r in (data.get(key) or []) if isinstance(r, dict)]


def about_page(shell, version, a):
    where = "content/about.json"
    headline, signed = text(a.get("headline")), text(a.get("signed"))
    if signed and headline.endswith(signed):
        title_html = '%s <span class="sel" data-sign>%s%s</span>' % (esc(headline[:-len(signed)].rstrip()), esc(signed), SEL_DECO)
    else:
        if signed:
            warn("%s: the signed words must be the end of the headline; drawn without the selection" % where)
        title_html = esc(headline)
    stats = "".join('<li class="stat-pill"><strong>%s</strong> %s</li>' % (esc(text(s.get("value"))), esc(text(s.get("label"))))
                    for s in rows_of(a, "stats") if text(s.get("value")))
    portrait = image(a.get("portrait"), where)
    figure = ""
    if portrait:
        figure = "\n".join([
            '        <figure class="about-figure">',
            '          <p class="cv-label" aria-hidden="true">%s<span class="cv-label-name">Rehan</span><span class="cv-size"></span></p>' % FRAME,
            '          <div class="cv-frame">%s</div>' % img_tag(portrait, text(a.get("portrait_alt")), priority=True),
            '        </figure>',
        ])

    def ledger(rows, label, label_id, ordered=True):
        tag = "ol" if ordered else "ul"
        return '        <div class="ledger">\n          <p class="label" id="%s">%s</p>\n          <%s class="ledger-list" aria-labelledby="%s">\n%s\n          </%s>\n        </div>' % (
            label_id, label, tag, label_id, "\n".join(rows), tag)

    jobs = []
    for r in rows_of(a, "experience"):
        role = " · ".join(x for x in (text(r.get("role")), text(r.get("company"))) if x)
        if not role:
            continue
        current = r.get("current") is True
        role_html = ('<span class="sel sel-block" data-sign>%s%s</span>' % (esc(role), SEL_DECO)) if current else esc(role)
        place, desc = text(r.get("place")), text(r.get("text"))
        jobs.append("\n".join(x for x in [
            '            <li class="ledger-row">',
            '              <p class="ledger-date">%s</p>' % esc(text(r.get("dates"))),
            '              <div class="ledger-main">',
            '                <h3 class="ledger-role">%s</h3>' % role_html,
            ('                <p class="ledger-meta">%s</p>' % esc(place)) if place else "",
            ('                <p class="ledger-desc">%s</p>' % esc(desc)) if desc else "",
            '              </div>',
            # DRAFT COPY for Rehan's approval (the tag)
            '              <p class="ledger-tag"><span class="status status--current">Current version</span></p>' if current else "",
            '            </li>',
        ] if x))
    schools = []
    for r in rows_of(a, "education"):
        title = text(r.get("title"))
        if not title:
            continue
        school, desc = text(r.get("school")), text(r.get("text"))
        schools.append("\n".join(x for x in [
            '            <li class="ledger-row">',
            '              <p class="ledger-date">%s</p>' % esc(text(r.get("dates"))),
            '              <div class="ledger-main">',
            '                <h3 class="ledger-role">%s</h3>' % esc(title),
            ('                <p class="ledger-meta">%s</p>' % esc(school)) if school else "",
            ('                <p class="ledger-desc">%s</p>' % esc(desc)) if desc else "",
            '              </div>',
            '            </li>',
        ] if x))
    marks = ['            <li class="ledger-row"><p class="ledger-date">%s</p><p class="ledger-text">%s</p></li>' % (
        esc(text(r.get("date"))), esc(text(r.get("text")))) for r in rows_of(a, "milestones") if text(r.get("text"))]
    groups = []
    for g in rows_of(a, "skills"):
        items = [text(i) for i in (g.get("items") or []) if text(i)]
        if text(g.get("group")) and items:
            groups.append('          <div><h3 class="label">%s</h3><ul>%s</ul></div>' % (
                esc(text(g.get("group"))), "".join("<li>%s</li>" % esc(i) for i in items)))

    out = [
        '  <section class="section about-hero" data-spy="About" data-nav="about" aria-labelledby="about-title">',
        '    <div class="wrap">',
        '      <div class="frame-head">',
        '        <p class="frame-label" aria-hidden="true">%sAbout</p>' % FRAME,
        '        <p class="frame-meta">UI/UX Designer at TulipTech&nbsp;· Dhaka</p>',
        '      </div>',
        '      <h1 class="ch-h2 about-title" id="about-title">%s</h1>' % title_html,
        '      <div class="about-grid">',
        '        <div class="about-intro">',
        # DRAFT COPY for Rehan's approval (the label)
        '          <p class="label">About me</p>',
        '          <div class="st-body">%s</div>' % paragraphs(a.get("intro")),
        ('          <ul class="about-stats">%s</ul>' % stats) if stats else "",
        '          <!-- DRAFT COPY for Rehan\'s approval -->',
        '          <div class="about-actions"><a class="btn btn-primary" href="mailto:rehan.moinul.10@gmail.com">Email me</a>'
        '<a class="btn btn-ghost" href="/projects/">See the work%s</a></div>' % ARROW,
        '          <!-- /DRAFT COPY -->',
        '        </div>',
        figure,
        '      </div>',
        '    </div>',
        '  </section>',
    ]
    if jobs:
        out += [
            '  <section class="section" data-spy="Experience" data-nav="about" aria-labelledby="exp-title">',
            '    <div class="wrap">',
            '      <div class="frame-head" aria-hidden="true"><p class="frame-label">%sExperience</p></div>' % FRAME,
            '      <h2 class="section-h2" id="exp-title">Where I’ve grown, designed and contributed</h2>',
            # DRAFT COPY for Rehan's approval (the ledger label)
            ledger(jobs, "Version history", "about-versions"),
            '    </div>',
            '  </section>',
        ]
    if schools or marks:
        block = [
            '  <section class="section band-cream" data-spy="Education" data-nav="about" aria-labelledby="edu-title">',
            '    <div class="wrap">',
            '      <div class="frame-head" aria-hidden="true"><p class="frame-label">%sEducation</p></div>' % FRAME,
            '      <h2 class="section-h2" id="edu-title">Where I learned and grew</h2>',
        ]
        if schools:
            block.append(ledger(schools, "Education", "about-education"))
        if marks:
            block.append(ledger(marks, "Milestones", "about-milestones", ordered=False))
        out += block + ['    </div>', '  </section>']
    if groups:
        out += [
            '  <section class="section" data-spy="Skills" data-nav="about" aria-labelledby="skills-title">',
            '    <div class="wrap">',
            '      <div class="frame-head" aria-hidden="true"><p class="frame-label">%sSkills</p></div>' % FRAME,
            '      <!-- DRAFT COPY for Rehan\'s approval -->',
            '      <h2 class="section-h2" id="skills-title">What I work with</h2>',
            '      <!-- /DRAFT COPY -->',
            '      <div class="skills">',
            "\n".join(groups),
            '      </div>',
            '    </div>',
            '  </section>',
        ]
    heading = text(a.get("contact_heading"))
    out += [
        '  <section class="section band-dark on-dark about-cta" data-spy="Contact" data-nav="about" aria-labelledby="about-contact-title">',
        '    <div class="wrap">',
        '      <div class="frame-head">',
        '        <p class="frame-label" aria-hidden="true">%sContact</p>' % FRAME,
        '        <p class="availability"><span class="availability-dot" aria-hidden="true"></span>Open to freelance projects</p>',
        '      </div>',
        # DRAFT COPY for Rehan's approval (the fallback heading)
        '      <h2 class="section-h2" id="about-contact-title">%s</h2>' % esc(heading or "Get in touch"),
        '      <div class="about-actions">'
        '<a class="btn btn-on-dark" href="mailto:rehan.moinul.10@gmail.com">rehan.moinul.10@gmail.com</a>'
        '<a class="btn btn-ghost-dark" href="https://www.linkedin.com/in/moinul-rehan/" target="_blank" rel="noopener">LinkedIn%s<span class="vh"> (opens in a new tab)</span></a>'
        '<a class="btn btn-ghost-dark" href="https://www.behance.net/moinul_rehan" target="_blank" rel="noopener">Behance%s<span class="vh"> (opens in a new tab)</span></a>'
        '</div>' % (ARROW_OUT, ARROW_OUT),
        '    </div>',
        '  </section>',
    ]
    # DRAFT COPY for Rehan's approval
    meta = meta_tags("About · Moinul Islam Rehan",
                     "Moinul Islam Rehan, UI/UX Designer at TulipTech in Dhaka: experience, education, milestones and skills.",
                     "/about/", portrait[0] if portrait else None)
    return page(shell, version, "About · Moinul Islam Rehan", meta, "\n".join(x for x in out if x),
                toc=toc_page(), here="about")



# ---------------------------------------------------------------- contact

def contact_page(shell, version):
    ext = '<span class="vh"> (opens in a new tab)</span>'
    rows = ['            <li class="ways-row"><span class="ways-key">Email</span><a class="ext-link" href="mailto:%s">%s</a></li>' % (EMAIL, EMAIL),
            # DRAFT COPY for Rehan's approval (the row names)
            '            <li class="ways-row"><span class="ways-key">Call</span><a class="ext-link" href="%s" target="_blank" rel="noopener">Book a time%s%s</a></li>' % (esc(CALENDAR_URL), ARROW_OUT, ext)]
    for name, url, shown in PROFILES:
        rows.append('            <li class="ways-row"><span class="ways-key">%s</span><a class="ext-link" href="%s" target="_blank" rel="noopener">%s%s%s</a></li>' % (
            name, esc(url), esc(shown), ARROW_OUT, ext))
    rows.append('            <li class="ways-row"><span class="ways-key">Based in</span><span>Dhaka, Bangladesh</span></li>')
    brief_mailto = ("mailto:%s?subject=Project%%20brief&amp;body=Hi%%20Rehan%%2C%%0D%%0A%%0D%%0A1.%%20Who%%20is%%20the%%20user%%3F"
                    "%%0D%%0A%%0D%%0A%%0D%%0A2.%%20What%%27s%%20actually%%20broken%%20today%%3F%%0D%%0A%%0D%%0A%%0D%%0A3.%%20What%%20does"
                    "%%20success%%20look%%20like%%3F%%0D%%0A%%0D%%0A") % EMAIL
    main = "\n".join([
        '  <section class="section contact-page" data-spy="Contact" data-nav="contact" aria-labelledby="contact-title">',
        '    <div class="wrap">',
        '      <div class="frame-head">',
        '        <p class="frame-label" aria-hidden="true">%sContact</p>' % FRAME,
        '        <p class="availability"><span class="availability-dot" aria-hidden="true"></span>Open to freelance projects</p>',
        '      </div>',
        '      <!-- DRAFT COPY for Rehan\'s approval (the heading); the standfirst is from his Framer site -->',
        '      <h1 class="ch-h2" id="contact-title">Send me the messy version.</h1>',
        '      <p class="ch-desc">If you’re looking for a design partner who listens, understands, and crafts with intention, let’s start the conversation.</p>',
        '      <!-- /DRAFT COPY -->',
        '      <p class="contact-page-email"><a class="contact-email" href="mailto:%s"><span class="sel sel-block" data-sign>rehan.moinul.10@<wbr>gmail.com%s</span></a></p>' % (EMAIL, SEL_DECO),
        '      <div class="about-actions">',
        '        <button class="btn btn-primary" type="button" data-copy="%s" hidden><span class="btn-swap"><span class="is-idle">Copy email</span><span class="is-done" aria-hidden="true">Copied</span></span></button>' % EMAIL,
        '        <!-- DRAFT COPY for Rehan\'s approval -->',
        '        <a class="btn btn-ghost" href="%s" target="_blank" rel="noopener">Book a call%s%s</a>' % (esc(CALENDAR_URL), ARROW_OUT, ext),
        '        <!-- /DRAFT COPY -->',
        '        <span class="vh" role="status" data-copy-status></span>',
        '      </div>',
        '    </div>',
        '  </section>',
        '  <section class="section band-cream" data-spy="The brief" data-nav="contact" aria-labelledby="brief-title">',
        '    <div class="wrap">',
        '      <div class="frame-head" aria-hidden="true"><p class="frame-label">%sThe brief</p></div>' % FRAME,
        '      <!-- DRAFT COPY for Rehan\'s approval: the heading, intro, labels, button and notes of the brief builder -->',
        '      <h2 class="section-h2" id="brief-title">Three questions start every project.</h2>',
        '      <div class="brief-grid">',
        '        <div class="brief-main">',
        # The form stays hidden until site.js has wired it (it unhides the form and hides the
        # fallback), so a visitor whose script did not run gets the plain link, never a form
        # that would put their answers in the address bar.
        '          <form class="brief-form" data-brief novalidate hidden aria-describedby="brief-note">',
        '            <div class="field"><label for="brief-name">Your name</label><input id="brief-name" name="name" type="text" autocomplete="name" maxlength="80" required></div>',
        '            <div class="field"><label for="brief-project">Company or project <span class="field-optional">(optional)</span></label><input id="brief-project" name="project" type="text" autocomplete="organization" maxlength="80"></div>',
        '            <div class="field"><label for="brief-q1">1. Who is the user?</label><textarea id="brief-q1" name="q1" rows="3" required></textarea></div>',
        '            <div class="field"><label for="brief-q2">2. What’s actually broken today?</label><textarea id="brief-q2" name="q2" rows="3" required></textarea></div>',
        '            <div class="field"><label for="brief-q3">3. What does success look like?</label><textarea id="brief-q3" name="q3" rows="3" required></textarea></div>',
        '            <div class="brief-submit">',
        '              <button class="btn btn-primary" type="submit">Open it in my email app%s</button>' % ARROW,
        '              <p class="field-note brief-status" role="status" data-brief-status></p>',
        '              <p class="brief-copy" data-brief-copy-row hidden><button class="btn btn-ghost" type="button" data-brief-copy><span class="btn-swap"><span class="is-idle">Copy the brief</span><span class="is-done" aria-hidden="true">Copied</span></span></button></p>',
        '            </div>',
        '            <p class="field-note" id="brief-note">Nothing is sent from this page. It opens your email app with the brief filled in, ready for you to read and send.</p>',
        '          </form>',
        '          <div class="brief-fallback" data-brief-fallback>',
        '            <p class="ch-desc">Answer these three in an email, as roughly as you like: who is the user, what’s actually broken today, and what does success look like?</p>',
        '            <p class="about-actions"><a class="btn btn-primary" href="%s">Send it as a brief%s</a></p>' % (brief_mailto, ARROW),
        '          </div>',
        '        </div>',
        '        <aside class="ways" aria-labelledby="ways-title">',
        '          <h3 class="label" id="ways-title">Other ways to reach me</h3>',
        '          <ul class="ways-list">',
        "\n".join(rows),
        '          </ul>',
        '        </aside>',
        '      </div>',
        '      <!-- /DRAFT COPY -->',
        '    </div>',
        '  </section>',
    ])
    # DRAFT COPY for Rehan's approval
    meta = meta_tags("Contact · Moinul Islam Rehan",
                     "Email Moinul Islam Rehan, book a call, or send a three-question project brief.", "/contact/")
    return page(shell, version, "Contact · Moinul Islam Rehan", meta, main, toc=toc_page(), here="contact")


# ---------------------------------------------------------------- blog

MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def nice_date(iso):
    y, m, d = iso.split("-")
    return "%s %d, %s" % (MONTHS[int(m) - 1], int(d), y)


class Clean(html.parser.HTMLParser):
    """Keeps only the formatting a blog post needs from the admin's rich-text editor: paragraphs,
    headings, lists, links, emphasis, quotes, code and images from /images/. Everything else (scripts,
    styles, frames, event handlers, inline styles) is dropped, so a post can never run code.
    Pasted <div>s become paragraphs and a pasted table is flattened to lines of text; anything
    removed with its content gets a build note, so nothing disappears without Rehan knowing."""
    ALLOWED = {"p", "br", "h2", "h3", "h4", "ul", "ol", "li", "strong", "b", "em", "i", "u", "s",
               "a", "blockquote", "code", "pre", "hr", "img", "figure", "figcaption"}
    RENAME = {"h1": "h2", "h5": "h4", "h6": "h4", "div": "p", "table": "p"}
    # Removed together with everything inside them, up to their end tag.
    DROP_WITH_CONTENT = {"script", "style", "iframe", "object", "noscript", "template", "svg", "math", "form"}
    # Removed too, but they never have content or an end tag, so nothing after them is waited for.
    DROP_VOID = {"embed"}
    VOID = {"br", "hr", "img"}
    # A new block closes an open paragraph first, as browsers do, so paragraphs never nest.
    BLOCKS = {"p", "h2", "h3", "h4", "ul", "ol", "blockquote", "pre", "hr", "figure"}

    def __init__(self, where):
        super().__init__(convert_charrefs=True)
        self.where, self.out, self.stack, self.skip = where, [], [], 0
        self.dropped, self.skip_tag, self.flattened = set(), "", False

    def close_to(self, tag):
        """Closes back to the innermost open `tag`, closing anything opened inside it."""
        while self.stack:
            top = self.stack.pop()
            if top is not None:
                self.out.append("</%s>" % top)
            if top == tag:
                break

    def handle_starttag(self, tag, attrs):
        if tag in self.DROP_WITH_CONTENT:
            if not self.skip:
                self.dropped.add(tag)
                self.skip_tag = tag
            self.skip += 1
            return
        if self.skip:
            return
        if tag in self.DROP_VOID:
            self.dropped.add(tag)
            return
        if tag == "table":
            self.flattened = True
        tag = self.RENAME.get(tag, tag)
        if tag not in self.ALLOWED:
            return
        if tag in self.BLOCKS and "p" in self.stack:
            self.close_to("p")
        a = dict(attrs)
        if tag == "a":
            href = text(a.get("href"))
            url = href if re.match(r"^#[\w-]+$", href) else safe_url(href, self.where)
            if not url:
                self.stack.append(None)
                return
            self.out.append('<a href="%s">' % esc(url))
        elif tag == "img":
            img = image(a.get("src"), self.where)
            if img:
                alt = text(a.get("alt"))
                if not alt:
                    warn("%s: image %s has no description (alt text); add one, or screen readers skip it" % (self.where, img[0]))
                self.out.append('<span class="pframe">%s</span>' % img_tag(img, alt))
            return
        else:
            self.out.append("<%s>" % tag)
        if tag not in self.VOID:
            self.stack.append(tag)

    def handle_endtag(self, tag):
        if tag in self.DROP_WITH_CONTENT:
            self.skip = max(0, self.skip - 1)
            return
        if self.skip:
            return
        # A flattened table keeps its cells apart: a space after each cell, a line break per row.
        if tag in ("td", "th"):
            self.out.append(" ")
        elif tag == "tr":
            self.out.append("<br>")
        tag = self.RENAME.get(tag, tag)
        if tag not in self.ALLOWED or tag in self.VOID:
            return
        # Close back to the matching open tag, so stray or unbalanced markup cannot break the page.
        if tag in self.stack:
            self.close_to(tag)
        elif tag == "a" and None in self.stack:
            self.stack.remove(None)

    def handle_startendtag(self, tag, attrs):
        # A self-closed <svg/> or <iframe/> has nothing inside it, so it must not hide what follows.
        if tag in self.DROP_WITH_CONTENT:
            if not self.skip:
                self.dropped.add(tag)
            return
        self.handle_starttag(tag, attrs)

    def handle_data(self, data):
        if not self.skip:
            self.out.append(esc(data))

    def result(self):
        while self.stack:
            top = self.stack.pop()
            if top is not None:
                self.out.append("</%s>" % top)
        for tag in sorted(self.dropped):
            warn("%s: <%s> was removed (posts cannot hold embeds, scripts, styles or forms)" % (self.where, tag))
        if self.flattened:
            warn("%s: a <table> was flattened to text; rewrite it as paragraphs or a list" % self.where)
        if self.skip:
            warn("%s: everything after an unclosed <%s> was removed; close that tag or delete it" % (self.where, self.skip_tag))
        # Paragraphs left empty by pasted <div>s or blank lines.
        return re.sub(r"<p>(?:\s|<br>)*</p>", "", "".join(self.out))


def clean_html(body, where):
    c = Clean(where)
    c.feed(text(body))
    c.close()
    return c.result()


def load_posts():
    posts = []
    if not os.path.isdir(POSTS):
        return posts
    for name in sorted(os.listdir(POSTS)):
        if not name.endswith(".json"):
            continue
        where = "content/posts/" + name
        try:
            data = json.loads(read(os.path.join(POSTS, name)))
        except ValueError as e:
            sys.exit("Build stopped: %s is not valid JSON (%s)" % (where, e))
        if not isinstance(data, dict):
            sys.exit("Build stopped: %s must hold one post (a JSON object)" % where)
        slug = name[:-5]
        if not SLUG.match(slug):
            warn("%s: rename the file to lowercase letters, numbers and dashes; skipped" % where)
            continue
        if data.get("published") is not True:
            continue
        title, date = text(data.get("title")), text(data.get("date"))[:10]
        if not title:
            warn("%s: needs a title; skipped" % where)
            continue
        if not re.match(r"^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$", date):
            warn("%s: needs a date like 2026-10-09; skipped" % where)
            continue
        try:
            datetime.date.fromisoformat(date)
        except ValueError:
            warn("%s: %s is not a real date; skipped" % (where, date))
            continue
        body = clean_html(data.get("body"), where)
        words = len(re.sub(r"<[^>]+>", " ", body).split())
        cover, cover_alt = image(data.get("cover"), where), text(data.get("cover_alt"))
        if cover and not cover_alt:
            warn("%s: add a cover description (alt text)" % where)
        posts.append({
            "slug": slug, "where": where, "title": title, "date": date,
            "summary": text(data.get("summary")), "cover": cover, "cover_alt": cover_alt,
            "tags": [text(t) for t in (data.get("tags") or []) if text(t)],
            "body": body, "minutes": max(1, (words + 199) // 200),
        })
    posts.sort(key=lambda q: (q["date"], q["title"].lower()), reverse=True)
    return posts


def post_meta(q):
    # DRAFT COPY for Rehan's approval ("min read")
    parts = ['<time datetime="%s">%s</time>' % (q["date"], nice_date(q["date"])), "%d min read" % q["minutes"]]
    if q["tags"]:
        parts.append(", ".join(esc(t) for t in q["tags"]))
    return " · ".join(parts)


def post_row(q, level="h2"):
    thumb = ""
    if q["cover"]:
        thumb = '<div class="post-thumb pframe">%s</div>' % img_tag(q["cover"], "")
    return "\n".join(x for x in [
        '        <li class="post-row">',
        '          <div class="post-text">',
        '            <p class="post-meta">%s</p>' % post_meta(q),
        '            <%s class="post-title"><a class="pcard-link" href="/blog/%s/">%s</a></%s>' % (level, q["slug"], esc(q["title"]), level),
        ('            <p class="post-summary">%s</p>' % esc(q["summary"])) if q["summary"] else "",
        '          </div>',
        ('          %s' % thumb) if thumb else "",
        '        </li>',
    ] if x)


def blog_page(shell, version, posts):
    count = len(posts)
    if posts:
        listing = '      <ol class="post-list">\n%s\n      </ol>' % "\n".join(post_row(q) for q in posts)
    else:
        # DRAFT COPY for Rehan's approval
        listing = "\n".join([
            '      <div class="empty-state">',
            '        <p class="empty-note">No posts yet. Until the first one lands, I share what I’m learning on LinkedIn.</p>',
            '        <p class="about-actions"><a class="btn btn-ghost" href="https://www.linkedin.com/in/moinul-rehan/" target="_blank" rel="noopener">Follow on LinkedIn%s<span class="vh"> (opens in a new tab)</span></a></p>' % ARROW_OUT,
            '      </div>',
        ])
    main = "\n".join([
        '  <section class="section" data-spy="Blog" data-nav="blog" aria-labelledby="blog-title">',
        '    <div class="wrap">',
        '      <div class="frame-head">',
        '        <p class="frame-label" aria-hidden="true">%sBlog</p>' % FRAME,
        '        <p class="frame-meta">%d %s</p>' % (count, "post" if count == 1 else "posts"),
        '      </div>',
        '      <!-- DRAFT COPY for Rehan\'s approval -->',
        '      <h1 class="section-h2" id="blog-title">Blog</h1>',
        '      <p class="ch-desc blog-intro">What I’m learning about product design, design systems and designing with AI.</p>',
        '      <!-- /DRAFT COPY -->',
        listing,
        '    </div>',
        '  </section>',
    ])
    # DRAFT COPY for Rehan's approval
    meta = meta_tags("Blog · Moinul Islam Rehan",
                     "Moinul Islam Rehan on product design, design systems and designing with AI.", "/blog/")
    if not posts:
        meta += '\n<meta name="robots" content="noindex">'
    return page(shell, version, "Blog · Moinul Islam Rehan", meta, main, toc=toc_page(), here="blog")


def post_page(shell, version, q, others):
    out = [
        '  <article class="post" aria-labelledby="post-title">',
        '    <header class="section project-hero" data-spy="%s" data-nav="blog">' % esc(q["title"]),
        '      <div class="wrap">',
        '        <div class="frame-head">',
        '          <nav class="crumbs" aria-label="Breadcrumb"><a href="/blog/">%sBlog</a><span aria-hidden="true">/</span><span aria-current="page">%s</span></nav>' % (FRAME, esc(q["title"])),
        '        </div>',
        '        <p class="post-meta">%s</p>' % post_meta(q),
        '        <h1 class="ch-h2 post-h1" id="post-title">%s</h1>' % esc(q["title"]),
        ('        <p class="ch-desc">%s</p>' % esc(q["summary"])) if q["summary"] else "",
        ('        <figure class="pfig"><div class="pframe">%s</div></figure>' % img_tag(q["cover"], q["cover_alt"], priority=True)) if q["cover"] else "",
        '      </div>',
        '    </header>',
        '    <div class="wrap"><div class="prose">%s</div></div>' % q["body"],
        '  </article>',
    ]
    if others:
        out += [
            '  <nav class="section next-project" aria-labelledby="more-title" data-spy="%s" data-nav="blog">' % esc(q["title"]),
            '    <div class="wrap">',
            '      <div class="frame-head">',
            '        <!-- DRAFT COPY for Rehan\'s approval -->',
            '        <h2 class="frame-label" id="more-title">%sMore posts</h2>' % FRAME,
            '        <a class="ext-link work-head-link" href="/blog/">All posts%s</a>' % ARROW,
            '        <!-- /DRAFT COPY -->',
            '      </div>',
            '      <ol class="post-list">',
            "\n".join(post_row(o, "h3") for o in others),
            '      </ol>',
            '    </div>',
            '  </nav>',
        ]
    title = "%s · Moinul Islam Rehan" % q["title"]
    meta = meta_tags(title, q["summary"] or q["title"], "/blog/%s/" % q["slug"], q["cover"][0] if q["cover"] else None, "article")
    return page(shell, version, title, meta, "\n".join(x for x in out if x), toc=toc_page(), here="blog")


def not_found_page(shell, version):
    # DRAFT COPY for Rehan's approval
    main = "\n".join([
        '  <section class="section" data-spy="404" aria-labelledby="nf-title">',
        '    <div class="wrap">',
        '      <div class="frame-head" aria-hidden="true"><p class="frame-label">%s404</p></div>' % FRAME,
        '      <h1 class="section-h2" id="nf-title">This frame is not on the canvas.</h1>',
        '      <p class="ch-desc">The page may have moved. The home page and the full list of projects are a click away.</p>',
        '      <div class="cover-actions"><a class="btn btn-primary" href="/">Home</a><a class="btn btn-ghost" href="/projects/">All projects</a></div>',
        '    </div>',
        '  </section>',
    ])
    meta = '<meta name="robots" content="noindex">'
    return page(shell, version, "Page not found · Moinul Islam Rehan", meta, main, toc=toc_page(), here="")


# ---------------------------------------------------------------- build

def write(rel, content):
    path = os.path.join(DIST, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def build():
    del warnings[:]
    projects = load_projects()
    posts = load_posts()
    SITE["blog"] = bool(posts)
    if os.path.isdir(DIST):
        shutil.rmtree(DIST)
    os.makedirs(DIST)
    shutil.copytree(os.path.join(SRC, "assets"), os.path.join(DIST, "assets"))
    shutil.copytree(PUBLIC, DIST, dirs_exist_ok=True)
    digest = hashlib.sha1()
    for name in ("site.css", "site.js"):
        digest.update(read(os.path.join(SRC, "assets", name)).encode("utf-8"))
    version = digest.hexdigest()[:8]
    shell = read(os.path.join(SRC, "templates", "base.html"))

    write("index.html", home_page(shell, version, projects))
    write(os.path.join("projects", "index.html"), projects_page(shell, version, projects))
    for i, p in enumerate(projects):
        nxt = projects[(i + 1) % len(projects)] if len(projects) > 1 else None
        write(os.path.join("projects", p["slug"], "index.html"), project_page(shell, version, p, nxt))
    about = load_about()
    if about:
        write(os.path.join("about", "index.html"), about_page(shell, version, about))
    else:
        warn("content/about.json is missing, so there is no About page")
    write(os.path.join("contact", "index.html"), contact_page(shell, version))
    write(os.path.join("blog", "index.html"), blog_page(shell, version, posts))
    for i, q in enumerate(posts):
        write(os.path.join("blog", q["slug"], "index.html"), post_page(shell, version, q, (posts[:i] + posts[i + 1:])[:3]))
    write("404.html", not_found_page(shell, version))

    print("Built %d project page%s and %d blog post%s into dist/ (featured: %s)" % (
        len(projects), "" if len(projects) == 1 else "s", len(posts), "" if len(posts) == 1 else "s",
        ", ".join(p["title"] for p in featured_of(projects)) or "none"))
    for w in warnings:
        print("  note: " + w)


def serve(port):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=DIST)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    print("Preview: http://127.0.0.1:%d/  (Ctrl+C to stop; run the build again after editing content)" % port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build the portfolio into dist/.")
    parser.add_argument("--serve", action="store_true", help="preview the built site after building")
    parser.add_argument("--port", type=int, default=5500)
    args = parser.parse_args()
    build()
    if args.serve:
        serve(args.port)
