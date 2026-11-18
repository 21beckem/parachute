/* Shared entry points; every drop owns its motion, events, and cleanup. */
class Animation {
    static deliveries = new Set();
    static initialized = false;
    static launching = false;
    static connecting = false;
    static boxTimer = null;
    static WIND_INTERVAL = 10;
    static reducedMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)'
    );
    static clamp(value, min, max) {
        return Math.max(min, Math.min(value, max));
    }

    static windAt(time) {
        if (this.reducedMotion.matches || time < 0) return 0;
        const phase = time % this.WIND_INTERVAL;
        if (phase >= 1) return 0;
        const envelope = phase < .15 ? Math.sin(phase / .15 * Math.PI / 2)
            : phase > .8 ? Math.sin((1 - phase) / .2 * Math.PI / 2) : 1;
        return envelope * (Math.floor(time / this.WIND_INTERVAL) % 2 ? -1 : 1);
    }

    static deliverySway(time, direction = 1) {
        if (this.reducedMotion.matches) return { canopy: 0, payload: 0, tag: 0 };
        const sway = (delay, amplitude, strength) => Math.sin(Math.max(0, time - delay) * 2.4) * amplitude
            - this.windAt(time - delay) * direction * strength;
        // The tag leans downwind before the payload, canopy, and travel follow.
        return { tag: sway(0, 5, 9), payload: sway(.17, 2.4, 6), canopy: sway(.34, 1.6, 4) };
    }

    static initialize() {
        if (this.initialized) return;
        this.template = document.querySelector('.falling-parachute');
        this.rocket = document.querySelector('.rocket');
        this.rocketPad = document.querySelector('.rocket-pad');
        this.box = document.querySelector('.drop-box');
        this.status = document.querySelector('.delivery-status');
        if (!this.template || !this.rocket || !this.box || !this.status) {
            throw new Error(
                'Load parachute.js with defer, after the delivery markup is available.'
            );
        }
        this.initialized = true;
        window.addEventListener('resize', () => {
            for (const delivery of this.deliveries) delivery.render();
        });
        document.addEventListener('visibilitychange', () => {
            for (const delivery of this.deliveries) delivery.last = null;
        });
    }

    static announce(message) {
        this.status.textContent = message;
    }
    static normalize(payload) {
        if (payload == null) return [];
        if (Array.isArray(payload)) return payload;
        if (typeof FileList !== 'undefined' && payload instanceof FileList)
            return Array.from(payload);
        return [payload];
    }

    static typeOf(payload) {
        const items = this.normalize(payload);
        if (items.length > 1) return 'folder';
        const item = items[0];
        const name = typeof item === 'string' ? item : item?.name || '';
        const mime = item?.type || '';
        if (/^https?:\/\//i.test(name)) return 'link';
        if (
            /\.(zip|rar|7z|tar|gz)$/i.test(name) ||
            /zip|compressed|tar/.test(mime)
        )
            return 'folder';
        if (
            mime.startsWith('audio/') ||
            /\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(name)
        )
            return 'music';
        if (
            mime.startsWith('image/') ||
            /\.(png|jpe?g|gif|webp|svg|heic|avif)$/i.test(name)
        )
            return 'picture';
        if (
            mime.startsWith('video/') ||
            /\.(mp4|webm|mov|avi|mkv)$/i.test(name)
        )
            return 'video';
        if (/\.(url|webloc)$/i.test(name)) return 'link';
        if (
            !item ||
            mime.startsWith('text/') ||
            /\.(pdf|txt|md|docx?|odt|rtf|csv|xlsx?|pptx?|json|js|html|css)$/i.test(
                name
            )
        )
            return 'file';
        return 'other';
    }

    static dropParachute(payload = [], type = this.typeOf(payload), options = {}) {
        this.initialize();
        const kinds = [
            'file',
            'folder',
            'music',
            'link',
            'picture',
            'video',
            'other'
        ];
        if (!kinds.includes(type)) type = 'other';
        const delivery = new ParachuteDelivery(this.normalize(payload), type, options);
        this.deliveries.add(delivery);
        delivery.start();
        this.announce(
            `A ${type} parachute is arriving. Grab and release it over the box to receive it.`
        );
        return delivery;
    }
    static dropFile(payload) {
        return this.dropParachute(payload, 'file');
    }
    static dropFolder(payload) {
        return this.dropParachute(payload, 'folder');
    }
    static dropMusic(payload) {
        return this.dropParachute(payload, 'music');
    }
    static dropLink(payload) {
        return this.dropParachute(payload, 'link');
    }
    static dropPicture(payload) {
        return this.dropParachute(payload, 'picture');
    }
    static dropVideo(payload) {
        return this.dropParachute(payload, 'video');
    }
    static dropOther(payload) {
        return this.dropParachute(payload, 'other');
    }

    static openBox() {
        clearTimeout(this.boxTimer);
        this.box.classList.remove('is-closed', 'is-receiving');
        this.box.setAttribute('aria-label', 'Open receiving box');
    }
    static updateTarget() {
        this.box.classList.toggle(
            'is-drop-target',
            [...this.deliveries].some(
                (d) =>
                    !d.receiving && !d.unavailable &&
                    (d.pointer !== null
                        ? d.isPointOverBox(d.pointerX, d.pointerY)
                        : d.paused && d.isFileOverBox())
            )
        );
    }
    static receiveFileInBox(files = []) {
        this.initialize();
        this.box.classList.remove('is-receiving');
        void this.box.offsetWidth;
        const stillEntering = [...this.deliveries].some(
            (delivery) => delivery.receiving
        );
        this.box.classList.toggle('is-closed', !stillEntering);
        if (!stillEntering) this.box.classList.add('is-receiving');
        this.box.setAttribute(
            'aria-label',
            stillEntering
                ? 'Open receiving box — receiving items'
                : 'Closed receiving box — item received'
        );
        this.announce(
            `${files.length || 1} item${files.length > 1 ? 's' : ''} received in the box.`
        );
        this.box.dispatchEvent(
            new CustomEvent('file-received', { detail: { files } })
        );
        clearTimeout(this.boxTimer);
        this.boxTimer = setTimeout(() => this.openBox(), 3000);
    }

    // Connection hooks: preparation loops until connected or explicitly stopped.
    static startConnecting() {
        this.initialize();
        if (this.launching || this.connecting) return false;
        this.connecting = true;
        this.rocketPad.classList.add('is-connecting');
        this.announce('Connecting — rocket preparing for launch.');
        return true;
    }

    static stopConnecting() {
        this.initialize();
        this.connecting = false;
        this.rocketPad.classList.remove('is-connecting');
        this.announce('Rocket ready on the launch pad.');
    }

    static createLaunchSmoke() {
        const layer = document.createElement('div');
        layer.className = 'launch-exhaust';
        layer.setAttribute('aria-hidden', 'true');
        document.body.append(layer);
        const rect = this.rocket.getBoundingClientRect();
        const engineX = (rect.left + rect.right) / 2;
        const engineY = rect.top + (rect.bottom - rect.top) * 310 / 360;
        // The box anchors the main plume; individual puffs can drift beyond it.
        const box = this.box.getBoundingClientRect();
        const smokeTop = Math.max(0, Math.min(innerHeight, (box.top + box.bottom) / 2));
        const size = Math.min(innerWidth * .24, Math.max(1, innerHeight - smokeTop) * 1.5);
        const rightEdge = innerWidth * .75;
        const flights = [];
        for (let row = 0; row < 2; row++) for (let col = 0; col < 7; col++) {
            const cloud = document.createElement('span');
            cloud.className = 'launch-cloud';
            const width = size * (1 + ((col * 3 + row) % 4) * .08);
            const height = width * (.62 + (col % 3) * .06);
            cloud.style.width = `${width}px`;
            cloud.style.height = `${height}px`;
            cloud.style.borderRadius = col % 2
                ? '54% 46% 58% 42% / 45% 56% 44% 55%'
                : '45% 55% 43% 57% / 58% 43% 57% 42%';
            const targetX = col / 6 * Math.max(0, rightEdge - width * .55) + Math.sin(col * 2 + row) * width * .07;
            const targetY = smokeTop + height * (row ? 1.25 : .62) + Math.sin(col * 1.7) * height * .1;
            const driftX = (col - 2.5) * width * .08;
            const driftY = height * (.22 + (col % 3) * .09);
            const delay = col * 55 + row * 130;
            const transform = (x, y, scale) => `translate(${x - width / 2}px, ${y - height / 2}px) scale(${scale})`;
            layer.append(cloud);
            flights.push(cloud.animate([
                { transform: transform(engineX, engineY, .03), opacity: 0, offset: 0 },
                { transform: transform(engineX + (col - 3) * 3, engineY + 10, .2), opacity: .8, offset: .12 },
                { transform: transform(targetX, targetY, .78), opacity: .78, offset: .4 },
                { transform: transform(targetX + driftX * .45, targetY - driftY * .4, 1.12), opacity: .35, offset: .7 },
                { transform: transform(targetX + driftX, targetY - driftY, 1.5), opacity: 0, offset: 1 }
            ], { duration: 3400 + (col % 3) * 220 + row * 300, delay, easing: 'ease-out', fill: 'both' }));
        }
        let removed = false;
        const clear = () => {
            if (removed) return;
            removed = true;
            for (const flight of flights) flight.cancel();
            layer.remove();
        };
        // Smoke finishes on its own, after the rocket has already left the screen.
        void Promise.allSettled(flights.map(flight => flight.finished)).then(clear);
        return clear;
    }

    static async launchRocket() {
        this.initialize();
        if (this.launching) return false;
        this.stopConnecting();
        this.launching = true;
        this.rocket.classList.add('is-launching');
        this.announce('Connected — rocket launching.');
        let flight, clearSmoke, completed = false;
        try {
            if (!this.reducedMotion.matches) clearSmoke = this.createLaunchSmoke();
            flight = this.rocket.animate(
                this.reducedMotion.matches
                    ? [{ opacity: 1 }, { opacity: 0 }]
                    : [
                          {
                              transform: 'translateY(0) rotate(0deg)',
                              offset: 0
                          },
                          {
                              transform: `translateY(-${innerHeight + 260}px) rotate(-7deg)`,
                              offset: 1
                          }
                      ],
                {
                    duration: this.reducedMotion.matches ? 200 : 1800,
                    easing: 'cubic-bezier(.55,0,.8,.4)',
                    fill: 'forwards'
                }
            );
            await flight.finished;
            completed = true;
        } finally {
            flight?.cancel();
            if (!completed) clearSmoke?.();
            this.rocket.classList.remove('is-launching');
            this.launching = false;
        }
        return true;
    }
}

