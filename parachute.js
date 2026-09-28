/* One 15-second delivery. Dragging pauses its clock until it is released. */
(() => {
    const parachute = document.querySelector('.falling-parachute');
    const desk = document.querySelector('.desk');
    const duration = 15000;

    let remainingTime = duration;
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
            const step = Math.min(elapsed, remainingTime);

            // Recalculate the remaining path after a drag or viewport resize.
            y += (landingY - y) * (step / remainingTime);
            remainingTime -= step;
            render();

            if (remainingTime <= 0) {
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
        y = clamp(event.clientY - grabOffsetY, 0, window.innerHeight - parachute.offsetHeight);
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
        y = clamp(y + move[1], 0, landingY);
        render();
        if (y >= landingY) finishDelivery();
    });

    window.addEventListener('resize', () => {
        if (finished) return;
        measureScene();
        render();
    });

    parachute.hidden = false;
    x = (window.innerWidth - parachute.offsetWidth) / 2;
    y = -parachute.offsetHeight;
    measureScene();
    render();
    requestAnimationFrame(animate);
})();
