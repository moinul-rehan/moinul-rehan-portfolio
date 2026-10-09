/* Shared motion helpers, kept from the previous build. Nothing on this page runs on a timer:
   motion plays once, gated by visibility, and never when the visitor asks to reduce motion. */
window.PortfolioMotion = (function(){
  var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function reduceMotion(){ return !!(mq && mq.matches); }
  function onMotionChange(fn, add){
    if (!mq) return;
    if (mq.addEventListener) mq[add ? 'addEventListener' : 'removeEventListener']('change', fn);
    else if (mq.addListener) mq[add ? 'addListener' : 'removeListener'](fn);
  }
  // Runs onStart while el is on screen, the tab is visible and motion is allowed, and onStop
  // when any of that stops being true. Returns a function that removes its observer and listeners.
  function whenVisible(el, onStart, onStop){
    var hasIO = 'IntersectionObserver' in window;
    var inView = !hasIO;
    var running = false;
    var io = null;
    function sync(){
      var should = inView && !document.hidden && !reduceMotion();
      if (should && !running) { running = true; onStart(); }
      else if (!should && running) { running = false; onStop(); }
    }
    if (hasIO) {
      io = new IntersectionObserver(function(entries){
        inView = entries[entries.length - 1].isIntersecting;
        sync();
      });
      io.observe(el);
    }
    document.addEventListener('visibilitychange', sync);
    onMotionChange(sync, true);
    sync();
    return function dispose(){
      if (io) io.disconnect();
      document.removeEventListener('visibilitychange', sync);
      onMotionChange(sync, false);
    };
  }
  // One-shot: calls fn the first time el is on screen, then disconnects its observer.
  // Returns a cancel function for when the reveal is no longer needed.
  function onceVisible(el, fn, options){
    if (!('IntersectionObserver' in window)) { fn(); return function(){}; }
    var io = new IntersectionObserver(function(entries){
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) { io.disconnect(); fn(); return; }
      }
    }, options);
    io.observe(el);
    return function cancel(){ io.disconnect(); };
  }
  return { reduceMotion: reduceMotion, whenVisible: whenVisible, onceVisible: onceVisible };
})();

