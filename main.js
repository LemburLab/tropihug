/* =============================================
   TROPIHUG™ — JAVASCRIPT
   Reveals, parallax, nav, form. Motion.dev + vanilla.
   Motion is progressive: page works fully without it.
============================================= */
(function () {
    'use strict';

    var root = document.documentElement;
    var M = window.Motion;
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Signal JS is on (arms the reveal FOUC guard in CSS).
    // If Motion is missing or reduced-motion is on, leave everything visible.
    if (M && !reduce) root.classList.add('js');

    // ---------------------------------------------
    // REVEALS
    // ---------------------------------------------
    function initReveals() {
        if (!M || reduce) return;
        var animate = M.animate, inView = M.inView, stagger = M.stagger;
        var ease = [0.22, 1, 0.36, 1];

        // Grouped stagger containers
        document.querySelectorAll('[data-reveal-stagger]').forEach(function (group) {
            var kids = group.querySelectorAll('[data-reveal]');
            inView(group, function () {
                animate(kids,
                    { opacity: [0, 1], transform: ['translateY(28px)', 'translateY(0)'] },
                    { duration: 0.7, ease: ease, delay: stagger(0.09) });
            }, { amount: 0.15 });
        });

        // Standalone reveals (not inside a stagger group)
        document.querySelectorAll('[data-reveal]').forEach(function (el) {
            if (el.closest('[data-reveal-stagger]')) return;
            inView(el, function () {
                animate(el,
                    { opacity: [0, 1], transform: ['translateY(28px)', 'translateY(0)'] },
                    { duration: 0.75, ease: ease });
            }, { amount: 0.2 });
        });

        // Safety net: if anything never triggers, show it after 3.5s.
        setTimeout(function () {
            document.querySelectorAll('.js [data-reveal]').forEach(function (el) {
                if (getComputedStyle(el).opacity === '0') {
                    el.style.opacity = '1';
                    el.style.transform = 'none';
                }
            });
        }, 3500);
    }

    // ---------------------------------------------
    // HERO PARALLAX
    // ---------------------------------------------
    function initParallax() {
        if (!M || reduce) return;
        var bg = document.getElementById('heroBg');
        var hero = document.querySelector('.hero');
        if (!bg || !hero) return;
        M.scroll(
            M.animate(bg, { transform: ['translateY(0)', 'translateY(14%)'] }),
            { target: hero, offset: ['start start', 'end start'] }
        );
    }

    // ---------------------------------------------
    // NAV — solidify past hero + drawer
    // ---------------------------------------------
    function initNav() {
        var nav = document.getElementById('nav');
        var toggle = document.getElementById('navToggle');
        var drawer = document.getElementById('drawer');
        var close = document.getElementById('drawerClose');
        var announce = document.querySelector('.announce');

        // Keep the nav sitting exactly below the (fixed) announce bar.
        var syncOffset = function () {
            if (!announce) return;
            root.style.setProperty('--announce-h', announce.offsetHeight + 'px');
        };
        syncOffset();
        window.addEventListener('resize', syncOffset, { passive: true });

        var onScroll = function () {
            var solid = window.scrollY > (window.innerHeight - 90);
            nav.classList.toggle('nav--solid', solid);
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();

        var setDrawer = function (open) {
            drawer.classList.toggle('open', open);
            drawer.setAttribute('aria-hidden', String(!open));
            toggle.setAttribute('aria-expanded', String(open));
            document.body.style.overflow = open ? 'hidden' : '';
        };
        toggle.addEventListener('click', function () { setDrawer(true); });
        close.addEventListener('click', function () { setDrawer(false); });
        drawer.querySelectorAll('.drawer__link').forEach(function (a) {
            a.addEventListener('click', function () { setDrawer(false); });
        });
        window.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') setDrawer(false);
        });
    }

    // ---------------------------------------------
    // SWATCHES
    // ---------------------------------------------
    function initSwatches() {
        var swatches = document.querySelectorAll('.swatch');
        var nameEl = document.getElementById('swatchName');
        swatches.forEach(function (sw) {
            sw.addEventListener('click', function () {
                swatches.forEach(function (s) { s.setAttribute('aria-pressed', 'false'); });
                sw.setAttribute('aria-pressed', 'true');
                if (nameEl) nameEl.textContent = sw.getAttribute('data-name');
                if (M && !reduce) M.animate(sw, { scale: [1, 1.18, 1] }, { duration: 0.35 });
            });
        });
    }

    // ---------------------------------------------
    // COLLECTION — arrow scroll
    // ---------------------------------------------
    function initCollection() {
        var scroller = document.getElementById('collScroll');
        var prev = document.getElementById('collPrev');
        var next = document.getElementById('collNext');
        if (!scroller) return;
        var step = function () { return Math.min(scroller.clientWidth * 0.8, 380); };
        if (prev) prev.addEventListener('click', function () { scroller.scrollBy({ left: -step(), behavior: 'smooth' }); });
        if (next) next.addEventListener('click', function () { scroller.scrollBy({ left: step(), behavior: 'smooth' }); });
    }

    // ---------------------------------------------
    // COUNT-UP for [data-count]
    // ---------------------------------------------
    function initCounters() {
        var els = document.querySelectorAll('[data-count]');
        if (!els.length) return;

        var run = function (el) {
            var target = parseInt(el.getAttribute('data-count'), 10);
            if (reduce || !target) { el.textContent = target.toLocaleString('en-US'); return; }
            var start = null, dur = 1400;
            var tick = function (t) {
                if (start === null) start = t;
                var p = Math.min((t - start) / dur, 1);
                var eased = 1 - Math.pow(1 - p, 3);
                el.textContent = Math.round(target * eased).toLocaleString('en-US');
                if (p < 1) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        };

        if (M) {
            els.forEach(function (el) { M.inView(el, function () { run(el); }, { amount: 0.6 }); });
        } else {
            els.forEach(run);
        }
    }

    // ---------------------------------------------
    // RESERVE FORM
    // ---------------------------------------------
    function initForm() {
        var form = document.getElementById('reserveForm');
        if (!form) return;
        var section = document.getElementById('reserve');
        var input = form.querySelector('input[type="email"]');
        var valid = function (v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); };

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            var email = input.value.trim();
            if (!valid(email)) {
                if (M && !reduce) M.animate(input, { x: [0, -8, 8, -6, 6, 0] }, { duration: 0.4 });
                input.style.borderColor = '#e08a6f';
                input.focus();
                setTimeout(function () { input.style.borderColor = ''; }, 2000);
                return;
            }
            track('reserve_submit', { domain: email.split('@')[1] });

            // Persist + assign a queue number (mock, no backend).
            var list = JSON.parse(localStorage.getItem('tropihug_reservations') || '[]');
            if (list.indexOf(email) === -1) list.push(email);
            localStorage.setItem('tropihug_reservations', JSON.stringify(list));
            var position = 1284 + list.length; // base list + this reservation
            localStorage.setItem('tropihug_last_position', String(position));

            section.classList.add('is-done');
            setTimeout(function () {
                window.location.href = 'thank-you.html?pos=' + position;
            }, 1400);
        });
    }

    // ---------------------------------------------
    // ANALYTICS (mock)
    // ---------------------------------------------
    function track(name, props) {
        try {
            var ev = JSON.parse(localStorage.getItem('tropihug_events') || '[]');
            ev.push({ event: name, props: props || {}, ts: new Date().toISOString() });
            localStorage.setItem('tropihug_events', JSON.stringify(ev));
        } catch (e) {}
    }

    // ---------------------------------------------
    // INIT
    // ---------------------------------------------
    function init() {
        initReveals();
        initParallax();
        initNav();
        initSwatches();
        initCollection();
        initCounters();
        initForm();
        track('page_view', { path: location.pathname });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else { init(); }

    // Tiny self-check (dev only): email validator sanity.
    if (location.hash === '#selftest') {
        var v = function (s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); };
        console.assert(v('a@b.co') === true, 'valid email failed');
        console.assert(v('nope') === false, 'invalid email passed');
        console.log('✓ selftest ok');
    }
})();
