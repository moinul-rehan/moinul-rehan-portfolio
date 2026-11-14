(function(){
  "use strict";
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- headline wave ----------
     Splits a heading into words (kept unbreakable) and then letters, each with
     a staggered delay. Walks the DOM so inner <span class="accent"> wrappers
     survive. The hero fires on load; section titles fire as you reach them. */
  function buildWave(el, step){
    var chIndex = 0;
    function wrapWord(word){
      var w = document.createElement('span');
      w.className = 'w';                            // keeps the word unbreakable
      for (var c = 0; c < word.length; c++) {
        var ch = document.createElement('span');
        ch.className = 'ch';
        ch.textContent = word.charAt(c);
        ch.style.animationDelay = (chIndex * step) + 'ms';
        chIndex++;
        w.appendChild(ch);
      }
      return w;
    }
    (function splitWords(node){
      var kids = Array.prototype.slice.call(node.childNodes);
      for (var k = 0; k < kids.length; k++) {
        var n = kids[k];
        if (n.nodeType === 3) {                     // text node
          var frag = document.createDocumentFragment();
          var parts = n.nodeValue.split(/(\s+)/);
          for (var p = 0; p < parts.length; p++) {
            var piece = parts[p];
            if (!piece) continue;
            if (/^\s+$/.test(piece)) { frag.appendChild(document.createTextNode(' ')); continue; }
            frag.appendChild(wrapWord(piece));
          }
          node.replaceChild(frag, n);
        } else if (n.nodeType === 1) {              // keep .accent wrapper
          splitWords(n);
        }
      }
    })(el);
    el.classList.add('wave', 'split');
  }

  if (!reduce) {
    var heroH1 = document.getElementById('heroH1');
    if (heroH1) {
      buildWave(heroH1, 25);
      // two frames so the start state is committed before the animation
      requestAnimationFrame(function(){
        requestAnimationFrame(function(){ heroH1.classList.add('in'); });
      });
    }

    // Section titles wave as each is scrolled to. Scoped to <main> so the
    // modal's own <h2 class="h-lg"> is left alone — JS rewrites its text.
    // (h1 too: on Process, Services and Clients the section title is the page's h1)
    var heads = document.querySelectorAll('main h2.h-lg, main h1.h-lg');
    for (var hi = 0; hi < heads.length; hi++) buildWave(heads[hi], 20);
    if (heads.length) {
      if ('IntersectionObserver' in window) {
        var hio = new IntersectionObserver(function(entries){
          entries.forEach(function(en){
            if (!en.isIntersecting) return;
            en.target.classList.add('in');
            hio.unobserve(en.target);            // play once
          });
        }, { rootMargin: '0px 0px -15% 0px', threshold: 0.25 });
        for (var hj = 0; hj < heads.length; hj++) hio.observe(heads[hj]);
      } else {
        for (var hk = 0; hk < heads.length; hk++) heads[hk].classList.add('in');
      }
    }
  }

  /* ---------- hero column grid ---------- */
  var grid = document.getElementById('heroGrid');
  if (grid) {
    var cols = 12, html = '';
    for (var i = 0; i <= cols; i++) {
      html += '<i style="left:calc(' + (i / cols * 100) + '% )"></i>';
    }
    grid.innerHTML = html;
    // keep lines inside the content box
    var lines = grid.querySelectorAll('i');
    function placeLines(){
      var pad = parseFloat(getComputedStyle(grid).paddingLeft) || 0;
      var inner = grid.clientWidth - pad * 2;
      for (var j = 0; j < lines.length; j++) {
        lines[j].style.left = (pad + inner * (j / cols)) + 'px';
      }
    }
    placeLines();
    window.addEventListener('resize', placeLines, { passive:true });
  }

  /* ---------- portrait: cursor-following radial reveal ---------- */
  var portrait = document.getElementById('portrait');
  if (portrait) {
    var raf = null, px = 0, py = 0;
    function apply(){
      raf = null;
      portrait.style.setProperty('--mx', px + 'px');
      portrait.style.setProperty('--my', py + 'px');
    }
    function track(e){
      var r = portrait.getBoundingClientRect();
      px = e.clientX - r.left;
      py = e.clientY - r.top;
      if (raf === null) raf = requestAnimationFrame(apply);
    }
    portrait.addEventListener('pointerenter', function(e){
      track(e);
      portrait.classList.add('is-live');
    });
    portrait.addEventListener('pointermove', track, { passive:true });
    portrait.addEventListener('pointerleave', function(){
      portrait.classList.remove('is-live');
    });
    // touch: reveal follows the finger while dragging
    portrait.addEventListener('pointerdown', function(e){
      if (e.pointerType !== 'mouse') { track(e); portrait.classList.add('is-live'); }
    });
    portrait.addEventListener('pointerup', function(e){
      if (e.pointerType !== 'mouse') portrait.classList.remove('is-live');
    });
  }

  /* ---------- custom cursor ---------- */
  var cur = document.getElementById('cursor');
  var fine = window.matchMedia('(hover:hover) and (pointer:fine)').matches;
  if (cur && fine) {
    document.documentElement.classList.add('cur');
    var arrowEl = cur.querySelector('.cursor__arrow');
    var ringEl  = cur.querySelector('.cursor__ring');
    var canvas  = document.getElementById('trail');
    var ctx     = canvas.getContext('2d');
    var ACCENT  = (getComputedStyle(document.documentElement)
                    .getPropertyValue('--accent') || '#C2410C').trim();

    var mx = window.innerWidth / 2, my = window.innerHeight / 2;
    var lastX = mx, lastY = my;               // previous pointer, for fling direction
    var rx = mx, ry = my;                     // ring trails gently
    var bits = [];                            // elastic pixel debris
    var dpr = 1;

    function resize(){
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width  = Math.floor(window.innerWidth  * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize, { passive: true });

    // Each pixel is spring-mounted to the spot it was born on: it gets flung
    // off the cursor, then rubber-bands back, overshooting before it settles.
    // That wobble is the elasticity — the cursor itself stays rigid.
    // Snapped to a 4px grid so it reads as pixels rather than dust.
    function shed(x, y, dx, dy){
      if (reduce) return;
      for (var i = 0; i < 2; i++) {
        var hx = Math.round((x + (Math.random() * 18 - 9)) / 4) * 4;
        var hy = Math.round((y + (Math.random() * 18 - 9)) / 4) * 4;
        bits.push({
          hx: hx, hy: hy,                               // anchor it springs back to
          x: x, y: y,                                   // born on the cursor
          vx: dx * 0.22 + (Math.random() - 0.5) * 3.4,  // flung along travel
          vy: dy * 0.22 + (Math.random() - 0.5) * 3.4,
          s: Math.random() < 0.28 ? 4 : 3,
          sc: 0, sv: 0,                                 // elastic pop-in scale
          life: 1,
          decay: 0.022 + Math.random() * 0.018          // ~420-750ms to vanish
        });
      }
      if (bits.length > 130) bits.splice(0, bits.length - 130);
    }

    document.addEventListener('pointermove', function(e){
      mx = e.clientX; my = e.clientY;
      // no debris over the portrait — the reveal lens owns that area
      var inMedia = e.target && e.target.closest && e.target.closest('.portrait');
      if (!inMedia) shed(mx, my, mx - lastX, my - lastY);
      lastX = mx; lastY = my;
      if (cur.classList.contains('is-out')) cur.classList.remove('is-out');
    }, { passive: true });

    (function frame(){
      // the cursor itself is rigid — tip sits exactly on the pointer
      arrowEl.style.transform =
        'translate3d(' + mx + 'px,' + my + 'px,0) translate(-1px,-1px)';

      if (reduce) { rx = mx; ry = my; }
      else { rx += (mx - rx) * 0.18; ry += (my - ry) * 0.18; }
      ringEl.style.transform =
        'translate3d(' + rx + 'px,' + ry + 'px,0) translate(-50%,-50%)';

      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      ctx.fillStyle = ACCENT;
      for (var i = bits.length - 1; i >= 0; i--) {
        var b = bits[i];

        // rubber-band back to the anchor; low damping leaves a visible wobble
        b.vx = (b.vx + (b.hx - b.x) * 0.26) * 0.78;
        b.vy = (b.vy + (b.hy - b.y) * 0.26) * 0.78;
        b.x += b.vx; b.y += b.vy;

        // elastic pop-in: scale springs past 1, then settles
        b.sv = (b.sv + (1 - b.sc) * 0.34) * 0.66;
        b.sc += b.sv;

        b.life -= b.decay;
        if (b.life <= 0) { bits.splice(i, 1); continue; }

        var sz = b.s * b.sc;
        if (sz > 0.2) {
          ctx.globalAlpha = b.life * b.life;   // ease the fade out
          ctx.fillRect(b.x - sz / 2, b.y - sz / 2, sz, sz);
        }
      }
      ctx.globalAlpha = 1;

      requestAnimationFrame(frame);
    })();

    // react to what is under the pointer
    document.addEventListener('pointerover', function(e){
      var t = e.target;
      if (!t || !t.closest) return;
      var media = t.closest('.portrait');
      var link  = t.closest('a,button');
      cur.classList.toggle('is-media', !!media);
      cur.classList.toggle('is-link', !!link && !media);
    });

    // Hide it when the pointer leaves the window entirely — and a bare
    // mouseleave is not proof of that. Opening a modal <dialog> promotes it to
    // the top layer, and the browser then reports a document-level leave with a
    // null relatedTarget while the pointer is still well inside the viewport.
    // Acting on that strands the cursor at opacity 0 with the native one
    // already suppressed, which leaves no pointer at all. Only a position on
    // the edge is a real exit.
    var EDGE = 2;
    document.addEventListener('mouseleave', function(e){
      if (e.clientX > EDGE && e.clientY > EDGE &&
          e.clientX < window.innerWidth  - EDGE &&
          e.clientY < window.innerHeight - EDGE) return;
      cur.classList.add('is-out');
    });
    document.addEventListener('mouseenter', function(){ cur.classList.remove('is-out'); });
  }

  /* ---------- services flowchart trace ----------
     One continuous orthogonal route with rounded elbows, drawn from the real
     card rectangles so it survives any width or copy-length change:
       01 ──▶ 02      down, left, down      03 ──▶ 04                       */
  var flowEl = document.querySelector('.flow');
  var wiresEl = document.getElementById('flowWires');
  if (flowEl && wiresEl) {
    var SVGNS = 'http://www.w3.org/2000/svg';
    var ELBOW = 28;                                   // corner radius

    function node(name, attrs){
      var el = document.createElementNS(SVGNS, name);
      for (var k in attrs) el.setAttribute(k, attrs[k]);
      return el;
    }
    function boxOf(el, origin){
      var b = el.getBoundingClientRect();
      return {
        l: b.left - origin.left, r: b.right - origin.left,
        t: b.top - origin.top,   b: b.bottom - origin.top,
        cx: (b.left + b.right) / 2 - origin.left,
        cy: (b.top + b.bottom) / 2 - origin.top
      };
    }
    function arrowRight(x, y){ return 'M' + x + ' ' + y + 'L' + (x - 9) + ' ' + (y - 5) + 'L' + (x - 9) + ' ' + (y + 5) + 'Z'; }
    function arrowDown(x, y){ return 'M' + x + ' ' + y + 'L' + (x - 5) + ' ' + (y - 9) + 'L' + (x + 5) + ' ' + (y - 9) + 'Z'; }

    function drawTrace(){
      var cards = flowEl.querySelectorAll('.svc');
      wiresEl.innerHTML = '';
      if (cards.length < 4) return;

      var o = flowEl.getBoundingClientRect();
      wiresEl.setAttribute('viewBox', '0 0 ' + Math.round(o.width) + ' ' + Math.round(o.height));

      var a = boxOf(cards[0], o), b = boxOf(cards[1], o),
          c = boxOf(cards[2], o), e = boxOf(cards[3], o);

      // stacked (one column) — no trace to draw
      if (b.t >= a.b) return;

      var mid = (b.b + c.t) / 2;
      var d =
        // 01 ▸ 02
        'M' + a.r + ' ' + a.cy + 'H' + b.l +
        // 02 ▾ then ◂ then ▾ into 03
        'M' + b.cx + ' ' + b.b +
        'V' + (mid - ELBOW) +
        'Q' + b.cx + ' ' + mid + ' ' + (b.cx - ELBOW) + ' ' + mid +
        'H' + (c.cx + ELBOW) +
        'Q' + c.cx + ' ' + mid + ' ' + c.cx + ' ' + (mid + ELBOW) +
        'V' + c.t +
        // 03 ▸ 04
        'M' + c.r + ' ' + c.cy + 'H' + e.l;

      wiresEl.appendChild(node('path', { 'class': 'trace', d: d }));
      wiresEl.appendChild(node('path', { 'class': 'head', d: arrowRight(b.l, b.cy) }));
      wiresEl.appendChild(node('path', { 'class': 'head', d: arrowDown(c.cx, c.t) }));
      wiresEl.appendChild(node('path', { 'class': 'head', d: arrowRight(e.l, e.cy) }));
      wiresEl.appendChild(node('circle', { 'class': 'pin', cx: a.r, cy: a.cy, r: 3.5 }));
      wiresEl.appendChild(node('circle', { 'class': 'pin', cx: b.cx, cy: b.b, r: 3.5 }));
      wiresEl.appendChild(node('circle', { 'class': 'pin', cx: c.r, cy: c.cy, r: 3.5 }));
    }

    var traceQueued = false;
    function queueTrace(){
      if (traceQueued) return;
      traceQueued = true;
      requestAnimationFrame(function(){ traceQueued = false; drawTrace(); });
    }
    queueTrace();
    window.addEventListener('load', queueTrace);
    window.addEventListener('resize', queueTrace, { passive: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(queueTrace);
  }

  /* ---------- card video: load and play only while on screen ----------
     preload="none" plus a lazy src means the clip costs nothing until the
     card is actually scrolled into view, then it loops silently. */
  var cardVideos = document.querySelectorAll('.case__video');
  if (cardVideos.length && !reduce) {
    var VID_SRC = '/media/canipark.mp4';

    function inView(el){
      var r = el.getBoundingClientRect();
      var h = window.innerHeight || document.documentElement.clientHeight;
      return r.bottom > h * 0.15 && r.top < h * 0.85;
    }
    function syncVideo(v){
      if (inView(v)) {
        if (!v.getAttribute('src')) v.setAttribute('src', VID_SRC);
        if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(function(){}); }
      } else if (!v.paused) {
        v.pause();
      }
    }
    function syncAll(){
      for (var vi = 0; vi < cardVideos.length; vi++) syncVideo(cardVideos[vi]);
    }

    // IntersectionObserver is the efficient path; the scroll/resize listener is
    // a cheap fallback so playback never depends on IO alone.
    if ('IntersectionObserver' in window) {
      var vio = new IntersectionObserver(function(entries){
        entries.forEach(function(en){ syncVideo(en.target); });
      }, { threshold: 0.25 });
      for (var vj = 0; vj < cardVideos.length; vj++) vio.observe(cardVideos[vj]);
    }
    var vTick = false;
    function onVScroll(){
      if (vTick) return;
      vTick = true;
      requestAnimationFrame(function(){ vTick = false; syncAll(); });
    }
    window.addEventListener('scroll', onVScroll, { passive: true });
    window.addEventListener('resize', onVScroll, { passive: true });
    syncAll();
  }

  /* ---------- project modal ---------- */
  var PROJECTS = {
    velacrew: {
      num: '[01]', tag: 'AI product', title: 'VelaCrew',
      lede: 'VelaCrew is the operating system your business runs on. You talk to your crew, they do the work, and everything the business needs to keep track of lives in one place.',
      specs: [['Role','UI/UX design'],['Company','Tulip Tech'],['Platform','Web, desktop and mobile'],['Year','2026, in progress']],
      problem: 'VelaCrew gives people AI assistants that work across their apps, remember context and act on their behalf. The build it started from used three different shells with the same content on every screen, and put setup screens and technical detail in front of people who just wanted the work done. The brief: simple for a non-technical, zero-knowledge user. When they land, they should see what they want and know where to go.',
      did: [
        'Set one rule for the whole product: things you do every day stay in the main interface, things you set up once move to Setup.',
        'Rebuilt the navigation as one shell, two levels deep everywhere, with your own space and your teams as peers in one switcher.',
        'Designed the assistant to show its plan before it acts, wait for your OK, and keep Undo next to every result.',
        'Designed own space and team space end to end: Home, Projects, CRM, Messages, Routines, Channels and Agent Properties.',
        'Built the VelaCrew icon documentation and component set the team designs from.'
      ],
      media: [
        ['/images/web/velacrew-hero.jpg','Public website, hero'],
        ['/images/web/velacrew-app.jpg','Projects, with progress and what is up next'],
        ['/images/web/velacrew-crew.jpg','The crew your assistant brings in'],
        ['/images/web/velacrew-project.jpg','A project and its milestones'],
        ['/images/web/velacrew-people.jpg','People, and what their crew is on']
      ],
      video: []
    },
    canipark: {
      num: '[01]', tag: 'Mobile app', title: 'Can I Park?',
      lede: 'An AI sign-scanning feature added to Green P, Toronto’s official parking app. An assistant, not an authority — it reads the pole so the driver doesn’t have to.',
      specs: [['Role','Product & UX design'],['Timeline','2026'],['Deliverable','New AI feature module'],['Platform','iOS & Android']],
      problem: 'Green P is a mature, well-used product — 4.54 out of 5 on the App Store, 55,000 parking spaces covered across Toronto, one in three parkers already paying through it. That scale is exactly why one missing piece of information still costs real drivers real tickets: none of that adoption tells you whether the spot in front of you is legal to park in right now. Paying takes two taps. Knowing you are allowed to be there is still left to the driver.',
      did: [
        'Reframed the job as four rules to one sentence. A pole carrying No Parking, Paid Parking, Snow Route and a permit exception becomes "Yes. Until 6:00 PM." with 2h 52m remaining.',
        'Reduced it to one flow: scan the sign, a 1–2 second analysis, a clear answer. No rules to combine, no arrows to check.',
        'Designed five result states rather than a yes/no — free to park, paid parking required, do not park, snow route (seasonal), and sign not recognised.',
        'Made the failure state the useful one. When the AI cannot read a sign it hands over a Toronto sign dictionary and manual verification tips instead of dead-ending.',
        'Put the time that matters on every card — "2h 52m remaining", "1h 52m until the restriction lifts" — so nobody has to interpret a static sign clock.',
        'Held the "assistant, not authority" line in the UI: a standing disclaimer and a Report Inaccuracy affordance on every state.'
      ],
      media: [
        ['/media/canipark.mp4','Demo film — sign to answer','/media/canipark-poster.jpg'],
        ['/images/web/canipark-ba.jpg','Before / after — four rules to one sentence'],
        ['/images/web/canipark-five.jpg','Five answers the scanner can give'],
        ['/images/web/canipark-ui.jpg','UI showcase — curb to scan to result'],
        ['/images/web/canipark-parts.jpg','The components that carry the trust']
      ],
      video: []
    },
    handynaija: {
      num: '[02]', tag: 'Service booking', title: 'HandyNaija',
      lede: 'A home services booking platform for Nigeria. Vetted providers, reviews that read as real, and a booking flow that never asks the same question twice.',
      specs: [['Type','Service booking platform'],['Platform','Web + mobile web'],['Focus','Trust signals, booking flow'],['Year','2025']],
      problem: 'Home services in Nigeria run on word of mouth, and the platforms that exist are full of listings nobody can verify. People were abandoning the booking flow at the point where they had to decide whether a stranger was safe to let into their home.',
      did: [
        'Mapped the real booking journey end to end, including the WhatsApp conversations that happen outside the product.',
        'Rebuilt provider cards around verification, not aesthetics — ID checks, job history and review provenance made visible before price.',
        'Cut the booking flow from seven steps to three by carrying context forward instead of re-asking.',
        'Designed the empty, pending and failed states that the original brief never mentioned.'
      ],
      media: [
        ['/images/web/handynaija-1.jpg','Home — service discovery'],
        ['/images/web/handynaija-2.jpg','Provider detail and verification'],
        ['/images/web/handynaija-3.jpg','Booking confirmation']
      ],
      video: []
    },
    suede: {
      num: '[03]', tag: 'E-commerce', title: 'SUEDE',
      lede: 'A fashion review platform that matches real body measurements to real reviews — so shoppers stop guessing their size and start trusting the fit.',
      specs: [['Type','Review platform'],['Platform','Responsive web'],['Focus','Fit confidence, reviews'],['Year','In progress']],
      problem: 'Returns in online fashion are overwhelmingly a sizing problem. Star ratings tell you a garment is nice; they do not tell you whether it will fit a body shaped like yours. The existing review UI buried the one thing that actually predicts fit.',
      did: [
        'Restructured reviews around reviewer measurements so shoppers can filter to bodies like their own.',
        'Designed a fit-confidence signal that aggregates measurement data instead of averaging star ratings.',
        'Built the dashboard brands use to see why a product is being returned, not just how often.',
        'Documented the component set and tokens so the team could extend it without me.'
      ],
      media: [
        ['/images/web/suede-1.jpg','Brand dashboard — review analytics'],
        ['/images/web/suede-2.jpg','Product detail with fit data'],
        ['/images/web/suede-3.jpg','Review composer']
      ],
      video: []
    },
    terrava: {
      num: '[04]', tag: 'Fitness app', title: 'TERRAVA',
      lede: 'A running app where finishing a route claims ground. Every run expands your territory, builds a heatmap and feeds a streak — progress you can see on a map instead of reading off a number.',
      specs: [['Type','Running app'],['Platform','iOS'],['Focus','Territory, heatmaps, streaks'],['Year','2026']],
      problem: 'A tracker records distance and pace and hands back a number, and that number is identical whether you ran somewhere new or the same loop for the hundredth time. Nothing in it rewards exploring, and nothing in it is worth showing anyone. The brief was a running product that drives exploration, habit formation and sharing — none of which a pace figure does on its own.',
      did: [
        'Made the map the scoreboard: a completed run claims the ground it covered, so the reward is visible territory rather than a figure in a list.',
        'Built personal heatmaps that thicken with repetition, so a runner reads their own habits as terrain.',
        'Designed achievements and streaks around consistency rather than personal bests, so an ordinary run still counts for something.',
        'Split the home screen into Territory and Heatmap as two views of one dataset, so neither has to compromise for the other.',
        'Made cinematic replay the share artefact — something a runner will actually post, instead of a screenshot of statistics.'
      ],
      media: [
        ['/images/web/terrava-1.jpg','Cover — every run expands your territory'],
        ['/images/web/terrava-2.jpg','Overview — what the product does']
      ],
      video: []
    },
    prottoyon: {
      num: '[05]', tag: 'Govt. service', title: 'Prottoyon',
      lede: 'A redesign of the Bangladeshi government app for birth, death and nationality certificates — rebuilt around the people who find it hardest to use, not the ones who already manage.',
      specs: [['Type','Government service app'],['Platform','iOS + Android'],['Focus','Navigation, accessibility'],['Year','2025']],
      problem: 'Prottoyon is where Bangladeshi residents apply for birth certificates, death certificates and nationality documents — services nobody can opt out of. That makes the usual assumption fatal: you cannot design for the confident user and let everyone else cope, because everyone else still has to file the form. Navigation, labelling and accessibility all had to work for someone with limited digital literacy, on their first attempt.',
      did: [
        'Rebuilt the navigation around the documents people come for, rather than the departments that issue them.',
        'Rewrote labels and form copy in plain language, so the app stops assuming familiarity with government terminology.',
        'Cut each application into a short sequence of steps with its status visible throughout, so nobody is left wondering whether a submission went through.',
        'Raised contrast, type size and target sizes across the interface for people who are not comfortable on a phone.'
      ],
      media: [
        ['/images/web/prottoyon-1.jpg','Prottoyon — every certificate service in one place']
      ],
      video: []
    },
    qatargold: {
      num: '[06]', tag: 'Marketplace', title: 'Qatar Gold Souq',
      lede: 'A marketplace for buying and selling physical gold in Qatar where the money never moves through the app. Licensed shops are the inspection point, so trust rests on a physical meeting instead of an escrow balance.',
      specs: [['Type','Gold marketplace app'],['Platform','iOS + Android'],['Focus','Verification, offline settlement'],['Year','2026']],
      problem: 'Gold trade in Qatar runs on a physical check: you look at the piece, you weigh it, you hand over cash. A marketplace that replaces that with an escrow balance is asking people to give up the one safeguard they actually rely on, so the brief kept it — physical inspection at a licensed shop, settlement offline, in cash. That leaves a harder question than it first appears: if no money moves through the product, what is the product actually holding together, and how does it earn anything?',
      did: [
        'Mapped all four roles — buyer, seller, licensed shop and admin — onto a single flow across three surfaces, so the handoffs between them were visible before any screen got drawn.',
        'Made the inspection the spine of the product: request, centre selection, appointment, measurement check, and an explicit fail path for when the gold does not match the listing.',
        'Gave the shop a dashboard that treats commission as something owed and visible — an unpaid invoice with a due date — because settlement happens offline and revenue leaks the moment it stops being in front of someone.',
        'Separated peer listings from shop storefronts in the UI, so a buyer is never asked to pay an inspection fee on an item the shop already owns and is selling directly.',
        'Audited the client PRD against the flows and sent the gaps back: no failure branch for a failed inspection, no definition of what a shop earns for doing the verification, and a commission model that assumes payments the product does not process.',
        'Flagged the concurrency problem — two buyers booking the same unique piece — and specified a Pending Inspection state that locks the listing once an appointment is confirmed.'
      ],
      media: [
        ['/images/web/qatargold-1.jpg','Live pricing, inspection request, and the shop’s verification check'],
        ['/images/web/qatargold-4.jpg','Full app flow — four roles across three surfaces'],
        ['/images/web/qatargold-2.jpg','Buyer journey — search, listing detail, want-to-buy, settlement'],
        ['/images/web/qatargold-3.jpg','Shop side — dashboard, catalog, inspection queue, analytics']
      ],
      video: []
    }
  };

  var modal = document.getElementById('projectModal');
  if (modal && typeof modal.showModal === 'function') {
    var pmNum = document.getElementById('pmNum');
    var pmTag = document.getElementById('pmTag');
    var pmTitle = document.getElementById('pmTitle');
    var pmLede = document.getElementById('pmLede');
    var pmSpecs = document.getElementById('pmSpecs');
    var pmProblem = document.getElementById('pmProblem');
    var pmDid = document.getElementById('pmDid');
    var pmMedia = document.getElementById('pmMedia');
    var pmMain = document.getElementById('pmMain');
    var pmMoreH = document.getElementById('pmMoreH');
    var lastFocus = null;
    var isVideo = function(src){ return /\.(mp4|webm|mov)$/i.test(src); };

    // one media node, image or video depending on the file extension
    function mediaNode(src, cap, poster){
      var el;
      if (isVideo(src)) {
        el = document.createElement('video');
        el.src = src; el.controls = true; el.playsInline = true;
        el.preload = 'none';                 // nothing downloads until play
        if (poster) el.poster = poster;
      } else {
        el = document.createElement('img');
        el.src = src; el.alt = cap; el.loading = 'lazy';
      }
      return el;
    }
    function shot(src, cap, poster){
      var fig = document.createElement('figure');
      fig.className = 'pm__shot';
      fig.appendChild(mediaNode(src, cap, poster));
      var c = document.createElement('figcaption');
      c.className = 'pm__cap'; c.textContent = cap;
      fig.appendChild(c);
      return fig;
    }
    function note(text){
      var d = document.createElement('div');
      d.className = 'pm__empty';
      d.textContent = text;
      return d;
    }

    function openProject(key){
      var p = PROJECTS[key];
      if (!p) return;
      pmNum.textContent = p.num;
      pmTag.textContent = p.tag;
      pmTitle.textContent = p.title;
      pmLede.textContent = p.lede;
      pmProblem.textContent = p.problem;

      pmSpecs.innerHTML = '';
      p.specs.forEach(function(s){
        var box = document.createElement('div');
        box.className = 'spec';
        var dt = document.createElement('dt'); dt.textContent = s[0];
        var dd = document.createElement('dd'); dd.textContent = s[1];
        box.appendChild(dt); box.appendChild(dd);
        pmSpecs.appendChild(box);
      });

      pmDid.innerHTML = '';
      p.did.forEach(function(t){
        var li = document.createElement('li');
        li.textContent = t;
        pmDid.appendChild(li);
      });

      // hero goes in the right column; everything else runs below
      var all = p.media.concat(p.video || []);
      pmMain.innerHTML = '';
      if (all.length) {
        pmMain.appendChild(mediaNode(all[0][0], all[0][1], all[0][2]));
      } else {
        pmMain.appendChild(note('No media for this project yet.'));
      }

      var rest = all.slice(1);
      pmMedia.innerHTML = '';
      pmMoreH.style.display = rest.length ? '' : 'none';
      rest.forEach(function(m){ pmMedia.appendChild(shot(m[0], m[1], m[2])); });

      lastFocus = document.activeElement;
      modal.showModal();
      document.documentElement.style.overflow = 'hidden';
      modal.querySelector('.pm__inner').scrollTop = 0;
      // A modal <dialog> lives in the top layer, which is painted above every
      // z-index — so the custom cursor has to move inside it to stay visible.
      // Clearing is-out as well, because opening the dialog is exactly the
      // moment the browser fires a spurious document-level mouseleave.
      if (cur) { modal.appendChild(cur); cur.classList.remove('is-out'); }
    }

    document.addEventListener('click', function(e){
      // the in-progress mockups open their project too
      var btn = e.target.closest && e.target.closest('.btn-view, .build__shot');
      if (btn) { e.preventDefault(); openProject(btn.getAttribute('data-project')); return; }
      // click outside the panel closes it
      if (e.target === modal) modal.close();
    });
    document.getElementById('pmClose').addEventListener('click', function(){ modal.close(); });
    modal.addEventListener('close', function(){
      document.documentElement.style.overflow = '';
      // hand the cursor back to the page, visible — closing fires the same
      // spurious leave that opening does
      if (cur) { document.body.appendChild(cur); cur.classList.remove('is-out'); }
      // stop any playing media
      var vids = modal.querySelectorAll('video');
      for (var i = 0; i < vids.length; i++) { try { vids[i].pause(); } catch (err) {} }
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    });
  }

  /* ---------- ticker ---------- */
  var ticker = document.getElementById('ticker');
  if (ticker) {
    var words = ['Product design','Design systems','User flows','Prototyping','Dev handoff','UX audit','Mobile apps'];
    var unit = '';
    for (var w = 0; w < words.length; w++) unit += '<span>' + words[w] + '</span><i></i>';
    ticker.innerHTML = unit + unit; // duplicated for a seamless -50% loop
  }

  /* ---------- footer wordmark fills the column exactly ----------
     Measure the label at a reference size, then scale the font so it spans
     the available width. Re-run after webfonts land, since Geist changes
     the metrics and a pre-font measurement would be wrong. */
  var mark = document.getElementById('footMark');
  if (mark) {
    var markSpan = mark.querySelector('span');
    var REF = 100, TRACK = 0.04;          // letter-spacing is -0.04em
    var fitQueued = false;

    function fitMark(){
      fitQueued = false;
      var host = mark.parentElement;
      if (!host || !markSpan) return;
      var cs = getComputedStyle(host);
      var avail = host.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      if (!(avail > 0)) return;
      mark.style.fontSize = REF + 'px';
      // drop the trailing letter-space so the last glyph lands on the edge
      var w = markSpan.getBoundingClientRect().width - (TRACK * REF);
      if (!(w > 0)) return;
      mark.style.fontSize = (REF * (avail / w)).toFixed(2) + 'px';
    }
    function queueFit(){
      if (!fitQueued) { fitQueued = true; requestAnimationFrame(fitMark); }
    }

    queueFit();
    window.addEventListener('load', queueFit);
    window.addEventListener('resize', queueFit, { passive: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(queueFit);
  }

  /* ---------- footer: the mark lights under the pointer ----------
     Same idea as the hero portrait, driven from the whole footer rather than
     the glyphs alone, so the light is already travelling by the time the
     cursor reaches the letters. CSS owns the look; this only reports where
     the pointer is, in px relative to the mark's own box. */
  var footEl = document.querySelector('.foot');
  var footMark = document.getElementById('footMark');
  if (footEl && footMark) {
    var markGlyphs = footMark.querySelector('span') || footMark;

    var lampTrack = function (e) {
      var r = markGlyphs.getBoundingClientRect();
      footMark.style.setProperty('--mx', (e.clientX - r.left).toFixed(1) + 'px');
      footMark.style.setProperty('--my', (e.clientY - r.top).toFixed(1) + 'px');
    };

    // footIntro holds the rAF id while the one-time intro sweep is running;
    // during it the sweep owns the light until the visitor actually moves.
    var footHover = false, footIntro = 0, footLast = null;

    footEl.addEventListener('pointerenter', function (e) {
      footHover = true; footLast = e;
      if (footIntro) return;
      lampTrack(e);
      footMark.classList.add('is-live');
    });
    footEl.addEventListener('pointermove', function (e) {
      footHover = true; footLast = e;
      if (footIntro) {
        // Scrolling the footer under a still cursor reports a move with no
        // movement; only a real hand on the mouse takes the light over.
        if (!e.movementX && !e.movementY) return;
        cancelAnimationFrame(footIntro); footIntro = 0;
        footMark.classList.add('is-live');
      }
      lampTrack(e);
    }, { passive: true });
    footEl.addEventListener('pointerleave', function () {
      footHover = false;
      if (!footIntro) footMark.classList.remove('is-live');
    });

    /* One-time intro: the first time the mark is mostly on screen, the light
       sweeps through it once, in from the left on a shallow arc and out to the
       right, then rests. Once per page load; skipped under reduced motion. */
    if (!reduce && 'IntersectionObserver' in window) {
      var footSeen = new IntersectionObserver(function (entries) {
        if (!entries[0].isIntersecting) return;
        footSeen.disconnect();
        var box = markGlyphs.getBoundingClientRect();
        var w = box.width, h = box.height, t0 = null, DUR = 2200;
        footMark.classList.add('is-live');
        var footStep = function (now) {
          if (t0 === null) t0 = now;
          var p = Math.min((now - t0) / DUR, 1);
          var footEase = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
          footMark.style.setProperty('--mx', (w * (-0.15 + 1.3 * footEase)).toFixed(1) + 'px');
          footMark.style.setProperty('--my', (h * (0.75 - 0.5 * Math.sin(Math.PI * footEase))).toFixed(1) + 'px');
          if (p < 1) { footIntro = requestAnimationFrame(footStep); return; }
          footIntro = 0;
          // hand straight to the pointer if it is already resting on the footer
          if (footHover && footLast) lampTrack(footLast);
          else footMark.classList.remove('is-live');
        };
        footIntro = requestAnimationFrame(footStep);
      }, { threshold: 0.6 });
      footSeen.observe(footMark);
    }
    // a tap should light it too, then let go
    footEl.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'mouse') { lampTrack(e); footMark.classList.add('is-live'); }
    });
    footEl.addEventListener('pointerup', function (e) {
      if (e.pointerType !== 'mouse') footMark.classList.remove('is-live');
    });
  }

  /* ---------- footer: live Dhaka time ----------
     The line already claimed UTC+6; this makes it true as you read it. If
     Intl has no tz database the markup's "UTC+6" simply stays put. */
  var footClock = document.getElementById('footClock');
  if (footClock && window.Intl && window.Intl.DateTimeFormat) {
    var clockFmt = null;
    try {
      clockFmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Dhaka',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
      });
      clockFmt.format(new Date());   // some engines only throw on first use
    } catch (err) { clockFmt = null; }

    if (clockFmt) {
      var clockTick = function () { footClock.textContent = clockFmt.format(new Date()); };
      clockTick();
      setInterval(clockTick, 1000);
    }
  }

  /* ---------- 404: the numerals light under the pointer ----------
     The same lens idea as the footer wordmark. With a mouse the light
     follows the pointer anywhere over the section; on touch (or before the
     pointer arrives) it drifts slowly through the numerals on its own.
     It only runs while the numerals are on screen, never under reduced motion. */
  var errMark = document.getElementById('errMark');
  var errSec = errMark && errMark.closest('section');
  if (errMark && errSec && !reduce) {
    var errGlyphs = errMark.querySelector('span') || errMark;
    var errLive = false, errDrift = 0, errT0 = null, errSeen = true;
    var errTrack = function (x, y) {
      var r = errGlyphs.getBoundingClientRect();
      errMark.style.setProperty('--mx', (x - r.left).toFixed(1) + 'px');
      errMark.style.setProperty('--my', (y - r.top).toFixed(1) + 'px');
    };
    var errStep = function (now) {
      if (errT0 === null) errT0 = now;
      var r = errGlyphs.getBoundingClientRect(), t = (now - errT0) / 1000;
      // a slow figure-of-eight through the middle of the numerals
      errTrack(r.left + r.width * (0.5 + 0.42 * Math.sin(t * 0.55)),
               r.top + r.height * (0.5 + 0.3 * Math.sin(t * 1.1)));
      errDrift = requestAnimationFrame(errStep);
    };
    var errDriftOn = function () {
      if (errDrift || errLive || !errSeen) return;
      errMark.classList.add('is-live');
      errDrift = requestAnimationFrame(errStep);
    };
    var errDriftOff = function () {
      if (errDrift) { cancelAnimationFrame(errDrift); errDrift = 0; }
    };
    errSec.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse') return;
      errLive = true; errDriftOff();
      errMark.classList.add('is-live');
      errTrack(e.clientX, e.clientY);
    }, { passive: true });
    errSec.addEventListener('pointerleave', function (e) {
      if (e.pointerType !== 'mouse') return;
      errLive = false; errDriftOn();
    });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        errSeen = entries[0].isIntersecting;
        if (errSeen) errDriftOn(); else errDriftOff();
      }).observe(errMark);
    }
    errDriftOn();
  }

  /* ---------- certifications deck ----------
     One card in front, its neighbours set back on either side. Each step
     only renumbers data-pos (-2..2, relative to the front card); the CSS
     does the moving. The front card slides back to the left, the right one
     comes forward, and the card that leaves on the left loops round behind
     to wait on the right. Auto-advances every 5s, holds while hovered or
     focused, and never moves on its own under reduced motion.
     Names are all cert-prefixed: this file is one function scope, and a
     shared `var` name silently overwrites another block's variable. */
  var certsEl = document.getElementById('certs');
  if (certsEl) {
    var certCards = certsEl.querySelectorAll('.cert');
    var certNow = document.getElementById('certsNow');
    var certIdx = 0, certTimer = null, certHeld = false;

    var certPlace = function (n) {
      var total = certCards.length;
      certIdx = (n + total) % total;
      for (var certI = 0; certI < total; certI++) {
        var certD = (certI - certIdx + total) % total;
        if (certD > total / 2) certD -= total;
        certD = Math.max(-2, Math.min(2, certD));
        certCards[certI].setAttribute('data-pos', String(certD));
        certCards[certI].setAttribute('aria-hidden', certD === 0 ? 'false' : 'true');
      }
      if (certNow) certNow.textContent = (certIdx + 1 < 10 ? '0' : '') + (certIdx + 1);
    };

    var certArm = function () {
      clearInterval(certTimer);
      if (reduce || certCards.length < 2) return;
      certTimer = setInterval(function () {
        if (!certHeld && !document.hidden) certPlace(certIdx + 1);
      }, 5000);
    };

    // Hold while the pointer is on a card itself (not the empty space beside
    // the cards) or while keyboard focus is inside. Focus left behind by a
    // mouse click on an arrow does not count, or one click would pause the
    // deck until the visitor happened to click somewhere else.
    var certHover = false, certKeyFocus = false;
    var certSync = function () { certHeld = certHover || certKeyFocus; };
    certsEl.addEventListener('pointerover', function (e) {
      certHover = !!e.target.closest('.cert'); certSync();
    });
    certsEl.addEventListener('pointerleave', function () { certHover = false; certSync(); });
    certsEl.addEventListener('focusin', function (e) {
      certKeyFocus = e.target.matches(':focus-visible'); certSync();
    });
    certsEl.addEventListener('focusout', function (e) {
      if (!certsEl.contains(e.relatedTarget)) { certKeyFocus = false; certSync(); }
    });

    certsEl.addEventListener('click', function (e) {
      var btn = e.target.closest('.certs__btn');
      if (btn) { certPlace(certIdx + Number(btn.getAttribute('data-step'))); certArm(); return; }
      // a set-back card is a shortcut to itself
      var card = e.target.closest('.cert');
      var pos = card ? Number(card.getAttribute('data-pos')) : 0;
      if (pos === -1 || pos === 1) { certPlace(certIdx + pos); certArm(); }
    });

    certsEl.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft')  { certPlace(certIdx - 1); certArm(); }
      if (e.key === 'ArrowRight') { certPlace(certIdx + 1); certArm(); }
    });

    certPlace(0);
    certArm();
  }

  /* ---------- scroll reveal ---------- */
  var rises = document.querySelectorAll('.rise');
  if (reduce || !('IntersectionObserver' in window)) {
    for (var k = 0; k < rises.length; k++) rises[k].classList.add('is-in');
  } else {
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(en){
        if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -5% 0px', threshold: 0.05 });
    for (var m = 0; m < rises.length; m++) io.observe(rises[m]);
  }

  /* ---------- client feedback ----------
     The accent rule under the active row is a 6s CSS animation, and its
     animationend is what advances the carousel. That means pausing the
     animation on hover pauses the rotation too, with no timer to manage. */
  var testi = document.getElementById('testi');
  if (testi) {
    var picks  = testi.querySelectorAll('.testi__pick');
    var panels = testi.querySelectorAll('.testi__q');

    if (picks.length && picks.length === panels.length) {
      var testiIdx = 0;

      // animationend drives the advance, but an engine that never fires it for
      // a pseudo-element animation would stall the rotation; this guard is the
      // independent fallback, and it still respects hover and manual picks.
      var guard = null;
      var armGuard = function () {
        clearTimeout(guard);
        guard = setTimeout(function tick() {
          if (testi.classList.contains('is-manual')) return;
          if (testi.classList.contains('is-held')) { guard = setTimeout(tick, 1000); return; }
          showTesti(testiIdx + 1);
        }, 6800);
      };

      var showTesti = function (n, manual) {
        var prev = testiIdx;
        testiIdx = (n + picks.length) % picks.length;
        for (var i = 0; i < picks.length; i++) {
          var on = (i === testiIdx);
          picks[i].classList.toggle('is-on', on);
          picks[i].setAttribute('aria-selected', on ? 'true' : 'false');
          picks[i].tabIndex = on ? 0 : -1;
          panels[i].classList.toggle('is-on', on);
          // the panel being left keeps moving up and out; the rest wait below
          panels[i].classList.toggle('is-out', !on && i === prev && prev !== testiIdx);
        }
        // the dot being left plays its own exit (phone CSS: the full fill
        // shrinks back with its track and fades), then the class clears
        if (prev !== testiIdx) {
          var testiLeft = picks[prev];
          testiLeft.classList.add('was-on');
          setTimeout(function () { testiLeft.classList.remove('was-on'); }, 500);
        }
        // a deliberate pick wins: stop rotating so nothing moves under them
        if (manual) testi.classList.add('is-manual');
        armGuard();
      };

      for (var p = 0; p < picks.length; p++) {
        (function (idx) {
          picks[idx].addEventListener('click', function () {
            showTesti(idx, true);
          });
          picks[idx].addEventListener('keydown', function (e) {
            var d = 0;
            if (e.key === 'ArrowDown' || e.key === 'ArrowRight') d = 1;
            else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') d = -1;
            else if (e.key === 'Home') d = 'first';
            else if (e.key === 'End') d = 'last';
            else return;
            e.preventDefault();
            var next = d === 'first' ? 0
                     : d === 'last'  ? picks.length - 1
                     : (idx + d + picks.length) % picks.length;
            showTesti(next, true);
            picks[next].focus();
          });
        })(p);
      }

      // the timer bar reaching full width is the advance signal
      testi.addEventListener('animationend', function (e) {
        if (e.animationName === 'testiBar' && !testi.classList.contains('is-manual')) {
          showTesti(testiIdx + 1);
        }
      });

      // hover or keyboard focus holds the quote in place
      testi.addEventListener('mouseenter', function () { testi.classList.add('is-held'); });
      testi.addEventListener('mouseleave', function () { testi.classList.remove('is-held'); });
      testi.addEventListener('focusin',    function () { testi.classList.add('is-held'); });
      testi.addEventListener('focusout',   function () { testi.classList.remove('is-held'); });

      // only start rotating once the section is actually on screen
      if (reduce) {
        testi.classList.add('is-manual');
      } else if ('IntersectionObserver' in window) {
        var tio = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) {
            if (en.isIntersecting) { testi.classList.add('is-live'); tio.unobserve(en.target); armGuard(); }
          });
        }, { threshold: 0.25 });
        tio.observe(testi);
      } else {
        testi.classList.add('is-live'); armGuard();
      }
    }
  }

  /* ---------- menu: hamburger + full-screen panel ----------
     Plain fixed markup rather than a <dialog>, so the custom cursor still
     draws over it and the header (logo + close button) stays on top. */
  var mbtn = document.getElementById('menuBtn');
  var mpanel = document.getElementById('menuPanel');
  var menuNav = document.querySelector('.nav');
  if (mbtn && mpanel) {
    var mitems = mpanel.querySelectorAll('.mitem');
    var deskQ = window.matchMedia ? window.matchMedia('(min-width:1000px)') : null;

    var menuOpen = function () { return mpanel.classList.contains('is-open'); };
    var setMenu = function (open) {
      mpanel.classList.toggle('is-open', open);
      mbtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      mbtn.setAttribute('aria-label', open ? 'Close menu' : 'Menu');
      // The panel covers the viewport, so the page behind it must not scroll.
      // Locking scroll breaks the header's sticky positioning: scrolled down,
      // it jumped back to the top of the document and took the close button
      // off screen. While open it is pinned with position:fixed instead, and
      // the body gets the same height as padding so nothing behind it shifts.
      if (open && menuNav) document.body.style.paddingTop = menuNav.offsetHeight + 'px';
      document.documentElement.classList.toggle('menu-on', open);
      document.documentElement.style.overflow = open ? 'hidden' : '';
      if (!open) document.body.style.paddingTop = '';
    };
    var closeMenu = function (refocus) {
      if (!menuOpen()) return;
      setMenu(false);
      if (refocus) mbtn.focus();
    };

    // stopPropagation keeps the document handler below from closing it again
    mbtn.addEventListener('click', function (e) {
      e.stopPropagation();
      setMenu(!menuOpen());
    });

    // arrow down from the button drops straight into the list
    mbtn.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' && mitems.length) {
        e.preventDefault();
        setMenu(true);
        mitems[0].focus();
      }
    });

    for (var mi = 0; mi < mitems.length; mi++) {
      (function (idx) {
        mitems[idx].addEventListener('keydown', function (e) {
          var n;
          if (e.key === 'ArrowDown') n = (idx + 1) % mitems.length;
          else if (e.key === 'ArrowUp') n = (idx - 1 + mitems.length) % mitems.length;
          else if (e.key === 'Home') n = 0;
          else if (e.key === 'End') n = mitems.length - 1;
          else return;
          e.preventDefault();
          mitems[n].focus();
        });
      })(mi);
    }

    // the panel fills the screen, so its empty space is the dismiss area
    mpanel.addEventListener('click', function (e) {
      if (!(e.target.closest && e.target.closest('a'))) closeMenu(true);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeMenu(true);
    });
    document.addEventListener('click', function (e) {
      if (menuOpen() && !mpanel.contains(e.target)) closeMenu(false);
    });

    // crossing up to the desktop row hides the button, so an open panel would
    // otherwise be stranded with nothing left to close it
    if (deskQ) {
      var onDesk = function (e) { if (e.matches) closeMenu(false); };
      if (deskQ.addEventListener) deskQ.addEventListener('change', onDesk);
      else if (deskQ.addListener) deskQ.addListener(onDesk);
    }
  }
})();

