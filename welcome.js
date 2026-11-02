// The welcome screen is a higher view of the same sky, not a second page.
(() => {
    const body = document.body;
    const welcome = document.querySelector('.welcome');
    const form = document.getElementById('welcome-form');
    const input = document.getElementById('display-name');
    const wordmark = document.querySelector('.wordmark');
    const tools = document.querySelector('.header-tools');
    const main = document.querySelector('main');
    const button = document.getElementById('welcome-connect');
    const status = document.getElementById('welcome-status');
    const reload = document.getElementById('welcome-reload');
    reload.addEventListener('click', () => window.parachuteConnection.stopDiscovery());
    let starting = false;
    window.addEventListener('discovery-error', (event) => { status.textContent = event.detail; });
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

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const displayName = input.value.trim();
        if (!displayName) {
            input.setCustomValidity('Enter your name to get started.');
            input.reportValidity();
            return;
        }
        if (starting || body.classList.contains('has-entered')) return;
        starting = true;
        reload.hidden = false;
        button.disabled = input.disabled = true;
        button.textContent = 'Connecting…';
        const connected = await window.parachuteConnection.begin(displayName, (message) => {
            status.textContent = message;
        });
        starting = false;
        button.disabled = input.disabled = false;
        button.textContent = 'Connect';
        if (!connected) return;
        reload.hidden = true;
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
        // Discovery is ready and the five-second permission window has ended.
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
