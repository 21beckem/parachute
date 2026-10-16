// Local microphone access only; no audio is recorded, played, or sent.
(() => {
    const button = document.getElementById('microphone-toggle');
    const label = document.getElementById('microphone-label');
    const status = document.getElementById('microphone-status');
    let stream = null;
    let generation = 0;

    function render(message = '') {
        const active = !!stream;
        button.setAttribute('aria-pressed', String(active));
        const action = active ? 'Turn microphone off' : 'Turn microphone on';
        button.setAttribute('aria-label', action);
        button.title = action;
        label.textContent = active ? 'Mic on' : 'Mic off';
        status.textContent = message;
        status.hidden = !message;
    }

    function stop(message = '') {
        generation++;
        const previous = stream;
        stream = null;
        previous?.getTracks().forEach(track => track.stop());
        button.disabled = false;
        render(message);
    }

    button.addEventListener('click', async () => {
        if (stream) {
            stop('Microphone off.');
            return;
        }
        if (!window.isSecureContext) {
            render('Microphone access requires HTTPS or localhost. Open this site using a secure address.');
            return;
        }
        if (!navigator.mediaDevices?.getUserMedia) {
            render('Microphone access is unavailable in this browser.');
            return;
        }

        const request = ++generation;
        button.disabled = true;
        label.textContent = 'Allow mic…';
        status.textContent = 'Allow microphone access in your browser when prompted.';
        status.hidden = false;
        try {
            const acquired = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            if (request !== generation) {
                acquired.getTracks().forEach(track => track.stop());
                return;
            }
            stream = acquired;
            stream.getAudioTracks().forEach(track => {
                track.addEventListener('ended', () => {
                    if (stream === acquired) stop('Microphone disconnected. Click to try again.');
                });
            });
            render('Microphone on. Audio stays on this device; nothing is recorded or sent.');
        } catch (error) {
            if (request !== generation) return;
            const messages = {
                NotAllowedError: 'Microphone access was denied. Allow it in your browser’s site settings, then try again.',
                NotFoundError: 'No microphone found. Connect a microphone and try again.',
                NotReadableError: 'The microphone is unavailable. Check whether another app is using it, then try again.'
            };
            render(messages[error.name] || 'Could not access the microphone. Check your device and try again.');
        } finally {
            if (request === generation) button.disabled = false;
        }
    });

    window.addEventListener('pagehide', () => stop());
})();
