function setCurrentNavigation() {
    const page = document.body.dataset.page;

    for (const link of document.querySelectorAll('[data-nav]')) {
        if (link.dataset.nav === page) {
            link.setAttribute('aria-current', 'page');
        }
    }
}

function installNavigation() {
    const button = document.querySelector('.nav-toggle');
    const navigation = document.querySelector('.site-nav');

    if (!button || !navigation) {
        return;
    }

    const close = () => {
        button.setAttribute('aria-expanded', 'false');
        navigation.dataset.open = 'false';
    };

    button.addEventListener('click', () => {
        const open = button.getAttribute('aria-expanded') !== 'true';
        button.setAttribute('aria-expanded', String(open));
        navigation.dataset.open = String(open);
    });

    navigation.addEventListener('click', (event) => {
        if (event.target.closest('a')) {
            close();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            close();
        }
    });
}

function installCopyButtons() {
    for (const button of document.querySelectorAll('[data-copy-target]')) {
        button.addEventListener('click', async () => {
            const target = document.getElementById(button.dataset.copyTarget);

            if (!target) {
                return;
            }

            const original = button.textContent;

            try {
                await navigator.clipboard.writeText(target.textContent.trim());
                button.textContent = 'Copied';
            } catch {
                button.textContent = 'Copy failed';
            }

            window.setTimeout(() => {
                button.textContent = original;
            }, 1600);
        });
    }
}

function setCurrentYear() {
    for (const element of document.querySelectorAll('[data-current-year]')) {
        element.textContent = String(new Date().getFullYear());
    }
}

function installPromoPlayer() {
    for (const player of document.querySelectorAll('[data-youtube-id]')) {
        const button = player.querySelector('[data-youtube-play]');
        const videoId = player.dataset.youtubeId;

        if (!button || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
            continue;
        }

        button.addEventListener('click', () => {
            const iframe = document.createElement('iframe');
            iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0`;
            iframe.title = 'DBOPFS Studio 0.1 product tour';
            iframe.referrerPolicy = 'strict-origin-when-cross-origin';
            iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
            iframe.allowFullscreen = true;
            player.replaceChildren(iframe);
        }, { once: true });
    }
}

setCurrentNavigation();
installNavigation();
installCopyButtons();
installPromoPlayer();
setCurrentYear();

function installPageSections() {
    if (!['architecture', 'privacy', 'install'].includes(document.body.dataset.page)) return;
    const article = document.querySelector('.prose');
    const selector = document.querySelector('.page-toc');
    if (!article || !selector) return;
    const sections = new Map();
    let section;
    for (const node of [...article.childNodes]) {
        if (node.nodeType === 1 && node.matches('h2[id]')) {
            section = document.createElement('section');
            section.className = 'content-section';
            section.setAttribute('aria-labelledby', node.id);
            article.insertBefore(section, node);
            sections.set(node.id, section);
        }
        if (section) section.append(node);
    }
    const all = document.createElement('a');
    all.href = '#all';
    all.textContent = 'See all';
    selector.append(all);
    selector.classList.add('section-selector');
    document.body.classList.add('has-section-selector');
    article.before(selector);
    const links = [...selector.querySelectorAll('a')];
    function showSection() {
        const key = location.hash.slice(1);
        const active = sections.has(key) ? key : 'all';
        for (const [id, panel] of sections) panel.hidden = active !== 'all' && id !== active;
        for (const link of links) {
            if (link.hash === '#' + active) link.setAttribute('aria-current', 'true');
            else link.removeAttribute('aria-current');
        }
    }
    selector.addEventListener('click', (event) => {
        const link = event.target.closest('a');
        if (!link || !selector.contains(link) || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        if (location.hash !== link.hash) history.pushState(null, '', link.hash);
        showSection();
        selector.scrollIntoView({block:'start', behavior:'instant'});
    });
    window.addEventListener('hashchange', showSection);
    window.addEventListener('popstate', showSection);
    showSection();
}
installPageSections();

function installHeroMotion() {
    const art = document.querySelector('.hero-brand-art');
    if (!art || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const home = document.createElement('div');
    home.className = 'hero-art-home';
    art.before(home);
    home.append(art);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hero-motion-toggle';
    button.textContent = 'Resume';
    home.append(button);
    let moving = false, frame = 0, last = 0, x = 0, y = 0, vx = -18, vy = 14.4;
    let pointer = null;
    let touchingPointer = false;
    document.addEventListener('pointermove', event => {
        if (event.pointerType === 'mouse') pointer = {x: event.clientX, y: event.clientY};
    }, {passive: true});
    function clearPointer() {pointer = null; touchingPointer = false;}
    document.documentElement.addEventListener('pointerleave', clearPointer);
    window.addEventListener('blur', clearPointer);
    function tick(time) {
        const elapsed = last ? Math.min((time - last) / 1000, .05) : 0;
        last = time;
        const maxX = Math.max(0, document.documentElement.clientWidth - art.offsetWidth);
        const maxY = Math.max(0, innerHeight - art.offsetHeight);
        // Reflect at the sun's circular edge, with a small cushion around the cursor.
        if (pointer) {
            const dx = x + art.offsetWidth / 2 - pointer.x;
            const dy = y + art.offsetHeight / 2 - pointer.y;
            const distance = Math.hypot(dx, dy);
            const contact = distance < art.offsetWidth / 2 + 16;
            if (contact && !touchingPointer) {
                const speed = Math.hypot(vx, vy);
                const nx = distance > .01 ? dx / distance : -vx / speed;
                const ny = distance > .01 ? dy / distance : -vy / speed;
                const approach = vx * nx + vy * ny;
                if (approach < 0) {
                    vx -= 2 * approach * nx;
                    vy -= 2 * approach * ny;
                } else {
                    vx = speed * nx;
                    vy = speed * ny;
                }
            }
            touchingPointer = contact;
        }
        x += vx * elapsed;
        y += vy * elapsed;
        if (x <= 0 || x >= maxX) {vx = x <= 0 ? Math.abs(vx) : -Math.abs(vx); x = Math.max(0, Math.min(x, maxX));}
        if (y <= 0 || y >= maxY) {vy = y <= 0 ? Math.abs(vy) : -Math.abs(vy); y = Math.max(0, Math.min(y, maxY));}
        art.style.transform = `translate(${x}px, ${y}px)`;
        frame = requestAnimationFrame(tick);
    }
    function start() {
        if (!art.classList.contains('hero-roaming-art')) {
            const rect = home.getBoundingClientRect();
            x = rect.left; y = rect.top;
            art.style.width = `${rect.width}px`;
            art.style.left = '0'; art.style.top = '0';
            art.style.transform = `translate(${x}px, ${y}px)`;
            art.classList.add('hero-roaming-art');
            document.body.append(art);
        }
        last = 0;
        art.style.animationPlayState = 'running';
        moving = true;
        button.textContent = 'Pause';
        frame = requestAnimationFrame(tick);
    }
    function stop() {
        cancelAnimationFrame(frame);
        art.style.animationPlayState = 'paused';
        moving = false;
        button.textContent = 'Resume';
    }
    function resetHome() {
        stop();
        clearPointer();
        art.classList.remove('hero-roaming-art');
        art.removeAttribute('style');
        home.append(art);
    }
    window.addEventListener('pagehide', resetHome);
    button.addEventListener('click', () => moving ? stop() : start());
    document.addEventListener('visibilitychange', () => {
        cancelAnimationFrame(frame); last = 0;
        if (!document.hidden && moving) frame = requestAnimationFrame(tick);
    });
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', event => {if (event.matches) resetHome();});
    stop();
}
installHeroMotion();