class ParachuteDelivery {
    constructor(files, type, options = {}) {
        this.files = files;
        this.type = type;
        this.options = options;
        this.element = Animation.template.cloneNode(true);
        this.element.hidden = false;
        this.element.dataset.type = type;
        this.element
            .querySelector('.delivery-art')
            .setAttribute('href', `#payload-${type}`);
        this.element.setAttribute(
            'aria-label',
            `${type} delivery. Drag and release over the box. Space pauses or resumes, arrow keys move, Enter receives over the box.`
        );
        document.querySelector('.airspace').append(this.element);
        const width = this.element.offsetWidth;
        // Use the broad upper sky, keeping the full canopy away from both corners.
        const inset = Math.max(24, innerWidth * .1);
        const span = Math.max(0, innerWidth - width - inset * 2);
        this.x = span ? inset + Math.random() * span : Math.max(0, (innerWidth - width) / 2);
        this.windDirection = this.visualWindDirection = 1;
        this.windGraceUntil = 0;
        // Include the hanging tag so the whole delivery starts outside the viewport.
        this.y = -this.element.offsetHeight - 80;
        this.enteringViewport = true;
        this.vy = 140;
        this.vx = this.angle = this.angularVelocity = this.time = 0;
        this.pointer = this.last = this.frame = null;
        this.paused = this.disposed = this.receiving = false;
        this.events = new AbortController();
        const on = (type, handler) =>
            this.element.addEventListener(type, handler, {
                signal: this.events.signal
            });
        on('pointerdown', (event) => {
            if (
                this.unavailable ||
                this.receiving ||
                !event.isPrimary ||
                event.button !== 0 ||
                this.pointer !== null
            )
                return;
            event.preventDefault();
            this.pointer = event.pointerId;
            this.pointerX = event.clientX;
            this.pointerY = event.clientY;
            this.paused = false;
            this.offsetX = event.clientX - this.x;
            this.offsetY = event.clientY - this.y;
            this.targetX = this.x;
            this.targetY = this.y;
            this.element.setPointerCapture(event.pointerId);
            this.element.classList.add('is-grabbed');
            this.element.setAttribute('aria-pressed', 'true');
            Animation.updateTarget();
        });
        on('pointermove', (event) => {
            if (event.pointerId !== this.pointer) return;
            this.pointerX = event.clientX;
            this.pointerY = event.clientY;
            this.targetX = Animation.clamp(
                event.clientX - this.offsetX,
                0,
                innerWidth - this.element.offsetWidth
            );
            this.targetY = Animation.clamp(
                event.clientY - this.offsetY,
                0,
                innerHeight - this.element.offsetHeight
            );
            Animation.updateTarget();
        });
        for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
            on(type, (event) => this.release(event));
        on('keydown', (event) => this.keydown(event));
    }

