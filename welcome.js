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
    let flight = null;
    let scannerReady = false;
    const cancelFlight = () => { flight?.cancel(); flight = null; };
    window.addEventListener('discovery-error', (event) => { cancelFlight(); status.textContent = event.detail; });
    window.addEventListener('discovery-warmup-error', cancelFlight);
    window.addEventListener('pagehide', cancelFlight);
    window.addEventListener('discovery-warmup-start', () => {
        if (!starting || flight) return;
        input.blur();
        flight = new window.ParachuteWelcomeFlight();
        if (scannerReady) flight.ready();
    });
    window.addEventListener('discovery-scanner-ready', () => {
        scannerReady = true;
        flight?.ready();
    });
    window.addEventListener('discovery-initialized', () => {
        if (!starting) status.textContent = 'Scanner ready. Enter your name and click Connect.';
    });
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

    try {
        input.value = sessionStorage.getItem('parachute.displayName') || '';
    } catch {
        /* The form still works when browser storage is unavailable. */
    }

    function positionTitle() {
        if (body.classList.contains('has-entered') || flight) return;
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
        scannerReady = false;
        reload.hidden = false;
        button.disabled = input.disabled = true;
        button.textContent = 'Connecting…';
        let connected = false;
        try {
            connected = await window.parachuteConnection.begin(displayName, (message) => {
                status.textContent = message;
            });
            if (connected && flight) connected = await flight.finished;
        } catch (error) {
            status.textContent = error.message || 'The scanner could not start. Reload to retry.';
        } finally {
            starting = false;
            button.disabled = input.disabled = false;
            button.textContent = 'Connect';
        }
        if (!connected) { cancelFlight(); positionTitle(); return; }
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
        const animated = !!flight;
        flight?.dispose();
        flight = null;
        // Discovery is ready and the five-second permission window has ended.
        setTimeout(
            () => {
                welcome.hidden = true;
                for (const element of [tools, main]) element.inert = false;
                wordmark.removeAttribute('tabindex');
                tools.querySelector('summary').focus({ preventScroll: true });
            },
            animated || reducedMotion.matches ? 0 : 1000
        );
    });
})();
