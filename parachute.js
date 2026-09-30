/* A constant-speed delivery: moving it higher gives it farther to fall. */
(() => {
    const parachute = document.querySelector('.falling-parachute');
    const desk = document.querySelector('.desk');
    const duration = 15000;

    const artwork = parachute.querySelector('svg');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let fallSpeed = 0;
    let swayTime = 0;
    let lastFrame = null;
    let activePointer = null;
    let keyboardPaused = false;
    let grabOffsetX = 0;
    let grabOffsetY = 0;
    let x = 0;
    let y = 0;
    let landingY = 0;
    let finished = false;

    const clamp = (value, minimum, maximum) => {
        return Math.max(minimum, Math.min(value, maximum));
    };

    function measureScene() {
        const table = desk.getBoundingClientRect();

        // Below the rounded back edge, the tabletop is opaque at every x position.
        landingY = table.top + table.height * 0.3 + 8;
        x = clamp(x, 0, window.innerWidth - parachute.offsetWidth);
    }

    function render() {
        parachute.style.transform = `translate(${x}px, ${y}px)`;
        // Rock around the canopy while the delivery's path stays vertical.
        const angle = reducedMotion.matches ? 0 : Math.sin(swayTime / 650) * 7;
        artwork.style.transform = `rotate(${angle}deg)`;
    }

    function finishDelivery() {
        finished = true;
        if (document.activeElement === parachute) {
            document.querySelector('.wordmark').focus({ preventScroll: true });
        }
        parachute.hidden = true;
    }

    function animate(timestamp) {
        if (finished) return;

        const elapsed = lastFrame === null ? 0 : timestamp - lastFrame;
        lastFrame = timestamp;

        if (activePointer === null && !keyboardPaused) {
            y = Math.min(landingY, y + fallSpeed * elapsed);
            swayTime += elapsed;
            render();

            if (y >= landingY) {
                finishDelivery();
                return;
            }
        }

        requestAnimationFrame(animate);
    }

    parachute.addEventListener('pointerdown', (event) => {
        if (!event.isPrimary || event.button !== 0 || activePointer !== null) return;

        event.preventDefault();
        activePointer = event.pointerId;
        grabOffsetX = event.clientX - x;
        grabOffsetY = event.clientY - y;
        parachute.setPointerCapture(event.pointerId);
        parachute.classList.add('is-grabbed');
        parachute.setAttribute('aria-pressed', 'true');
    });

    parachute.addEventListener('pointermove', (event) => {
        if (event.pointerId !== activePointer) return;

        x = clamp(event.clientX - grabOffsetX, 0, window.innerWidth - parachute.offsetWidth);
        y = clamp(event.clientY - grabOffsetY, -parachute.offsetHeight, landingY);
        render();
    });

    function releasePointer(event) {
        if (event.pointerId !== activePointer) return;

        activePointer = null;
        lastFrame = null;
        parachute.classList.remove('is-grabbed');
        parachute.setAttribute('aria-pressed', String(keyboardPaused));

        if (parachute.hasPointerCapture(event.pointerId)) {
            parachute.releasePointerCapture(event.pointerId);
        }

        // A delivery dropped completely behind the table is no longer interactive.
        if (y >= landingY) finishDelivery();
    }

    parachute.addEventListener('pointerup', releasePointer);
    parachute.addEventListener('pointercancel', releasePointer);
    parachute.addEventListener('lostpointercapture', releasePointer);

    parachute.addEventListener('keydown', (event) => {
        if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            keyboardPaused = !keyboardPaused;
            parachute.setAttribute('aria-pressed', String(keyboardPaused));
            lastFrame = null;
        }

        const moves = {
            ArrowLeft: [-20, 0],
            ArrowRight: [20, 0],
            ArrowUp: [0, -20],
            ArrowDown: [0, 20]
        };
        const move = moves[event.key];
        if (!move) return;

        event.preventDefault();
        x = clamp(x + move[0], 0, window.innerWidth - parachute.offsetWidth);
        y = clamp(y + move[1], -parachute.offsetHeight, landingY);
        render();
        if (y >= landingY) finishDelivery();
    });

    window.addEventListener('resize', () => {
        if (finished) return;
        measureScene();
        render();
        if (y >= landingY) finishDelivery();
    });

    parachute.hidden = false;
    x = (window.innerWidth - parachute.offsetWidth) / 2;
    y = -parachute.offsetHeight;
    measureScene();
    fallSpeed = (landingY - y) / duration;
    render();
    requestAnimationFrame(animate);
})();