    start() {
        this.render();
        this.frame = requestAnimationFrame((time) => this.tick(time));
    }
    release(event) {
        if (this.unavailable) return;
        if (this.pointer === null || event.pointerId !== this.pointer) return;
        const received =
            event.type === 'pointerup' &&
            this.isPointOverBox(event.clientX, event.clientY);
        this.pointer = null;
        this.paused = false;
        this.windGraceUntil = this.time + .6;
        // Preserve the spring's velocity: quick drags carry left or right after release.
        this.element.classList.remove('is-grabbed');
        this.element.setAttribute('aria-pressed', 'false');
        if (this.element.hasPointerCapture(event.pointerId))
            this.element.releasePointerCapture(event.pointerId);
        if (received) return this.finish();
        else Animation.updateTarget();
    }
    keydown(event) {
        if (this.receiving || this.unavailable) return;
        if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            if (event.key === 'Enter' && this.isFileOverBox())
                return this.finish();
            this.paused = !this.paused;
            this.vx = this.vy = 0;
            this.element.setAttribute('aria-pressed', String(this.paused));
        }
        const move = {
            ArrowLeft: [-20, 0],
            ArrowRight: [20, 0],
            ArrowUp: [0, -20],
            ArrowDown: [0, 20]
        }[event.key];
        if (!move) return;
        event.preventDefault();
        this.x += move[0];
        this.y += move[1];
        this.vx = move[0] * 5;
        this.vy = 0;
        this.render();
    }
    constrain() {
        const held = this.pointer !== null || this.paused;
        const w = this.element.offsetWidth,
            h = this.element.offsetHeight;
        const radians = (this.angle * Math.PI) / 180;
        const cosine = Math.cos(radians),
            sine = Math.sin(radians);
        const corners = [
            [0, 0],
            [w, 0],
            [0, h],
            [w, h]
        ].map(([x, y]) => [
            w / 2 + (x - w / 2) * cosine - (y - h * 0.12) * sine,
            h * 0.12 + (x - w / 2) * sine + (y - h * 0.12) * cosine
        ]);
        const tag = this.element.querySelector('.delivery-offer-label');
        const inset = Math.min(Math.max(12, innerWidth * .025), 24)
            + Math.max(0, ((tag?.offsetWidth || w) - w) / 2);
        const x = Animation.clamp(
            this.x,
            inset - Math.min(...corners.map((p) => p[0])),
            innerWidth - Math.max(...corners.map((p) => p[0])) - inset
        );
        const y = Animation.clamp(
            this.y,
            4 - Math.min(...corners.map((p) => p[1])),
            innerHeight - Math.max(...corners.map((p) => p[1])) - 4
        );
        if (x !== this.x) {
            // Reflect only outward velocity, so rotation cannot flip an inward bounce.
            if (held) this.vx = 0;
            else {
                const inward = this.x < x ? 1 : -1;
                if (this.vx * inward <= 0) {
                    this.vx = inward * Math.max(18, Math.min(54, Math.abs(this.vx) * .35));
                    const cycleDirection = Math.floor(Math.max(0, this.time - .18) / Animation.WIND_INTERVAL) % 2 ? -1 : 1;
                    this.windDirection = inward * cycleDirection;
                    this.windGraceUntil = this.time + .45;
                }
            }
        }
        this.x = x;
        if (held && (this.y >= 0 || this.pointer !== null)) {
            if (y !== this.y) this.vy = 0;
            this.y = y;
        }
    }
    render() {
        this.constrain();
        this.element.style.transform = `translate(${this.x}px, ${this.y}px)`;
        this.element.querySelector('svg').style.transform =
            `rotate(${this.angle}deg)`;
        this.renderSway();
        Animation.updateTarget();
    }
    renderSway(still = false) {
        const pose = still || this.unavailable ? { canopy: 0, payload: 0, tag: 0 } : Animation.deliverySway(this.time, this.visualWindDirection);
        const factor = this.pointer !== null ? .35 : 1;
        const payloadAngle = pose.payload * factor;
        this.element.querySelector('.delivery-canopy').style.transform = `rotate(${pose.canopy * factor}deg)`;
        this.element.querySelector('.delivery-payload').style.transform = `rotate(${payloadAngle}deg)`;
        const tag = this.element.querySelector('.delivery-offer-label');
        if (!tag) return;
        const ends = { file: 224, folder: 226, music: 225, link: 209, picture: 228, video: 223, other: 222 };
        const radians = payloadAngle * Math.PI / 180;
        const length = (ends[this.type] || 224) - 158;
        const x = -length * Math.sin(radians);
        const y = 158 + length * Math.cos(radians) - 27.6;
        const angle = still ? 0 : this.angle;
        const tilt = angle * Math.PI / 180;
        const scale = this.element.offsetWidth / 200;
        tag.style.left = `${(100 + x * Math.cos(tilt) - y * Math.sin(tilt)) * scale}px`;
        tag.style.top = `${(27.6 + x * Math.sin(tilt) + y * Math.cos(tilt)) * scale + 4}px`;
        tag.style.transform = `translateX(-50%) rotate(${Animation.clamp(angle + payloadAngle + pose.tag * factor, -30, 30)}deg)`;
    }
    isFileOverBox() {
        const w = this.element.offsetWidth,
            h = this.element.offsetHeight;
        const radians = (this.angle * Math.PI) / 180;
        const offset = h * (187.5 / 230 - 0.12);
        const x = this.x + w / 2 - offset * Math.sin(radians);
        const y = this.y + h * 0.12 + offset * Math.cos(radians);
        return this.isPointOverBox(x, y);
    }
    isPointOverBox(x, y) {
        // The main box rectangle excludes the decorative flaps outside its sides.
        const box = Animation.box.getBoundingClientRect();
        return (
            x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
        );
    }
    tick(timestamp) {
        if (this.disposed || this.receiving) return;
        const dt = Math.min(
            (timestamp - (this.last ?? timestamp)) / 1000,
            0.032
        );
        this.last = timestamp;
        this.time += dt;
        const wind = Animation.reducedMotion.matches
            ? 0
            : Math.sin(this.time * 1.7) * 18 + Math.sin(this.time * 0.63) * 12;
        if (this.pointer !== null) {
            const float = Animation.reducedMotion.matches
                ? 0
                : Math.sin(this.time * 2.2) * 5;
            this.vx +=
                ((this.targetX + wind * 0.35 - this.x) * 65 - this.vx * 12) *
                dt;
            this.vy +=
                ((this.targetY + 7 + float - this.y) * 65 - this.vy * 12) * dt;
            this.x += this.vx * dt;
            this.y += this.vy * dt;
        } else if (this.unavailable) {
            // A torn canopy no longer provides lift or limits the falling speed.
            this.vx *= Math.exp(-1.5 * dt);
            this.vy = Math.min(1000, this.vy + 1150 * dt);
            this.x += this.vx * dt;
            this.y += this.vy * dt;
        } else if (!this.paused) {
            // A gust carries the delivery for a second; grabs and fresh throws stay in control.
            if (this.time < this.windGraceUntil || Animation.reducedMotion.matches) {
                this.vx *= Math.exp(-.45 * dt);
            } else {
                const gust = Animation.windAt(this.time - .18) * this.windDirection;
                const speed = Math.min(50, innerWidth * .09);
                const drag = gust ? 3 : 2.2;
                this.vx *= Math.exp(-drag * dt);
                this.vx += gust * speed * 3 * dt;
            }
            if (this.enteringViewport && this.y < 0) {
                const reveal = Animation.clamp((this.y + this.element.offsetHeight * .4) / (this.element.offsetHeight * .4), 0, 1);
                this.vy += (38 + 102 * (1 - reveal) - this.vy) * Math.min(1, 6 * dt);
            } else {
                this.enteringViewport = false;
                this.vy += (95 - this.vy * 2.5) * dt;
            }
            this.x += this.vx * dt;
            this.y += this.vy * dt;
        }
        const desiredAngle = Animation.reducedMotion.matches
            ? 0
            : this.unavailable ? Math.sin(this.time * 7) * 9
            : Animation.clamp(-this.vx * 0.13 + wind * 0.18, -18, 18);
        this.angularVelocity +=
            ((desiredAngle - this.angle) * 30 - this.angularVelocity * 7) * dt;
        this.angle += this.angularVelocity * dt;
        this.visualWindDirection += (this.windDirection - this.visualWindDirection) * Math.min(1, 7 * dt);
        this.render();
        // Allow for the rotated canopy before removing an offscreen delivery.
        const margin = Math.max(
            this.element.offsetWidth,
            this.element.offsetHeight
        );
        if (
            this.pointer === null &&
            !this.paused &&
            this.y > innerHeight + margin
        ) {
            this.cancel(this.unavailable ? 'disconnected' : 'missed');
            return;
        }
        this.frame = requestAnimationFrame((time) => this.tick(time));
    }
    async finish() {
        if (this.disposed || this.receiving || this.unavailable) return;
        this.receiving = true;
        cancelAnimationFrame(this.frame);
        this.element.classList.remove('is-grabbed');
        this.element.classList.add('is-entering-box');
        Animation.openBox();
        Animation.updateTarget();
        const width = this.element.offsetWidth,
            height = this.element.offsetHeight;
        const box = Animation.box.getBoundingClientRect();
        const scale = Math.min(0.85, (box.right - box.left - 24) / width);
        const x = (box.left + box.right - width * scale) / 2;
        const y = box.top - height * scale - 18;
        this.element.style.transformOrigin = '0 0';
        this.element.querySelector('svg').style.transform = 'rotate(0deg)';
        this.renderSway(true);
        try {
            // Lift the exact held delivery above the rim, still in the foreground.
            this.receiptAnimation = this.element.animate(
                Animation.reducedMotion.matches
                    ? [{ opacity: 1 }, { opacity: 0 }]
                    : [
                          {
                              transform: `translate(${this.x}px, ${this.y}px) scale(1)`
                          },
                          {
                              transform: `translate(${x}px, ${y}px) scale(${scale})`
                          }
                      ],
                {
                    duration: Animation.reducedMotion.matches ? 120 : 480,
                    easing: 'ease-out',
                    fill: 'forwards'
                }
            );
            await this.receiptAnimation.finished;
            if (this.disposed || this.unavailable) return;
            if (!Animation.reducedMotion.matches) {
                // Place it inside the box's stacking context: back (0), delivery (1), front (2).
                // Local coordinates keep the descent attached to the box during layout changes.
                this.receiptAnimation.cancel();
                this.element.style.width = `${width}px`;
                Animation.box.append(this.element);
                this.element.classList.add('is-inside-box');
                const boxWidth = Animation.box.offsetWidth;
                const startX = (boxWidth - width * scale) / 2;
                const startY = -height * scale - 18;
                const endScale = Math.min(
                    scale,
                    (Animation.box.offsetHeight - 48) / height
                );
                const endX = (boxWidth - width * endScale) / 2;
                const start = `translate(${startX}px, ${startY}px) scale(${scale})`;
                this.element.style.transform = start;
                this.receiptAnimation = this.element.animate(
                    [
                        { transform: start },
                        {
                            transform: `translate(${endX}px, 40px) scale(${endScale})`
                        }
                    ],
                    { duration: 650, easing: 'ease-in', fill: 'forwards' }
                );
                await this.receiptAnimation.finished;
            }
        } catch {
            // Cancelling a delivery also cancels its pending receipt.
            if (!this.unavailable) this.cancel();
            return;
        }
        if (this.disposed || this.unavailable) return;
        this.cancel('received');
        if (this.options.onCatch) this.options.onCatch();
        else Animation.receiveFileInBox(this.files);
    }
    disconnect() {
        if (this.disposed || this.unavailable) return;
        this.unavailable = true;
        if (this.receiving) {
            const rect = this.element.getBoundingClientRect();
            this.x = rect.left;
            this.y = rect.top;
        }
        this.receiving = this.paused = false;
        this.events.abort();
        const pointer = this.pointer;
        this.pointer = null;
        if (pointer !== null && this.element.hasPointerCapture(pointer))
            this.element.releasePointerCapture(pointer);
        this.receiptAnimation?.cancel();
        this.element.classList.remove('is-grabbed', 'is-entering-box', 'is-inside-box', 'is-offer');
        this.element.classList.add('is-disconnected');
        this.element.disabled = true;
        this.element.tabIndex = -1;
        this.element.setAttribute('aria-disabled', 'true');
        this.element.setAttribute('aria-pressed', 'false');
        this.element.setAttribute('aria-label', 'Sender disconnected. Torn parachute falling away.');
        this.element.querySelector('use').setAttribute('href', '#parachute-damaged');
        document.querySelector('.airspace').append(this.element);
        if (document.activeElement === this.element)
            document.querySelector('#send-parachute')?.focus({ preventScroll: true });
        this.vx = Animation.clamp(this.vx, -70, 70);
        this.vy = Math.max(90, this.vy);
        this.last = null;
        cancelAnimationFrame(this.frame);
        this.render();
        this.frame = requestAnimationFrame((time) => this.tick(time));
    }

    cancel(reason = 'cancelled') {
        if (this.disposed) return;
        this.disposed = true;
        this.receiptAnimation?.cancel();
        cancelAnimationFrame(this.frame);
        this.events.abort();
        if (
            this.pointer !== null &&
            this.element.hasPointerCapture(this.pointer)
        )
            this.element.releasePointerCapture(this.pointer);
        this.pointer = null;
        if (document.activeElement === this.element) {
            document
                .querySelector('#send-parachute')
                ?.focus({ preventScroll: true });
        }
        this.element.remove();
        Animation.deliveries.delete(this);
        Animation.updateTarget();
        if (reason !== 'received') this.options.onExpire?.(reason);
    }
}

// Bound methods work even when passed directly as callbacks to other components.
const animation = Object.freeze(
    Object.fromEntries(
        [
            'initialize',
            'dropParachute',
            'dropFile',
            'dropFolder',
            'dropMusic',
            'dropLink',
            'dropPicture',
            'dropVideo',
            'dropOther',
            'startConnecting',
            'stopConnecting',
            'launchRocket',
            'receiveFileInBox'
        ].map((name) => [name, Animation[name].bind(Animation)])
    )
);
window.animation = animation;
window.ParachuteAnimation = Animation;
animation.initialize();
