/* TropiHug — navigation, cover gallery, waitlist, and light motion. */
(function () {
    'use strict';

    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function track(name, props) {
        try {
            var events = JSON.parse(localStorage.getItem('tropihug_events') || '[]');
            if (!Array.isArray(events)) events = [];
            events.push({ event: name, props: props || {}, ts: new Date().toISOString() });
            localStorage.setItem('tropihug_events', JSON.stringify(events));
        } catch (error) {
            // Analytics are optional and never block the page.
        }
    }

    function initNavigation() {
        var nav = document.getElementById('nav');
        var menu = document.getElementById('siteMenu');
        if (!nav) return;

        var hero = document.querySelector('.hero');
        if (hero && 'IntersectionObserver' in window) {
            var observer = new IntersectionObserver(function (entries) {
                nav.classList.toggle('nav--solid', !entries[0].isIntersecting);
            }, { threshold: 0, rootMargin: '-72px 0px 0px 0px' });
            observer.observe(hero);
        } else {
            var updateNav = function () {
                nav.classList.toggle('nav--solid', window.scrollY > 24);
            };
            window.addEventListener('scroll', updateNav, { passive: true });
            updateNav();
        }

        if (!menu) return;
        var summary = menu.querySelector('summary');
        menu.addEventListener('toggle', function () {
            summary.setAttribute('aria-label', menu.open ? 'Close navigation menu' : 'Open navigation menu');
        });
        menu.querySelectorAll('.nav__menu-panel a').forEach(function (link) {
            link.addEventListener('click', function () { menu.open = false; });
        });
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && menu.open) {
                menu.open = false;
                summary.focus();
            }
        });
    }

    function initCoverGallery() {
        var scroller = document.getElementById('coverScroller');
        var previous = document.getElementById('coverPrev');
        var next = document.getElementById('coverNext');
        if (!scroller || !previous || !next) return;

        var updateControls = function () {
            var maxScroll = scroller.scrollWidth - scroller.clientWidth;
            previous.disabled = scroller.scrollLeft <= 2;
            next.disabled = maxScroll <= 2 || scroller.scrollLeft >= maxScroll - 2;
        };
        var distance = function () { return Math.min(scroller.clientWidth * 0.78, 420); };

        previous.addEventListener('click', function () {
            scroller.scrollBy({ left: -distance(), behavior: reduceMotion ? 'auto' : 'smooth' });
        });
        next.addEventListener('click', function () {
            scroller.scrollBy({ left: distance(), behavior: reduceMotion ? 'auto' : 'smooth' });
        });
        scroller.addEventListener('scroll', updateControls, { passive: true });
        window.addEventListener('resize', updateControls, { passive: true });
        updateControls();
    }

    function initWaitlist() {
        var form = document.getElementById('waitlistForm');
        if (!form) return;

        var input = document.getElementById('email');
        var errorMessage = document.getElementById('emailError');
        var submit = form.querySelector('button[type="submit"]');
        var originalLabel = submit.textContent;

        var clearError = function () {
            input.removeAttribute('aria-invalid');
            errorMessage.textContent = '';
        };
        input.addEventListener('input', clearError);

        form.addEventListener('submit', function (event) {
            event.preventDefault();
            var email = input.value.trim().toLowerCase();

            if (!input.validity.valid) {
                input.setAttribute('aria-invalid', 'true');
                errorMessage.textContent = 'Enter a valid email address, such as name@example.com.';
                input.focus();
                return;
            }

            clearError();
            submit.disabled = true;
            form.setAttribute('aria-busy', 'true');
            submit.textContent = 'Joining…';

            try {
                var addresses = JSON.parse(localStorage.getItem('tropihug_waitlist') || '[]');
                if (!Array.isArray(addresses)) addresses = [];
                if (addresses.indexOf(email) === -1) addresses.push(email);
                localStorage.setItem('tropihug_waitlist', JSON.stringify(addresses));
                track('email_submit', { domain: email.split('@')[1] });
                window.location.href = 'thank-you.html?joined=1';
            } catch (storageError) {
                form.removeAttribute('aria-busy');
                submit.disabled = false;
                submit.textContent = originalLabel;
                input.setAttribute('aria-invalid', 'true');
                errorMessage.textContent = 'Your email could not be saved in this browser. Check your storage settings and try again.';
                input.focus();
            }
        });
    }

    function initConfirmation() {
        var content = document.getElementById('confirmationContent');
        if (!content) return;

        var joined = new URLSearchParams(window.location.search).get('joined') === '1';
        var title = document.getElementById('confirmationTitle');
        var message = document.getElementById('confirmationMessage');
        var action = document.getElementById('confirmationAction');
        var story = document.getElementById('confirmationStory');
        var note = document.getElementById('confirmationNote');

        if (joined) {
            document.title = 'Thanks for joining — TropiHug™';
            title.innerHTML = 'Thanks for<br><em>joining.</em>';
            message.textContent = 'Your interest has been saved in this browser. Email updates are not connected yet.';
            action.textContent = 'Return to the story';
            action.href = 'index.html#story';
            story.textContent = 'Explore the materials ↗';
            story.href = 'index.html#materials';
            note.textContent = 'You can revisit the waitlist whenever you like.';
            track('thank_you_view');
        }
    }

    function initMotion() {
        var motion = window.Motion;
        var hero = document.querySelector('.hero');
        var media = document.querySelectorAll('.hero__image, .hero__video');
        if (!motion || !hero || !media.length || reduceMotion || typeof motion.scroll !== 'function') return;

        media.forEach(function (element) {
            motion.scroll(
                motion.animate(element, { transform: ['scale(1)', 'scale(1.08)'] }),
                { target: hero, offset: ['start start', 'end start'] }
            );
        });
    }

    function initGeneratedVideos() {
        if (reduceMotion || typeof fetch !== 'function') return;
        document.querySelectorAll('[data-generated-video]').forEach(function (video) {
            var source = video.dataset.generatedVideo;
            fetch(source, { method: 'HEAD', cache: 'no-store' }).then(function (response) {
                if (!response.ok) return;
                video.src = source;

                var play = function () {
                    var result = video.play();
                    if (result && typeof result.then === 'function') {
                        result.then(function () { video.classList.add('is-playing'); }).catch(function () {});
                    } else {
                        video.classList.add('is-playing');
                    }
                };

                if (video.classList.contains('hero__video')) {
                    video.addEventListener('canplay', play, { once: true });
                    video.load();
                    if (video.readyState >= 3) play();
                } else if ('IntersectionObserver' in window) {
                    var observer = new IntersectionObserver(function (entries) {
                        entries.forEach(function (entry) {
                            if (entry.isIntersecting) play();
                            else video.pause();
                        });
                    }, { threshold: 0.15 });
                    observer.observe(video);
                } else {
                    play();
                }
            }).catch(function () {});
        });
    }

    function initAnalytics() {
        track('page_view', { path: window.location.pathname });
        var sent50 = false;
        var sent90 = false;
        window.addEventListener('scroll', function () {
            var height = document.documentElement.scrollHeight - window.innerHeight;
            if (height <= 0) return;
            var progress = window.scrollY / height;
            if (!sent50 && progress >= 0.5) {
                sent50 = true;
                track('scroll_50');
            }
            if (!sent90 && progress >= 0.9) {
                sent90 = true;
                track('scroll_90');
            }
        }, { passive: true });
    }

    function init() {
        initNavigation();
        initCoverGallery();
        initWaitlist();
        initConfirmation();
        initGeneratedVideos();
        initMotion();
        initAnalytics();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