(function(){
  var html = document.documentElement;
  var motion = window.PortfolioMotion;
  var EASE = 'cubic-bezier(.4,0,.2,1)';
  var UI = 160, DRAG = 620;                       // --dur-ui and --dur-drag
  var canAnimate = typeof Element.prototype.animate === 'function';
  function toArray(list){ return Array.prototype.slice.call(list); }
  function translate(x, y){ return 'translate(' + x + 'px,' + y + 'px)'; }

  /* COVER SEQUENCE
     The finished cover is the real layout; the mess is the notes' start state layered on top. Timeline:
       0 to 780ms      the "Rehan" cursor fades in and drags a marquee over the loose sticky notes
       780 to 1480ms   the notes straighten, then glide into their stack on the portrait frame
       1400 to 2020ms  the cursor drag-selects the phrase
       2020 to 2240ms  handles pop, the W x H badge appears, the cursor parks on the top-right handle
     Every move is transform or opacity, measured once before it starts. When it ends, no timer,
     observer or listener is left running. */
  var finishCover = (function(){
    var stage = document.querySelector('[data-cover]');
    if (!stage || !html.classList.contains('cover-play')) return function(){};
    var deco = stage.querySelector('.sel-cover .sel-deco');
    var cursor = deco.querySelector('.sel-cursor');
    var drag = deco.querySelector('.sel-drag');
    var box = deco.querySelector('.sel-box');
    var handles = toArray(box.querySelectorAll('.sel-handle'));
    var badge = deco.querySelector('.sel-badge');
    var marquee = stage.querySelector('.cover-marquee');
    var notes = toArray(stage.querySelectorAll('.note'));
    var state = 'waiting';                        // waiting, running, done
    var anims = [];
    var dispose = null;

    function finish(){
      if (state === 'done') return;
      state = 'done';
      clearTimeout(window.__coverSafety);
      html.classList.remove('cover-play');
      html.classList.add('cover-done');
      anims.forEach(function(a){ a.cancel(); });
      anims = [];
      marquee.removeAttribute('style');
      if (dispose) { dispose(); dispose = null; }
    }

    // Measure only once Geist is in, so the positions match the final text; never wait past 800ms.
    function afterFonts(cb){
      var done = false;
      var cap = setTimeout(go, 800);
      function go(){ if (done) return; done = true; clearTimeout(cap); cb(); }
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(go, go);
      else go();
    }

    function play(){
      if (state !== 'waiting') return;
      if (!canAnimate || !html.classList.contains('cover-play')) { finish(); return; }
      state = 'running';
      afterFonts(run);
    }

    function run(){
      if (state !== 'running') return;
      var origin = stage.getBoundingClientRect();
      function rect(el){
        var r = el.getBoundingClientRect();
        return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
      }
      var sel = rect(deco);
      var tip = rect(cursor);                      // the cursor is a point parked on the top-right handle
      var noteRects = notes.map(rect);
      var noteTilts = notes.map(function(n){ return getComputedStyle(n).transform; });
      var m = { x: Infinity, y: Infinity, x2: -Infinity, y2: -Infinity };
      noteRects.forEach(function(r){
        m.x = Math.min(m.x, r.x - 12); m.y = Math.min(m.y, r.y - 12);
        m.x2 = Math.max(m.x2, r.x + r.w + 12); m.y2 = Math.max(m.y2, r.y + r.h + 12);
      });
      marquee.style.left = m.x + 'px';
      marquee.style.top = m.y + 'px';
      marquee.style.width = (m.x2 - m.x) + 'px';
      marquee.style.height = (m.y2 - m.y) + 'px';

      var T = 2240;
      function at(ms){ return ms / T; }
      var opts = { duration: T, fill: 'both' };
      var dragEnd = UI + DRAG;                    // 780
      var travelEnd = dragEnd + DRAG;             // 1400
      var selectEnd = travelEnd + DRAG;           // 2020

      // The cursor travels in lockstep with each marquee: same easing, same duration.
      anims.push(cursor.animate([
        { offset: 0, transform: translate(m.x - tip.x, m.y - tip.y), opacity: 0 },
        { offset: at(UI), transform: translate(m.x - tip.x, m.y - tip.y), opacity: 1, easing: EASE },
        { offset: at(dragEnd), transform: translate(m.x2 - tip.x, m.y2 - tip.y), opacity: 1, easing: EASE },
        { offset: at(travelEnd), transform: translate(sel.x - tip.x, sel.y - tip.y), opacity: 1, easing: EASE },
        { offset: at(selectEnd), transform: translate(sel.x + sel.w - tip.x, sel.y + sel.h - tip.y), opacity: 1, easing: EASE },
        { offset: at(selectEnd + UI), transform: translate(0, 0), opacity: 1 },
        { offset: 1, transform: translate(0, 0), opacity: 1 }
      ], opts));

      anims.push(marquee.animate([
        { offset: 0, transform: 'scale(0)', opacity: 1 },
        { offset: at(UI), transform: 'scale(0)', opacity: 1, easing: EASE },
        { offset: at(dragEnd), transform: 'scale(1)', opacity: 1 },
        { offset: at(dragEnd + UI), transform: 'scale(1)', opacity: 0 },
        { offset: 1, transform: 'scale(1)', opacity: 0 }
      ], opts));

      // Tidy up: each note straightens where it lies, then glides into its place in the stack on
      // the portrait frame, where it stays as a layer visitors can move.
      notes.forEach(function(n, i){
        var loose = noteTilts[i] === 'none' ? translate(0, 0) : noteTilts[i];
        var m6 = /matrix\(([^)]+)\)/.exec(noteTilts[i]);
        var parts = m6 ? m6[1].split(',') : null;
        var straight = parts && parts.length === 6 ? translate(parseFloat(parts[4]), parseFloat(parts[5])) : translate(0, 0);
        var lag = i * 40;
        anims.push(n.animate([
          { offset: 0, transform: loose },
          { offset: at(dragEnd + lag), transform: loose, easing: EASE },
          { offset: at(dragEnd + UI + lag), transform: straight, easing: EASE },
          { offset: at(travelEnd + lag), transform: translate(0, 0) },
          { offset: 1, transform: translate(0, 0) }
        ], opts));
      });

      // Drag-select the phrase, then release: the fill clears and the selection snaps on.
      anims.push(drag.animate([
        { offset: 0, transform: 'scale(0)', opacity: 1 },
        { offset: at(travelEnd), transform: 'scale(0)', opacity: 1, easing: EASE },
        { offset: at(selectEnd), transform: 'scale(1)', opacity: 1 },
        { offset: at(selectEnd + UI), transform: 'scale(1)', opacity: 0 },
        { offset: 1, transform: 'scale(1)', opacity: 0 }
      ], opts));
      anims.push(box.animate([
        { offset: 0, opacity: 0 },
        { offset: at(selectEnd), opacity: 0, easing: EASE },
        { offset: at(selectEnd + UI), opacity: 1 },
        { offset: 1, opacity: 1 }
      ], opts));
      handles.forEach(function(h, i){
        anims.push(h.animate([
          { offset: 0, transform: 'scale(0)' },
          { offset: at(selectEnd + i * 20), transform: 'scale(0)', easing: EASE },
          { offset: at(selectEnd + UI + i * 20), transform: 'scale(1)' },
          { offset: 1, transform: 'scale(1)' }
        ], opts));
      });
      anims.push(badge.animate([
        { offset: 0, opacity: 0 },
        { offset: at(selectEnd + 60), opacity: 0, easing: EASE },
        { offset: 1, opacity: 1 }
      ], opts));

      Promise.all(anims.map(function(a){ return a.finished; })).then(finish, function(){});
    }

    dispose = motion.whenVisible(stage, play, finish);
    if (state === 'done' && dispose) { dispose(); dispose = null; }
    return finish;
  })();

  /* SIGNED DECISIONS
     At most four on the page: the HandyNaija and SUEDE decision lines, the current version in
     the Record and the contact email. Each draws once when it scrolls into view, through a
     one-shot observer that disconnects as soon as it fires. */
  var signs = toArray(document.querySelectorAll('[data-sign]'));
  function settle(el){
    if (el._cancelSign) { el._cancelSign(); el._cancelSign = null; }
    el.classList.add('is-signed');
  }
  function sign(el){
    if (el.classList.contains('is-signed')) return;
    var deco = el.querySelector('.sel-deco');
    var cursor = deco.querySelector('.sel-cursor');
    // One read: the selection's corners relative to where the cursor rests (top-right handle,
    // or bottom-right on phones).
    var d = deco.getBoundingClientRect(), c = cursor.getBoundingClientRect();
    var start = translate(d.left - c.left, d.top - c.top);
    var end = translate(d.right - c.left, d.bottom - c.top);
    var T = UI + DRAG + UI;                       // 940
    function at(ms){ return ms / T; }
    var opts = { duration: T, fill: 'backwards' };
    el.classList.add('is-signed');                // the finished frame; the animations run on top of it
    cursor.animate([
      { offset: 0, transform: start, opacity: 0 },
      { offset: at(UI), transform: start, opacity: 1, easing: EASE },
      { offset: at(UI + DRAG), transform: end, opacity: 1, easing: EASE },
      { offset: 1, transform: translate(0, 0), opacity: 1 }
    ], opts);
    deco.querySelector('.sel-drag').animate([
      { offset: 0, transform: 'scale(0)', opacity: 1 },
      { offset: at(UI), transform: 'scale(0)', opacity: 1, easing: EASE },
      { offset: at(UI + DRAG), transform: 'scale(1)', opacity: 1 },
      { offset: 1, transform: 'scale(1)', opacity: 0 }
    ], opts);
    deco.querySelector('.sel-box').animate([
      { offset: 0, opacity: 0 },
      { offset: at(UI + DRAG), opacity: 0, easing: EASE },
      { offset: 1, opacity: 1 }
    ], opts);
    toArray(deco.querySelectorAll('.sel-handle')).forEach(function(handle){
      handle.animate([
        { offset: 0, transform: 'scale(0)' },
        { offset: at(UI + DRAG), transform: 'scale(0)', easing: EASE },
        { offset: 1, transform: 'scale(1)' }
      ], opts);
    });
  }
  if (!canAnimate || motion.reduceMotion() || window.location.hash) {
    signs.forEach(settle);
  } else {
    html.classList.add('sign-ready');
    signs.forEach(function(el){
      el._cancelSign = motion.onceVisible(el, function(){ el._cancelSign = null; sign(el); }, { threshold: 0.6 });
    });
  }

  // Contents and nav jumps land on the finished state: the cover stops, and any decision in
  // the destination section is drawn straight away instead of playing.
  document.addEventListener('click', function(e){
    var link = e.target.closest ? e.target.closest('a[href^="#"]') : null;
    if (!link) return;
    finishCover();
    var dest = document.getElementById(link.getAttribute('href').slice(1));
    if (dest) toArray(dest.querySelectorAll('[data-sign]')).forEach(settle);
  });

  /* LIVE SIZE BADGE: the cover selection reports its layer's real width and height, like Figma.
     A ResizeObserver only fires when that size changes, for example when the window is resized. */
  (function(){
    var phrase = document.querySelector('.sel-cover');
    var badge = phrase && phrase.querySelector('.sel-badge');
    if (!badge) return;
    var deco = badge.parentNode;
    function write(w, h){
      // Once a visitor resizes the selection, the canvas reports the box's own size instead.
      if (deco.hasAttribute('data-sized')) return;
      var value = Math.round(w) + ' × ' + Math.round(h);
      if (badge.getAttribute('data-size') !== value) badge.setAttribute('data-size', value);
    }
    if ('ResizeObserver' in window) {
      new ResizeObserver(function(entries){
        var r = entries[0].contentRect;
        write(r.width, r.height);
      }).observe(phrase);
    } else {
      var r = phrase.getBoundingClientRect();
      write(r.width, r.height);
    }
  })();

  /* FRAME SIZE: the portrait frame's label shows the frame's live width and height, like a
     Figma frame. It updates only when that size changes (a window resize or a visitor's drag). */
  (function(){
    var frame = document.querySelector('.cv-frame');
    var out = document.querySelector('.cv-size');
    if (!frame || !out) return;
    function write(){
      var value = frame.offsetWidth + ' × ' + frame.offsetHeight;
      if (out.getAttribute('data-size') !== value) out.setAttribute('data-size', value);
    }
    if ('ResizeObserver' in window) new ResizeObserver(write).observe(frame);
    else write();
  })();

  /* PLAYABLE CANVAS
     The cover is a small working file with three kinds of layer: the headline selection, the
     portrait frame and three sticky notes. Move (V) selects, drags and resizes them, Hand (H)
     pans them together and Inspect (I) measures them; Tidy up lines the notes up again and Reset
     puts every layer back. Pointer Events only, captured on the element being dragged, so
     nothing listens on window; during a drag one requestAnimationFrame per frame writes the
     positions as transforms. Touch keeps scrolling the page: the first tap selects a layer, and
     only a selected layer (or its handle) takes over a drag. Nothing here moves on its own, and
     under reduced motion Tidy up and Reset jump instead of gliding. */
  (function(){
    var canvas = document.querySelector('[data-canvas]');
    if (!canvas || !window.PointerEvent || typeof canvas.closest !== 'function') return;
    var stage = canvas.querySelector('[data-cover]');
    var phraseEl = stage && stage.querySelector('.sel-cover');
    var portraitEl = stage && stage.querySelector('[data-obj="portrait"]');
    var notesWrap = stage && stage.querySelector('.cover-notes');
    var toolbar = canvas.querySelector('[data-toolbar]');
    var live = canvas.querySelector('[data-cv-live]');
    var layer = canvas.querySelector('[data-inspect-layer]');
    if (!phraseEl || !portraitEl || !notesWrap || !toolbar || !live || !layer) return;
    var title = phraseEl.parentNode;
    var deco = phraseEl.querySelector('.sel-deco');
    var badge = deco.querySelector('.sel-badge');
    var slot = portraitEl.parentNode;
    var frame = portraitEl.querySelector('.cv-frame');
    var img = frame.querySelector('img');
    var GRID = 8, GAP = 8, MIN = 48;
    var KEYS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    var tool = 'move', current = null, drag = null, frameReq = 0;
    var suppressClick = false, pointerInside = false, keyed = null, keyedResize = false;
    var pan = { x: 0, y: 0 };
    var padX = -parseFloat(getComputedStyle(deco).left) || 0;
    var padY = -parseFloat(getComputedStyle(deco).top) || 0;
    function snap(v){ return Math.round(v / GRID) * GRID; }
    function floorGrid(v){ return Math.floor(v / GRID) * GRID; }
    function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
    function round(v){ return Math.round(v); }

    // Layers. Each one is focusable, says it can be moved, and is described by the shared
    // instructions. The headline's selection is drawn inside the h1 (hidden from screen readers),
    // so a separate, visually hidden button after the h1 takes its keyboard focus.
    // DRAFT COPY for Rehan's approval: layer names and the labels screen readers announce.
    var proxy = document.createElement('span');
    proxy.className = 'vh';
    title.parentNode.insertBefore(proxy, title.nextSibling);
    function makeLayer(kind, el, focusEl, name, label){
      focusEl.setAttribute('role', 'button');
      focusEl.setAttribute('tabindex', '0');
      focusEl.setAttribute('aria-pressed', 'false');
      focusEl.setAttribute('aria-label', label);
      focusEl.setAttribute('aria-describedby', 'cv-help');
      return { kind: kind, el: el, focusEl: focusEl, name: name, x: 0, y: 0, w: 0, h: 0, sized: false, anim: null };
    }
    var phrase = makeLayer('phrase', deco, proxy, 'Selection', 'Selection box around “clear, usable products.”, movable and resizable');
    var portrait = makeLayer('portrait', portraitEl, portraitEl, 'Portrait frame', 'Portrait frame: ' + img.getAttribute('alt') + '. Movable and resizable');
    portraitEl.querySelector('.cv-frame-wrap').insertAdjacentHTML('beforeend', '<span class="cv-chrome" aria-hidden="true"><span class="cv-box"></span><span class="cv-handle" data-handle="br"></span></span>');
    notesWrap.removeAttribute('aria-hidden');
    var notes = toArray(notesWrap.querySelectorAll('.note')).map(function(n){
      var text = n.textContent.trim();
      n.insertAdjacentHTML('beforeend', '<span class="cv-chrome" aria-hidden="true"><span class="cv-box"></span><span class="sel-badge"></span></span>');
      return makeLayer('note', n, n, 'Note “' + text + '”', 'Sticky note “' + text + '”, movable');
    });
    ['tl', 'tr', 'bl', 'br'].forEach(function(corner, i){
      var h = deco.querySelectorAll('.sel-handle')[i];
      if (h) h.setAttribute('data-handle', corner);
    });
    var layers = [phrase, portrait].concat(notes);

    function layerFrom(t){
      if (!t || !t.closest) return null;
      if (t === proxy || t.closest('.sel-cover .sel-deco')) return phrase;
      var n = t.closest('.note');
      for (var i = 0; n && i < notes.length; i++) if (notes[i].el === n) return notes[i];
      return t.closest('[data-obj="portrait"]') ? portrait : null;
    }
    function rectOf(o){ return o.el.getBoundingClientRect(); }
    function natural(){ var r = phraseEl.getBoundingClientRect(); return { w: r.width, h: r.height }; }
    function phraseSize(){ return phrase.sized ? { w: phrase.w, h: phrase.h } : natural(); }
    function portraitWidth(){ return portrait.sized ? portrait.w : portraitEl.offsetWidth; }
    function restWidth(){ return slot.getBoundingClientRect().width; }
    function writeSize(el, w, h){
      var value = round(w) + ' × ' + round(h);
      if (el.getAttribute('data-size') !== value) el.setAttribute('data-size', value);
    }

    // Writes one layer's state to the page: its position as a transform, and its size where it
    // has been resized (the selection box, or the portrait frame's width).
    function apply(o){
      var tx = o.x + pan.x, ty = o.y + pan.y;
      o.el.style.transform = (tx || ty) ? translate(tx, ty) : '';
      if (o === phrase) {
        var s = deco.style;
        if (o.sized) {
          s.right = s.bottom = 'auto';
          s.width = (o.w + padX * 2) + 'px';
          s.height = (o.h + padY * 2) + 'px';
          deco.setAttribute('data-sized', '');
          writeSize(badge, o.w, o.h);
        } else if (deco.hasAttribute('data-sized')) {
          s.right = s.bottom = s.width = s.height = '';
          deco.removeAttribute('data-sized');
          var n = natural();
          writeSize(badge, n.w, n.h);
        }
      } else if (o === portrait) {
        o.el.style.width = o.sized ? o.w + 'px' : '';
      }
    }

    // How far the given boxes may travel together and stay inside the canvas.
    function limits(rects){
      var c = canvas.getBoundingClientRect();
      var L = { x0: -Infinity, x1: Infinity, y0: -Infinity, y1: Infinity };
      rects.forEach(function(r){
        L.x0 = Math.max(L.x0, c.left - r.left); L.x1 = Math.min(L.x1, c.right - r.right);
        L.y0 = Math.max(L.y0, c.top - r.top); L.y1 = Math.min(L.y1, c.bottom - r.bottom);
      });
      if (L.x0 > L.x1) L.x0 = L.x1 = (L.x0 + L.x1) / 2;
      if (L.y0 > L.y1) L.y0 = L.y1 = (L.y0 + L.y1) / 2;
      return L;
    }

    // DRAFT COPY for Rehan's approval: status messages read by screen readers.
    function say(text){
      if (live.textContent === text) text += ' ';
      live.textContent = text;
    }
    function offsetText(x, y){
      var parts = [];
      if (round(x)) parts.push(Math.abs(round(x)) + (x > 0 ? ' right' : ' left'));
      if (round(y)) parts.push(Math.abs(round(y)) + (y > 0 ? ' down' : ' up'));
      return parts.length ? parts.join(' and ') + ' from its place' : 'back in its place';
    }
    function movedText(o){ return o.name + ' moved, ' + offsetText(o.x + pan.x, o.y + pan.y) + '.'; }
    function sizedText(o){
      if (o === phrase) { var s = phraseSize(); return 'Selection resized to ' + round(s.w) + ' by ' + round(s.h) + '.'; }
      return 'Portrait frame resized to ' + frame.offsetWidth + ' by ' + frame.offsetHeight + '.';
    }

    // Selection, like Figma: one layer at a time. The headline's selection is Rehan's own and
    // always stays drawn; selecting it adds the translucent fill.
    function select(o, focus){
      if (current !== o) {
        if (current) {
          current.el.classList.remove('is-selected');
          current.focusEl.setAttribute('aria-pressed', 'false');
        }
        current = o;
        if (o) {
          o.el.classList.add('is-selected');
          o.focusEl.setAttribute('aria-pressed', 'true');
          if (o.kind === 'note') writeSize(o.el.querySelector('.sel-badge'), o.el.offsetWidth, o.el.offsetHeight);
        }
      }
      if (o && focus && document.activeElement !== o.focusEl) {
        try { o.focusEl.focus({ preventScroll: true }); } catch (e) { o.focusEl.focus(); }
      }
    }

    // Glides a layer from where it was (a rect taken before the change) to where it is now, as a
    // transform-only FLIP. Skipped entirely under reduced motion.
    function stopAnim(o){ if (o.anim) { o.anim.cancel(); o.anim = null; } }
    function glide(o, from, delay){
      if (motion.reduceMotion() || typeof o.el.animate !== 'function') return;
      var to = rectOf(o);
      var dx = from.left - to.left, dy = from.top - to.top;
      var sx = to.width ? from.width / to.width : 1, sy = to.height ? from.height / to.height : 1;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.005 && Math.abs(sy - 1) < 0.005) return;
      var end = o.el.style.transform || 'none';
      var start = (end === 'none' ? '' : end + ' ') + translate(dx, dy) + ' scale(' + sx + ',' + sy + ')';
      var a = o.el.animate([{ transform: start }, { transform: end }], { duration: DRAG, easing: EASE, delay: delay || 0, fill: 'backwards' });
      o.anim = a;
      a.onfinish = function(){ if (o.anim === a) o.anim = null; };
    }

    // KEYBOARD: arrows move by 8px, Shift + arrows resize by 8px where a layer can be resized.
    function moveBy(o, dx, dy){
      var L = limits([rectOf(o)]);
      o.x += clamp(dx, Math.min(0, L.x0), Math.max(0, L.x1));
      o.y += clamp(dy, Math.min(0, L.y0), Math.max(0, L.y1));
      apply(o);
    }
    function portraitLimits(r){
      var c = canvas.getBoundingClientRect(), fr = frame.getBoundingClientRect();
      var ratio = fr.height / fr.width, rest = restWidth();
      var lo = snap(rest / 2);
      var hi = Math.min(snap(rest * 1.5), floorGrid(c.right - r.left), floorGrid((c.bottom - fr.top) / ratio));
      return { lo: lo, hi: Math.max(lo, hi), ratio: ratio };
    }
    function resizeBy(o, dx, dy){
      var c = canvas.getBoundingClientRect(), r = rectOf(o);
      if (o === phrase) {
        var s = phraseSize(), w = s.w, h = s.h;
        if (dx) w = clamp(snap(s.w + dx), MIN, Math.max(MIN, floorGrid(s.w + c.right - r.right)));
        if (dy) h = clamp(snap(s.h + dy), MIN, Math.max(MIN, floorGrid(s.h + c.bottom - r.bottom)));
        o.w = w; o.h = h; o.sized = true;
      } else {
        var P = portraitLimits(r);
        o.w = clamp(snap(portraitWidth() + (dx || dy)), P.lo, P.hi);
        o.sized = true;
      }
      apply(o);
    }

    // POINTER: one drag at a time, captured on the dragged element.
    function begin(e, d, el){
      d.id = e.pointerId; d.sx = d.px = e.pageX; d.sy = d.py = e.pageY; d.moved = false; d.el = el;
      drag = d;
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onEnd);
      el.addEventListener('pointercancel', onEnd);
      el.addEventListener('lostpointercapture', onEnd);
    }
    function startMove(e, o){
      begin(e, { mode: 'move', o: o, x0: o.x, y0: o.y, L: limits([rectOf(o)]) }, o.el);
    }
    function startPan(e){
      e.preventDefault();
      layers.forEach(stopAnim);
      canvas.classList.add('is-panning');
      begin(e, { mode: 'pan', x0: pan.x, y0: pan.y, L: limits(layers.map(rectOf)) }, canvas);
    }
    function startResize(e, o, handle){
      var c = canvas.getBoundingClientRect(), r = rectOf(o);
      var d = { mode: 'resize', o: o, corner: handle.getAttribute('data-handle'), x0: o.x, y0: o.y };
      if (o === phrase) {
        var s = phraseSize();
        var right = d.corner === 'tr' || d.corner === 'br', bottom = d.corner === 'bl' || d.corner === 'br';
        d.w0 = s.w; d.h0 = s.h;
        d.maxW = s.w + (right ? c.right - r.right : r.left - c.left);
        d.maxH = s.h + (bottom ? c.bottom - r.bottom : r.top - c.top);
      } else {
        var P = portraitLimits(r);
        d.w0 = portraitWidth(); d.lo = P.lo; d.hi = P.hi; d.ratio = P.ratio;
      }
      begin(e, d, handle);
    }
    function step(){
      var d = drag, dx = d.px - d.sx, dy = d.py - d.sy, o = d.o;
      if (d.mode === 'move') {
        o.x = d.x0 + clamp(dx, d.L.x0, d.L.x1);
        o.y = d.y0 + clamp(dy, d.L.y0, d.L.y1);
        apply(o);
      } else if (d.mode === 'pan') {
        pan.x = d.x0 + clamp(dx, d.L.x0, d.L.x1);
        pan.y = d.y0 + clamp(dy, d.L.y0, d.L.y1);
        layers.forEach(apply);
      } else if (!d.moved) {
        return;                                   // a click on a handle changes nothing
      } else if (o === phrase) {
        var c = d.corner, left = c === 'tl' || c === 'bl', top = c === 'tl' || c === 'tr';
        var w = clamp(snap(d.w0 + (left ? -dx : dx)), MIN, Math.max(MIN, floorGrid(d.maxW)));
        var h = clamp(snap(d.h0 + (top ? -dy : dy)), MIN, Math.max(MIN, floorGrid(d.maxH)));
        o.x = d.x0 + (left ? d.w0 - w : 0);
        o.y = d.y0 + (top ? d.h0 - h : 0);
        o.w = w; o.h = h; o.sized = true;
        apply(o);
      } else {
        o.w = clamp(snap(d.w0 + (dx + dy / d.ratio) / 2), d.lo, d.hi);
        o.sized = true;
        apply(o);
      }
    }
    function flush(){ frameReq = 0; if (drag) step(); }
    function onMove(e){
      if (!drag || e.pointerId !== drag.id) return;
      drag.px = e.pageX; drag.py = e.pageY;
      if (!drag.moved && Math.abs(drag.px - drag.sx) + Math.abs(drag.py - drag.sy) > 3) {
        drag.moved = true;
        if (drag.o) drag.o.el.classList.add('is-dragging');
      }
      if (!frameReq) frameReq = requestAnimationFrame(flush);
    }
    function onEnd(e){
      var d = drag;
      if (!d || e.pointerId !== d.id) return;
      if (frameReq) { cancelAnimationFrame(frameReq); frameReq = 0; }
      if (e.type === 'pointerup') { d.px = e.pageX; d.py = e.pageY; }
      step();                                     // land exactly where the pointer let go
      drag = null;
      d.el.removeEventListener('pointermove', onMove);
      d.el.removeEventListener('pointerup', onEnd);
      d.el.removeEventListener('pointercancel', onEnd);
      d.el.removeEventListener('lostpointercapture', onEnd);
      try { if (d.el.hasPointerCapture && d.el.hasPointerCapture(d.id)) d.el.releasePointerCapture(d.id); } catch (err) {}
      canvas.classList.remove('is-panning');
      if (d.o) d.o.el.classList.remove('is-dragging');
      if (!d.moved) return;
      if (d.mode === 'pan') { suppressClick = true; say('Canvas panned, ' + offsetText(pan.x, pan.y).replace('its place', 'the start') + '.'); }
      else say(d.mode === 'resize' ? sizedText(d.o) : movedText(d.o));
    }

    canvas.addEventListener('pointerdown', function(e){
      suppressClick = false;
      if (drag || e.isPrimary === false || (e.pointerType === 'mouse' && e.button !== 0)) return;
      var t = e.target;
      if (!t.closest || t.closest('[data-toolbar]')) return;
      finishCover();
      if (tool === 'hand') { if (e.pointerType !== 'touch') startPan(e); return; }
      if (tool !== 'move') return;
      var o = layerFrom(t);
      if (!o || (e.pointerType === 'touch' && current !== o)) return;   // a first tap only selects
      e.preventDefault();
      stopAnim(o);
      select(o, true);
      var handle = t.closest('[data-handle]');
      if (handle) startResize(e, o, handle); else startMove(e, o);
    });
    // Clicks select (this is also how a tap selects on touch); a click on empty canvas clears the
    // selection. After a pan, the click that ends it is swallowed so no link fires by accident.
    canvas.addEventListener('click', function(e){
      if (suppressClick) { suppressClick = false; e.preventDefault(); e.stopPropagation(); return; }
      var t = e.target;
      if (tool !== 'move' || !t.closest || t.closest('[data-toolbar]')) return;
      var o = layerFrom(t);
      if (o) select(o, true);
      else if (!t.closest('a, button')) select(null);
    }, true);
    deco.addEventListener('dblclick', function(e){
      if (tool !== 'move') return;
      e.preventDefault();
      stopAnim(phrase);
      var from = rectOf(phrase);
      phrase.x = -pan.x; phrase.y = -pan.y; phrase.sized = false;
      apply(phrase);
      glide(phrase, from, 0);
      say('Selection reset.');
    });

    canvas.addEventListener('keydown', function(e){
      var o = layerFrom(e.target);
      if (!o || e.target !== o.focusEl || e.ctrlKey || e.metaKey || e.altKey) return;
      var k = e.key;
      if (k === 'Escape') {
        e.preventDefault();
        if (current) { select(null); say('Selection cleared.'); }
        return;
      }
      if (k === 'Enter' || k === ' ') { e.preventDefault(); select(current === o ? null : o); return; }
      var v = KEYS[k];
      if (!v) return;
      e.preventDefault();
      finishCover();
      stopAnim(o);
      select(o);
      keyedResize = e.shiftKey && o.kind !== 'note';
      if (keyedResize) resizeBy(o, v[0] * GRID, v[1] * GRID); else moveBy(o, v[0] * GRID, v[1] * GRID);
      if (tool === 'inspect') showInspect(inspectTarget(o.focusEl), false);
      keyed = o;
    });
    // One announcement per key press or held-down run, when the key comes back up: no timer.
    canvas.addEventListener('keyup', function(e){
      if (!keyed || !KEYS[e.key]) return;
      say(keyedResize ? sizedText(keyed) : movedText(keyed));
      keyed = null;
    });

    canvas.addEventListener('focusin', function(e){
      var o = layerFrom(e.target);
      if (o && e.target === o.focusEl) select(o);
      if (e.target === proxy) {
        var visible = true;
        try { visible = proxy.matches(':focus-visible'); } catch (err) {}
        deco.classList.toggle('is-focus', visible);
      }
      if (tool === 'inspect') showInspect(inspectTarget(e.target), true);
    });
    canvas.addEventListener('focusout', function(e){ if (e.target === proxy) deco.classList.remove('is-focus'); });

    // TIDY UP, like Figma's: the notes line up as a row or a stack where they are now, 8px apart.
    function tidy(){
      finishCover();
      var c = canvas.getBoundingClientRect();
      var items = notes.map(function(o){
        stopAnim(o);
        var r = rectOf(o);
        return { o: o, r: r, x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height };
      });
      function pick(f, g){ return items.map(f).reduce(function(a, b){ return g(a, b); }); }
      var minX = pick(function(i){ return i.x; }, Math.min), minY = pick(function(i){ return i.y; }, Math.min);
      var maxX = pick(function(i){ return i.x + i.w; }, Math.max), maxY = pick(function(i){ return i.y + i.h; }, Math.max);
      var sumW = pick(function(i){ return i.w; }, function(a, b){ return a + b; }) + GAP * (items.length - 1);
      var sumH = pick(function(i){ return i.h; }, function(a, b){ return a + b; }) + GAP * (items.length - 1);
      var bigW = pick(function(i){ return i.w; }, Math.max), bigH = pick(function(i){ return i.h; }, Math.max);
      var row = maxX - minX > maxY - minY;
      if (row && sumW > c.width) row = false;
      if (!row && sumH > c.height) row = true;
      items.sort(row ? function(a, b){ return a.x - b.x || a.y - b.y; } : function(a, b){ return a.y - b.y || a.x - b.x; });
      var ax = clamp(minX, 0, Math.max(0, c.width - (row ? sumW : bigW)));
      var ay = clamp(minY, 0, Math.max(0, c.height - (row ? bigH : sumH)));
      var cur = row ? ax : ay, changed = false;
      items.forEach(function(it, i){
        var tx = row ? cur : ax, ty = row ? ay : cur;
        cur += (row ? it.w : it.h) + GAP;
        var dx = tx - it.x, dy = ty - it.y;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
        changed = true;
        it.o.x += dx; it.o.y += dy;
        apply(it.o);
        glide(it.o, it.r, i * 40);
      });
      say(changed ? (row ? 'Notes tidied into a row.' : 'Notes tidied into a stack.') : 'The notes are already tidy.');
    }
    // RESET: every layer back to its original place and size, the pan undone, the selection cleared.
    function reset(){
      finishCover();
      var from = layers.map(function(o){ stopAnim(o); return rectOf(o); });
      pan.x = pan.y = 0;
      layers.forEach(function(o){ o.x = o.y = 0; o.sized = false; apply(o); });
      select(null);
      hideInspect();
      layers.forEach(function(o, i){ glide(o, from[i], o.kind === 'note' ? notes.indexOf(o) * 40 : 0); });
      say('Canvas reset. Every layer is back in its place.');
    }

    // TOOLS
    var toolButtons = toArray(toolbar.querySelectorAll('[data-tool]'));
    var handButton = toolbar.querySelector('[data-tool="hand"]');
    function handAvailable(){ return !!handButton && getComputedStyle(handButton).display !== 'none'; }
    // DRAFT COPY for Rehan's approval: tool announcements.
    var TOOL_TEXT = {
      move: 'Move tool. Drag a layer, or focus it and use the arrow keys.',
      hand: 'Hand tool. Drag anywhere on the cover to pan the layers.',
      inspect: 'Inspect tool. Point at or focus a layer to see its measurements.'
    };
    function setTool(t, speak){
      if (t === tool || (t === 'hand' && !handAvailable())) return;
      tool = t;
      canvas.setAttribute('data-cv-tool', t);
      toolButtons.forEach(function(b){ b.setAttribute('aria-pressed', b.getAttribute('data-tool') === t ? 'true' : 'false'); });
      hideInspect();
      if (speak) say(TOOL_TEXT[t]);
      if (t === 'inspect' && canvas.contains(document.activeElement)) showInspect(inspectTarget(document.activeElement), false);
    }
    toolbar.addEventListener('click', function(e){
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      var t = b.getAttribute('data-tool'), act = b.getAttribute('data-act');
      if (t) setTool(t, true);
      else if (act === 'tidy') tidy();
      else if (act === 'reset') reset();
    });
    // The toolbar is one Tab stop; arrow keys, Home and End move between its buttons.
    var buttons = toArray(toolbar.querySelectorAll('button'));
    function rove(b){ buttons.forEach(function(x){ x.tabIndex = x === b ? 0 : -1; }); }
    rove(buttons[0]);
    toolbar.addEventListener('focusin', function(e){ if (buttons.indexOf(e.target) > -1) rove(e.target); });
    toolbar.addEventListener('keydown', function(e){
      var list = buttons.filter(function(b){ return b.offsetParent !== null; });
      var i = list.indexOf(document.activeElement);
      var k = e.key;
      var n = k === 'ArrowRight' || k === 'ArrowDown' ? i + 1 : k === 'ArrowLeft' || k === 'ArrowUp' ? i - 1 : k === 'Home' ? 0 : k === 'End' ? list.length - 1 : null;
      if (i < 0 || n === null) return;
      e.preventDefault();
      var next = list[(n + list.length) % list.length];
      rove(next);
      next.focus();
    });
    // V, H and I work only while focus or the pointer is inside the canvas (WCAG 2.1.4), never
    // with a modifier key, so the browser's own shortcuts are untouched.
    canvas.addEventListener('pointerenter', function(e){ if (e.pointerType !== 'touch') pointerInside = true; });
    canvas.addEventListener('pointerleave', function(){
      pointerInside = false;
      if (tool === 'inspect' && !canvas.contains(document.activeElement)) hideInspect();
    });
    document.addEventListener('keydown', function(e){
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      var a = document.activeElement;
      if (!pointerInside && !canvas.contains(a)) return;
      if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
      var k = (e.key || '').toLowerCase();
      var t = k === 'v' ? 'move' : k === 'h' ? 'hand' : k === 'i' ? 'inspect' : '';
      if (t) {
        if (t !== 'hand' || handAvailable()) { e.preventDefault(); setTool(t, true); }
        return;
      }
      if (e.key === 'Escape' && current) { select(null); say('Selection cleared.'); }
    });

    // INSPECT: for the layer under the pointer or in focus, its measured size, the gap to its
    // nearest neighbour as a redline, and for text the family, size and weight the browser
    // computed. Nothing is looked up or named beyond what is measured here.
    var insBox = layer.querySelector('.cv-ins-box'), insNbr = layer.querySelector('.cv-ins-nbr');
    var insLine = layer.querySelector('.cv-ins-line'), insGap = layer.querySelector('.cv-ins-gap');
    var insSpec = layer.querySelector('.cv-ins-spec'), insName = layer.querySelector('.cv-ins-name');
    var insSize = layer.querySelector('.cv-ins-size'), insFont = layer.querySelector('.cv-ins-font');
    function inspectTarget(t){
      var o = layerFrom(t);
      if (o) return { o: o, el: o === portrait ? frame : o === phrase ? null : o.el };
      var d = t && t.closest ? t.closest('[data-inspect]') : null;
      return d && canvas.contains(d) ? { el: d } : null;
    }
    function boxOf(tg, c){
      if (tg.o === phrase) {
        var r = deco.getBoundingClientRect();
        return { x: r.left - c.left + padX, y: r.top - c.top + padY, w: r.width - padX * 2, h: r.height - padY * 2 };
      }
      var q = tg.el.getBoundingClientRect();
      return { x: q.left - c.left, y: q.top - c.top, w: q.width, h: q.height };
    }
    // The file behind the portrait: srcset hands back a density-corrected naturalWidth, so the
    // width comes from the chosen candidate's own w descriptor and the height from its ratio.
    function sourceSize(){
      var src = img.currentSrc || img.src, w = 0;
      (img.getAttribute('srcset') || '').split(',').forEach(function(part){
        var bits = part.trim().split(/\s+/);
        try { if (bits[0] && /w$/.test(bits[1] || '') && new URL(bits[0], document.baseURI).href === src) w = parseInt(bits[1], 10); } catch (err) {}
      });
      if (!w && img.naturalWidth && !img.getAttribute('srcset')) w = img.naturalWidth;
      return w && img.naturalWidth ? w + ' × ' + round(w * img.naturalHeight / img.naturalWidth) : '';
    }
    function fontOf(el){
      var cs = getComputedStyle(el);
      return cs.fontFamily.split(',')[0].replace(/["']/g, '').trim() + ' · ' + parseFloat(cs.fontSize) + 'px · ' + cs.fontWeight;
    }
    function place(el, x, y, w, h){
      el.style.transform = translate(round(x), round(y));
      if (w != null) el.style.width = Math.max(1, round(w)) + 'px';
      if (h != null) el.style.height = Math.max(1, round(h)) + 'px';
    }
    function hideInspect(){ layer.classList.remove('is-on'); }
    function showInspect(tg, speak){
      if (!tg) { hideInspect(); return; }
      var c = canvas.getBoundingClientRect();
      var r = boxOf(tg, c), name, font;
      // DRAFT COPY for Rehan's approval: layer names on the spec card.
      if (tg.o === phrase) { name = 'Selection'; font = fontOf(title); }
      else if (tg.o === portrait) { name = 'Frame · Rehan'; font = sourceSize() ? 'Image · ' + sourceSize() + ' source' : 'Image'; }
      else if (tg.o) { name = 'Sticky note'; font = fontOf(tg.el); }
      else { name = tg.el.getAttribute('data-inspect'); font = fontOf(tg.el); }
      var own = tg.el || deco, best = null;
      var others = [{ o: phrase, el: null }, { o: portrait, el: frame }].concat(notes.map(function(n){ return { o: n, el: n.el }; }));
      toArray(canvas.querySelectorAll('[data-inspect]')).forEach(function(el){ others.push({ el: el }); });
      others.forEach(function(cd){
        if (cd.o ? cd.o === tg.o : (cd.el === tg.el || cd.el.contains(own) || own.contains(cd.el))) return;
        var q = boxOf(cd, c);
        if (q.w < 1 || q.h < 1) return;
        var ox = Math.min(r.x + r.w, q.x + q.w) - Math.max(r.x, q.x);
        var oy = Math.min(r.y + r.h, q.y + q.h) - Math.max(r.y, q.y);
        var axis, gap;
        if (ox > 0 && oy <= 0) { axis = 'v'; gap = q.y >= r.y + r.h ? q.y - (r.y + r.h) : r.y - (q.y + q.h); }
        else if (oy > 0 && ox <= 0) { axis = 'h'; gap = q.x >= r.x + r.w ? q.x - (r.x + r.w) : r.x - (q.x + q.w); }
        else return;
        if (!best || gap < best.gap) best = { gap: gap, axis: axis, q: q, ox: ox, oy: oy };
      });
      layer.classList.add('is-on');
      place(insBox, r.x, r.y, r.w, r.h);
      insNbr.classList.toggle('is-off', !best);
      insGap.classList.toggle('is-off', !best);
      insLine.className = 'cv-ins-line' + (best ? (best.axis === 'v' ? ' is-v' : ' is-h') : ' is-off');
      if (best) {
        var q = best.q, g = best.gap;
        place(insNbr, q.x, q.y, q.w, q.h);
        insGap.textContent = round(g);
        if (best.axis === 'v') {
          var lx = Math.max(r.x, q.x) + best.ox / 2, top = q.y >= r.y + r.h ? r.y + r.h : q.y + q.h;
          place(insLine, lx, top, 1, g);
          place(insGap, lx + 6, top + g / 2 - insGap.offsetHeight / 2);
        } else {
          var ly = Math.max(r.y, q.y) + best.oy / 2, left = q.x >= r.x + r.w ? r.x + r.w : q.x + q.w;
          place(insLine, left, ly, g, 1);
          place(insGap, left + g / 2 - insGap.offsetWidth / 2, ly - insGap.offsetHeight - 6);
        }
      }
      insName.textContent = name;
      insSize.textContent = round(r.w) + ' × ' + round(r.h);
      insFont.textContent = font;
      // The card goes on the side away from the measured neighbour, so the redline stays in view.
      var sw = insSpec.offsetWidth, sh = insSpec.offsetHeight;
      var cx = clamp(r.x, 8, Math.max(8, c.width - sw - 8)), cy = clamp(r.y, 8, Math.max(8, c.height - sh - 8));
      var above = { x: cx, y: r.y - sh - 8 }, below = { x: cx, y: r.y + r.h + 8 };
      var toLeft = { x: r.x - sw - 8, y: cy }, toRight = { x: r.x + r.w + 8, y: cy };
      var spots = !best ? [above, below, toRight, toLeft]
        : best.axis === 'v' ? (best.q.y < r.y ? [below, above, toRight, toLeft] : [above, below, toRight, toLeft])
        : (best.q.x > r.x ? [toLeft, toRight, above, below] : [toRight, toLeft, above, below]);
      var spot = spots.filter(function(s){ return s.x >= 0 && s.y >= 0 && s.x + sw <= c.width && s.y + sh <= c.height; })[0] || above;
      place(insSpec, spot.x, Math.max(0, spot.y));
      if (speak) say(name + ', ' + round(r.w) + ' by ' + round(r.h) + ', ' + font.replace(/ · /g, ', ') + (best ? ', ' + round(best.gap) + ' pixels from the nearest layer.' : '.'));
    }
    canvas.addEventListener('pointerover', function(e){ if (tool === 'inspect') showInspect(inspectTarget(e.target), false); });

    // A layout change (a window resize, a rotated phone) keeps every moved layer inside the canvas.
    if ('ResizeObserver' in window) {
      new ResizeObserver(function(){
        hideInspect();
        layers.forEach(function(o){
          if (!o.x && !o.y && !pan.x && !pan.y && !o.sized) return;
          var L = limits([rectOf(o)]);
          var dx = clamp(0, L.x0, L.x1), dy = clamp(0, L.y0, L.y1);
          if (dx || dy) { o.x += dx; o.y += dy; apply(o); }
        });
      }).observe(canvas);
    }

    html.classList.add('cv-on');
  })();

  /* BRIEF BUILDER (contact page): checks the three questions, then opens the visitor's own email
     app with the brief filled in. Nothing is sent from the page. Errors sit under each field, are
     announced, and focus moves to the first one. After a valid submit a visible note and a "Copy
     the brief" button stay under the button, for visitors with no email app set up. The form is
     only shown once this script has wired it; until then the plain "Send it as a brief" link is
     the way in. */
  (function(){
    var form = document.querySelector('[data-brief]');
    if (!form) return;
    var status = form.querySelector('[data-brief-status]');
    var copyRow = form.querySelector('[data-brief-copy-row]');
    var copyButton = form.querySelector('[data-brief-copy]');
    var fallbackBox = document.querySelector('[data-brief-fallback]');
    var to = 'rehan.moinul.10@gmail.com';
    // Some email apps cut off or refuse longer mailto links (older Outlook stops near 2,000
    // characters), so a longer brief goes on the clipboard and the email opens with the subject only.
    var MAX_LINK = 1900;
    var brief = '';
    // DRAFT COPY for Rehan's approval: error and status messages.
    var NEED = { name: 'Please add your name.', q1: 'Please answer: who is the user?', q2: 'Please answer: what’s actually broken today?', q3: 'Please answer: what does success look like?' };
    var MISSING = 'Some answers are missing.';
    var OPENED = 'Your email app should open with the brief filled in. If it did not, copy the brief and send it to ' + to + '.';
    var LONG = 'Your brief is long, so it has been copied. Paste it into the email that opens, or into a new email to ' + to + '.';
    var COPIED = 'Brief copied. Paste it into a new email to ' + to + '.';
    var BLOCKED = 'This browser did not allow copying. Your answers are still in the form, ready to send to ' + to + '.';
    // /DRAFT COPY
    function field(name){ return form.elements[name]; }
    function say(message){ status.textContent = message; }
    function mailto(subject, body){
      return 'mailto:' + to + '?subject=' + encodeURIComponent(subject) + (body ? '&body=' + encodeURIComponent(body.replace(/\n/g, '\r\n')) : '');
    }
    // Resolves true once the text is on the clipboard. Without the Clipboard API it copies from a
    // hidden field next to the button (so focusing it never scrolls the page), then puts focus back.
    function copyText(value){
      return new Promise(function(resolve){
        function legacy(){
          var back = document.activeElement, area = document.createElement('textarea'), ok = false;
          area.value = value;
          area.className = 'vh';
          area.setAttribute('readonly', '');
          area.setAttribute('tabindex', '-1');
          area.setAttribute('aria-hidden', 'true');
          copyRow.parentNode.appendChild(area);
          area.select();
          area.setSelectionRange(0, value.length);
          try { ok = document.execCommand('copy'); } catch (e) {}
          area.parentNode.removeChild(area);
          if (back && back.focus) back.focus();
          resolve(ok);
        }
        if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(value).then(function(){ resolve(true); }, legacy);
        else legacy();
      });
    }
    function setError(el, message){
      var id = el.id + '-error', note = document.getElementById(id);
      if (message) {
        if (!note) {
          note = document.createElement('p');
          note.className = 'field-error';
          note.id = id;
          el.parentNode.appendChild(note);
        }
        note.textContent = message;
        el.setAttribute('aria-invalid', 'true');
        el.setAttribute('aria-describedby', id);
      } else {
        if (note) note.parentNode.removeChild(note);
        el.removeAttribute('aria-invalid');
        el.removeAttribute('aria-describedby');
      }
    }
    form.addEventListener('input', function(e){
      if (e.target.getAttribute('aria-invalid') === 'true' && e.target.value.trim()) setError(e.target, '');
      // An edited brief is a new brief: the note and the copy button wait for the next submit.
      if (status.textContent) say('');
      copyRow.hidden = true;
    });
    form.addEventListener('submit', function(e){
      e.preventDefault();
      var first = null;
      ['name', 'q1', 'q2', 'q3'].forEach(function(n){
        var el = field(n), missing = !el.value.trim();
        setError(el, missing ? NEED[n] : '');
        if (missing && !first) first = el;
      });
      if (first) {
        copyRow.hidden = true;
        say(MISSING);
        first.focus();
        return;
      }
      var project = field('project').value.trim();
      var body = 'Hi Rehan,\n\n' +
        '1. Who is the user?\n' + field('q1').value.trim() + '\n\n' +
        '2. What’s actually broken today?\n' + field('q2').value.trim() + '\n\n' +
        '3. What does success look like?\n' + field('q3').value.trim() + '\n\n' +
        field('name').value.trim() + (project ? '\n' + project : '');
      var subject = 'Project brief' + (project ? ': ' + project : '');
      var href = mailto(subject, body);
      brief = subject + '\n\n' + body;
      copyButton.classList.remove('is-copied');
      copyRow.hidden = false;
      if (href.length <= MAX_LINK) {
        say(OPENED);
        window.location.href = href;
        return;
      }
      copyText(body).then(function(ok){
        if (ok) {
          say(LONG);
          window.location.href = mailto(subject, '');
        } else {
          say(OPENED);
          window.location.href = href;
        }
      });
    });
    copyButton.addEventListener('click', function(){
      copyText(brief).then(function(ok){
        if (ok) {
          copyButton.classList.add('is-copied');
          say(COPIED);
        } else {
          say(BLOCKED);
        }
      });
    });
    copyButton.addEventListener('blur', function(){ copyButton.classList.remove('is-copied'); });
    form.hidden = false;
    if (fallbackBox) fallbackBox.hidden = true;
  })();

  /* PROJECT FRAMES: each project card's selection badge reports its frame's live width and
     height, like a selected Figma frame. One ResizeObserver for every card; it only fires when a
     frame's size changes (a window resize). */
  (function(){
    var frames = toArray(document.querySelectorAll('[data-pcard-frame]'));
    if (!frames.length || !('ResizeObserver' in window)) return;
    var ro = new ResizeObserver(function(entries){
      entries.forEach(function(entry){
        var el = entry.target, badge = el.querySelector('.sel-badge');
        if (!badge) return;
        var value = el.offsetWidth + ' × ' + el.offsetHeight;
        if (badge.getAttribute('data-size') !== value) badge.setAttribute('data-size', value);
      });
    });
    frames.forEach(function(f){ ro.observe(f); });
  })();

  /* SCROLL-SPY: one shared IntersectionObserver marks the section crossing the reading line. It
     updates the running head and the home page's small-screen Contents. The masthead links go
     to other pages, so the build marks the current one (aria-current="page") and the spy leaves
     them alone. */
  (function(){
    var sections = toArray(document.querySelectorAll('[data-spy]'));
    var head = document.querySelector('[data-running-head]');
    var headText = head.querySelector('.rh-text');
    var tocLinks = toArray(document.querySelectorAll('[data-toc-link]'));
    function mark(links, attr, key){
      links.forEach(function(a){
        if (key && a.getAttribute(attr) === key) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      });
    }
    function setCurrent(section){
      var text = section.getAttribute('data-spy');
      if (headText.textContent !== text) headText.textContent = text;
      head.classList.toggle('is-empty', !text);
      mark(tocLinks, 'data-toc-link', section.id === 'top' ? '' : section.id);
    }
    if (!('IntersectionObserver' in window)) return;
    var spy = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){ if (entry.isIntersecting) setCurrent(entry.target); });
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach(function(s){ spy.observe(s); });
  })();

  /* SMALL-SCREEN CONTENTS: closes after a jump, on Escape, or on a tap outside it. The outside
     listener exists only while the menu is open. */
  (function(){
    var toc = document.querySelector('[data-toc]');
    if (!toc) return;
    var summary = toc.querySelector('summary');
    function outside(e){ if (!toc.contains(e.target)) toc.open = false; }
    toc.addEventListener('click', function(e){
      if (e.target.closest && e.target.closest('.toc-panel a')) toc.open = false;
    });
    toc.addEventListener('keydown', function(e){
      if (e.key === 'Escape' && toc.open) { toc.open = false; summary.focus(); }
    });
    toc.addEventListener('toggle', function(){
      if (toc.open) document.addEventListener('click', outside);
      else document.removeEventListener('click', outside);
    });
  })();

  /* COPY EMAIL: confirms "Copied" in place and announces it. If the clipboard is unavailable,
     the visible address is selected instead. The label resets when the button loses focus, so
     no timer is needed. */
  (function(){
    var button = document.querySelector('[data-copy]');
    var status = document.querySelector('[data-copy-status]');
    var address = document.querySelector('.contact-email .sel');
    if (!button || !status || !address) return;
    var email = button.getAttribute('data-copy');
    button.hidden = false;
    function copied(){
      button.classList.add('is-copied');
      // DRAFT COPY for Rehan's approval: status messages read by screen readers.
      status.textContent = 'Email address copied';
    }
    function fallback(){
      // Select the whole visible address (both text nodes around the line-break hint), not the decoration.
      var range = document.createRange();
      range.setStart(address, 0);
      range.setEndBefore(address.querySelector('.sel-deco'));
      var selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      if (ok) copied();
      else status.textContent = 'Email address selected. Press Control C or Command C to copy it.';
    }
    button.addEventListener('click', function(){
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(email).then(copied, fallback);
      else fallback();
    });
    button.addEventListener('blur', function(){ button.classList.remove('is-copied'); });
  })();
})();
