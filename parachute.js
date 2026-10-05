/* One controller for the local sending / receiving animation preview. */
class Animation {
    static parachute = document.querySelector('.falling-parachute');
    static rocket = document.querySelector('.rocket');
    static box = document.querySelector('.drop-box');
    static status = document.querySelector('.delivery-status');
    static reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    static delivery = null;
    static launching = false;
    static boxTimer = null;
    static frame = null;
    static clamp(value, min, max) { return Math.max(min, Math.min(value, max)); }

    static announce(message) { this.status.textContent = message; }

    static openBox() {
        clearTimeout(this.boxTimer);
        this.box.classList.remove('is-closed', 'is-receiving', 'is-drop-target');
        this.box.setAttribute('aria-label', 'Open receiving box');
    }

    static receiveFileInBox(files = []) {
        this.box.classList.remove('is-receiving', 'is-drop-target');
        // Restart the shake even if a second delivery arrives immediately.
        void this.box.offsetWidth;
        this.box.classList.add('is-closed', 'is-receiving');
        this.box.setAttribute('aria-label', 'Closed receiving box — file received');
        this.announce(files.length ? `${files.length} file${files.length === 1 ? '' : 's'} received in the preview box.` : 'Parachute received. The box is closed.');
        this.box.dispatchEvent(new CustomEvent('file-received', { detail: { files } }));
        clearTimeout(this.boxTimer);
        this.boxTimer = setTimeout(() => this.box.classList.remove('is-receiving'), 1000);
    }

    static dropParachute(files = []) {
        if (this.delivery?.pointer !== null && this.delivery?.pointer !== undefined) {
            this.parachute.releasePointerCapture(this.delivery.pointer);
        }
        cancelAnimationFrame(this.frame);
        this.openBox();
        this.parachute.hidden = false;
        this.parachute.classList.remove('is-grabbed');
        this.parachute.setAttribute('aria-pressed', 'false');
        const width = this.parachute.offsetWidth;
        this.delivery = {
            files: Array.isArray(files) ? files : [files],
            x: (innerWidth - width) / 2, y: 12,
            vx: 0, vy: 0, angle: 0, angularVelocity: 0,
            targetX: 0, targetY: 0, offsetX: 0, offsetY: 0,
            pointer: null, paused: false, time: 0, last: null
        };
        this.render();
        this.announce('A parachute is arriving. Grab it to play with the wind, then release it into the box.');
        this.frame = requestAnimationFrame(time => this.tick(time));
    }

