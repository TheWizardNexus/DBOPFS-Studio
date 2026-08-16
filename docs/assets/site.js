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
