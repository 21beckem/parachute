// The welcome screen is a higher view of the same sky, not a second page.
(() => {
    const body = document.body;
    const welcome = document.querySelector('.welcome');
    const form = document.getElementById('welcome-form');
    const input = document.getElementById('display-name');
    const wordmark = document.querySelector('.wordmark');
    const tools = document.querySelector('.header-tools');
    const main = document.querySelector('main');
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

    try {
        input.value = sessionStorage.getItem('parachute.displayName') || '';
    } catch {
        /* The form still works when browser storage is unavailable. */
    }

    function positionTitle() {
        if (body.classList.contains('has-entered')) return;
        const scale = Math.min(1.35, (innerWidth - 36) / wordmark.offsetWidth);
        const header = wordmark.offsetParent;
        body.style.setProperty(
            '--welcome-title-x',
            `${innerWidth / 2 - wordmark.offsetLeft - (wordmark.offsetWidth * scale) / 2}px`
        );
        body.style.setProperty(
            '--welcome-title-y',
            `${innerHeight * 0.23 - header.offsetTop - wordmark.offsetTop - (wordmark.offsetHeight * scale) / 2}px`
        );
        body.style.setProperty('--welcome-title-scale', scale);
    }

    positionTitle();
    body.classList.add('welcome-active');
    for (const element of [tools, main]) element.inert = true;
    // The title remains decorative until it reaches its home position.
    wordmark.tabIndex = -1;
    window.addEventListener('resize', positionTitle);
    input.addEventListener('input', () => input.setCustomValidity(''));

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const displayName = input.value.trim();
        if (!displayName) {
            input.setCustomValidity('Enter your name to get started.');
            input.reportValidity();
            return;
        }
        if (body.classList.contains('has-entered')) return;
        // Keep the display name separate from the technical PeerJS page ID.
        window.parachuteProfile = { displayName };
        try {
            sessionStorage.setItem('parachute.displayName', displayName);
        } catch {
            /* Retain the name in memory for this visit. */
        }
        const name = document.getElementById('sharing-name');
        name.textContent = displayName;
        name.title = `Sharing as ${displayName}`;
        name.hidden = false;
        input.blur();
        welcome.inert = true;
        body.classList.add('has-entered');
        // Connect only enters the sharing scene; nearby permissions come later.
        setTimeout(
            () => {
                welcome.hidden = true;
                for (const element of [tools, main]) element.inert = false;
                wordmark.removeAttribute('tabindex');
                tools.querySelector('summary').focus({ preventScroll: true });
            },
            reducedMotion.matches ? 0 : 1800
        );
    });
})();