    static constrain() {
        const d = this.delivery;
        const w = this.parachute.offsetWidth;
        const h = this.parachute.offsetHeight;
        // Account for the rotated artwork around its canopy pivot, not just the button.
        const radians = d.angle * Math.PI / 180;
        const cosine = Math.cos(radians), sine = Math.sin(radians);
        const corners = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => [
            w / 2 + (x - w / 2) * cosine - (y - h * .12) * sine,
            h * .12 + (x - w / 2) * sine + (y - h * .12) * cosine
        ]);
        const minX = Math.min(...corners.map(p => p[0]));
        const maxX = Math.max(...corners.map(p => p[0]));
        const minY = Math.min(...corners.map(p => p[1]));
        const maxY = Math.max(...corners.map(p => p[1]));
        const x = this.clamp(d.x, 4 - minX, innerWidth - maxX - 4);
        const y = this.clamp(d.y, 4 - minY, innerHeight - maxY - 4);
        if (x !== d.x) d.vx = 0;
        if (y !== d.y) d.vy = 0;
        d.x = x; d.y = y;
    }

    static render() {
        this.constrain();
        const d = this.delivery;
        this.parachute.style.transform = `translate(${d.x}px, ${d.y}px)`;
        this.parachute.querySelector('svg').style.transform = `rotate(${d.angle}deg)`;
        this.box.classList.toggle('is-drop-target', (d.pointer !== null || d.paused) && this.isFileOverBox());
    }

    static isFileOverBox() {
        const d = this.delivery;
        if (!d) return false;
        const w = this.parachute.offsetWidth;
        const h = this.parachute.offsetHeight;
        const angle = d.angle * Math.PI / 180;
        // Hit-test the hanging file, rather than the canopy or the mouse cursor.
        const fileOffset = h * (187.5 / 230 - .12);
        const fileX = d.x + w / 2 - fileOffset * Math.sin(angle);
        const fileY = d.y + h * .12 + fileOffset * Math.cos(angle);
        const box = this.box.getBoundingClientRect();
        return fileX >= box.left + 8 && fileX <= box.right - 8 &&
            fileY >= box.top && fileY <= box.top + 58;
    }

    static tick(timestamp) {
        const d = this.delivery;
        if (!d) return;
        const dt = Math.min((timestamp - (d.last ?? timestamp)) / 1000, .032);
        d.last = timestamp;
        d.time += dt;
        const wind = this.reducedMotion.matches ? 0 : Math.sin(d.time * 1.7) * 18 + Math.sin(d.time * .63) * 12;
        if (d.pointer !== null || d.paused) {
            if (d.pointer !== null) {
                // A damped spring carries the weight; a gentle gust continues while held.
                const float = this.reducedMotion.matches ? 0 : Math.sin(d.time * 2.2) * 5;
                d.vx += ((d.targetX + wind * .35 - d.x) * 65 - d.vx * 12) * dt;
                d.vy += ((d.targetY + 7 + float - d.y) * 65 - d.vy * 12) * dt;
                d.x += d.vx * dt;
                d.y += d.vy * dt;
            }
        } else {
            // Descend vertically wherever it was dropped. The viewport floor keeps
            // missed files visible and available to grab again.
            d.vx = 0;
            d.vy += (95 - d.vy * 2.5) * dt;
            d.y += d.vy * dt;
        }
        const desiredAngle = this.reducedMotion.matches ? 0 : this.clamp(-d.vx * .13 + wind * .18, -18, 18);
        d.angularVelocity += ((desiredAngle - d.angle) * 30 - d.angularVelocity * 7) * dt;
        d.angle += d.angularVelocity * dt;
        this.render();
        this.frame = requestAnimationFrame(time => this.tick(time));
    }

    static finishDelivery() {
        const files = this.delivery.files;
        cancelAnimationFrame(this.frame);
        if (document.activeElement === this.parachute) {
            document.querySelector('.rocket-upload input').focus({ preventScroll: true });
        }
        this.parachute.hidden = true;
        this.delivery = null;
        this.receiveFileInBox(files);
    }

    static async launchRocketWithFile(files) {
        const payload = Array.isArray(files) ? files : [files];
        if (!payload.length || this.launching) return false;
        this.launching = true;
        const input = this.rocket.querySelector('input');
        input.disabled = true;
        this.rocket.classList.add('is-launching');
        this.announce(`Launching ${payload.length} file${payload.length === 1 ? '' : 's'} in the local preview.`);
        const flight = this.rocket.animate(this.reducedMotion.matches ? [
            { opacity: 1 }, { opacity: 0 }
        ] : [
            { transform: 'translateY(0) rotate(0deg)', offset: 0 },
            { transform: 'translateY(3px) rotate(-3deg)', offset: .12 },
            { transform: 'translateY(0) rotate(3deg)', offset: .24 },
            { transform: `translateY(-${innerHeight + 260}px) rotate(-7deg)`, offset: 1 }
        ], { duration: this.reducedMotion.matches ? 200 : 1800, easing: 'cubic-bezier(.55,0,.8,.4)', fill: 'forwards' });
        try {
            await flight.finished;
            this.rocket.dispatchEvent(new CustomEvent('file-launched', { detail: { files: payload } }));
            this.dropParachute(payload);
        } finally {
            flight.cancel();
            this.rocket.classList.remove('is-launching');
            input.disabled = false;
            input.value = '';
            this.launching = false;
        }
        return true;
    }

    static initialize() {
        const parachute = this.parachute;
        parachute.addEventListener('pointerdown', event => {
            const d = this.delivery;
            if (!d || !event.isPrimary || event.button !== 0 || d.pointer !== null) return;
            event.preventDefault();
            d.pointer = event.pointerId;
            d.offsetX = event.clientX - d.x;
            d.offsetY = event.clientY - d.y;
            d.targetX = d.x; d.targetY = d.y;
            parachute.setPointerCapture(event.pointerId);
            parachute.classList.add('is-grabbed');
            parachute.setAttribute('aria-pressed', 'true');
        });
        parachute.addEventListener('pointermove', event => {
            const d = this.delivery;
            if (!d || event.pointerId !== d.pointer) return;
            d.targetX = this.clamp(event.clientX - d.offsetX, 0, innerWidth - parachute.offsetWidth);
            d.targetY = this.clamp(event.clientY - d.offsetY, 0, innerHeight - parachute.offsetHeight);
        });
        const release = event => {
            const d = this.delivery;
            if (!d || event.pointerId !== d.pointer) return;
            const placedInBox = event.type === 'pointerup' && this.isFileOverBox();
            d.pointer = null;
            d.paused = false;
            d.vx = 0;
            parachute.classList.remove('is-grabbed');
            parachute.setAttribute('aria-pressed', 'false');
            if (parachute.hasPointerCapture(event.pointerId)) parachute.releasePointerCapture(event.pointerId);
            if (placedInBox) this.finishDelivery();
            else this.box.classList.remove('is-drop-target');
        };
        ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => parachute.addEventListener(type, release));
        parachute.addEventListener('keydown', event => {
            const d = this.delivery;
            if (!d) return;
            if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault();
                if (event.key === 'Enter' && this.isFileOverBox()) {
                    this.finishDelivery();
                    return;
                }
                d.paused = !d.paused;
                d.vx = d.vy = 0;
                parachute.setAttribute('aria-pressed', String(d.paused));
            }
            const moves = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] };
            const move = moves[event.key];
            if (!move) return;
            event.preventDefault();
            d.x += move[0]; d.y += move[1];
            d.vx = d.vy = 0;
            this.render();
        });
        window.addEventListener('resize', () => { if (this.delivery) this.render(); });
        document.addEventListener('visibilitychange', () => { if (this.delivery) this.delivery.last = null; });
        this.rocket.querySelector('input').addEventListener('change', event => {
            const files = Array.from(event.target.files);
            if (files.length) this.launchRocketWithFile(files);
        });
        this.dropParachute();
    }
}

// Public animation API for future file transport integration.
window.Animation = Animation;
Animation.initialize();