/* ---------- Chapter Cut: page transition ----------
   The "Chapter Cut" from P4PP · Own The Story, rebuilt for a plain
   multi-page site. Leaving a page, two ink bars close over it and the
   destination's chapter card rises; 1.2s in, the browser navigates. The
   new page is served with its own copy of that card already in the
   markup, and a one-line script in its <head> marks it covered before
   the first paint — so the cut carries across the load with no flash,
   then dissolves off the arriving page.

   Timings and curves come straight from the prototype component; see the
   CHAPTER CUT block in site.css. */
(function () {
  var cc = document.querySelector('.cc');
  if (!cc) return;

  var html = document.documentElement;
  var KEY = 'cc';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches;

  /* ---- arriving ---- */
  // The head script put .cc-in on <html> before the first paint and cleared
  // the hand-off flag itself, so the cover and its dissolve are already
  // running in CSS by now. What is left is to land at the top of the page,
  // and to drop the class once the dissolve is over so a later cut on this
  // page starts from a clean slate.
  if (html.classList.contains('cc-in')) {
    window.scrollTo(0, 0);
    setTimeout(function () { html.classList.remove('cc-in'); }, 500);
  }

  // Under reduced motion the cut is skipped in both directions: the CSS
  // hides the card and links are left to navigate on their own.
  if (reduce) return;

  // Each page's chapter, in the order the menu numbers them. Services,
  // Process and Clients are not in the menu but carry on the count.
  var PAGES = {
    '/':          ['Chapter 01', 'Home'],
    '/about/':    ['Chapter 02', 'About'],
    '/projects/': ['Chapter 03', 'Projects'],
    '/blog/':     ['Chapter 04', 'Blog'],
    '/contact/':  ['Chapter 05', 'Contact'],
    '/services/': ['Chapter 06', 'Services'],
    '/process/':  ['Chapter 07', 'Process'],
    '/clients/':  ['Chapter 08', 'Clients']
  };

  function cardFor(path) {
    if (PAGES[path]) return PAGES[path];
    // anything off the map still gets a card, just without a number
    var seg = path.replace(/\/+$/, '').split('/').pop().replace(/[-_]+/g, ' ');
    if (!seg) return PAGES['/'];
    return ['', seg.charAt(0).toUpperCase() + seg.slice(1)];
  }

  var going = false;

  function cut(url) {
    going = true;

    var card = cardFor(url.pathname);
    var ch = cc.querySelector('.cc__ch');
    var ti = cc.querySelector('.cc__t');
    if (ch) { ch.textContent = card[0]; ch.style.visibility = card[0] ? '' : 'hidden'; }
    if (ti) { ti.textContent = card[1]; }

    // warm the destination while the bars are closing, so the swap at
    // 1.2s lands on something already fetched
    try {
      var pre = document.createElement('link');
      pre.rel = 'prefetch';
      pre.href = url.href;
      document.head.appendChild(pre);
    } catch (e) {}

    // tells the next page to paint itself covered
    try { sessionStorage.setItem(KEY, '1'); } catch (e) {}

    cc.classList.add('is-cut');
    setTimeout(function () { window.location.href = url.href; }, 1200);
  }

  document.addEventListener('click', function (e) {
    if (going) { e.preventDefault(); return; }   // the cut owns the page now
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;  // open-in-tab etc.

    var a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    if (a.hasAttribute('download')) return;
    if (a.target && a.target !== '_self') return;
    if ((a.getAttribute('rel') || '').indexOf('external') > -1) return;

    var url;
    try { url = new URL(a.href, window.location.href); } catch (err) { return; }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;  // mailto, tel
    if (url.origin !== window.location.origin) return;
    // same page — in-page jumps and smooth scrolling stay as they are
    if (url.pathname === window.location.pathname && url.search === window.location.search) return;

    e.preventDefault();
    cut(url);
  });

  // Coming back through the history cache restores this page mid-cut, so
  // clear the cover rather than leave the visitor staring at an ink screen.
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    going = false;
    cc.classList.remove('is-cut');
    html.classList.remove('cc-in', 'cc-out');
    try { sessionStorage.removeItem(KEY); } catch (err) {}
  });
})();
