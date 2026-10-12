/* Shared entry points; every drop owns its motion, events, and cleanup. */
class Animation {
    static deliveries = new Set();
    static initialized = false;
    static launching = false;
    static connecting = false;
    static previewing = false;
    static connectionVersion = 0;
    static boxTimer = null;
    static reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    static clamp(value, min, max) { return Math.max(min, Math.min(value, max)); }

    static initialize() {
        if (this.initialized) return;
        this.template = document.querySelector('.falling-parachute');
        this.rocket = document.querySelector('.rocket');
        this.rocketPad = document.querySelector('.rocket-pad');
        this.upload = document.querySelector('.rocket-upload input');
        this.box = document.querySelector('.drop-box');
        this.status = document.querySelector('.delivery-status');
        if (!this.template || !this.rocket || !this.box || !this.status) {
            throw new Error('Load parachute.js with defer, after the delivery markup is available.');
        }
        this.initialized = true;
        this.upload?.addEventListener('change', event => {
            const files = Array.from(event.target.files);
            if (files.length) this.launchRocketWithFile(files);
        });
        window.addEventListener('resize', () => {
            for (const delivery of this.deliveries) delivery.render();
        });
        document.addEventListener('visibilitychange', () => {
            for (const delivery of this.deliveries) delivery.last = null;
        });
    }

    static announce(message) { this.status.textContent = message; }
    static normalize(payload) {
        if (payload == null) return [];
        if (Array.isArray(payload)) return payload;
        if (typeof FileList !== 'undefined' && payload instanceof FileList) return Array.from(payload);
        return [payload];
    }

    static typeOf(payload) {
        const items = this.normalize(payload);
        if (items.length > 1) return 'folder';
        const item = items[0];
        const name = typeof item === 'string' ? item : item?.name || '';
        const mime = item?.type || '';
        if (/^https?:\/\//i.test(name)) return 'link';
        if (/\.(zip|rar|7z|tar|gz)$/i.test(name) || /zip|compressed|tar/.test(mime)) return 'folder';
        if (mime.startsWith('audio/') || /\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(name)) return 'music';
        if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|heic|avif)$/i.test(name)) return 'picture';
        if (mime.startsWith('video/') || /\.(mp4|webm|mov|avi|mkv)$/i.test(name)) return 'video';
        if (/\.(url|webloc)$/i.test(name)) return 'link';
        if (!item || mime.startsWith('text/') || /\.(pdf|txt|md|docx?|odt|rtf|csv|xlsx?|pptx?|json|js|html|css)$/i.test(name)) return 'file';
        return 'other';
    }

    static dropParachute(payload = [], type = this.typeOf(payload)) {
        this.initialize();
        const kinds = ['file', 'folder', 'music', 'link', 'picture', 'video', 'other'];
        if (!kinds.includes(type)) type = 'other';
        const delivery = new ParachuteDelivery(this.normalize(payload), type);
        this.deliveries.add(delivery);
        delivery.start();
        this.announce(`A ${type} parachute is arriving. Grab and release it over the box to receive it.`);
        return delivery;
    }
    static dropFile(payload) { return this.dropParachute(payload, 'file'); }
    static dropFolder(payload) { return this.dropParachute(payload, 'folder'); }
    static dropMusic(payload) { return this.dropParachute(payload, 'music'); }
    static dropLink(payload) { return this.dropParachute(payload, 'link'); }
    static dropPicture(payload) { return this.dropParachute(payload, 'picture'); }
    static dropVideo(payload) { return this.dropParachute(payload, 'video'); }
    static dropOther(payload) { return this.dropParachute(payload, 'other'); }

    static openBox() {
        clearTimeout(this.boxTimer);
        this.box.classList.remove('is-closed', 'is-receiving');
        this.box.setAttribute('aria-label', 'Open receiving box');
    }
    static updateTarget() {
        this.box.classList.toggle('is-drop-target', [...this.deliveries].some(d =>
            !d.receiving && (d.pointer !== null ? d.isPointOverBox(d.pointerX, d.pointerY) : d.paused && d.isFileOverBox())));
    }
    static receiveFileInBox(files = []) {
        this.initialize();
        this.box.classList.remove('is-receiving');
        void this.box.offsetWidth;
        const stillEntering = [...this.deliveries].some(delivery => delivery.receiving);
        this.box.classList.toggle('is-closed', !stillEntering);
        if (!stillEntering) this.box.classList.add('is-receiving');
        this.box.setAttribute('aria-label', stillEntering ? 'Open receiving box — receiving items' : 'Closed receiving box — item received');
        this.announce(`${files.length || 1} item${files.length > 1 ? 's' : ''} received in the box.`);
        this.box.dispatchEvent(new CustomEvent('file-received', { detail: { files } }));
        clearTimeout(this.boxTimer);
        this.boxTimer = setTimeout(() => this.openBox(), 3000);
    }

    // Connection hooks: preparation loops until connected or explicitly stopped.
    static startConnecting() {
        this.initialize();
        if (this.launching || this.connecting) return false;
        this.connectionVersion++;
        this.connecting = true;
        this.rocketPad.classList.add('is-connecting');
        this.announce('Connecting — rocket preparing for launch.');
        return true;
    }

    static stopConnecting() {
        this.initialize();
        this.connectionVersion++;
        this.connecting = false;
        this.rocketPad.classList.remove('is-connecting');
        this.announce('Rocket ready on the launch pad.');
    }

    static async launchRocket() {
        this.initialize();
        if (this.launching) return false;
        this.stopConnecting();
        this.launching = true;
        this.rocket.classList.add('is-launching');
        this.announce('Connected — rocket launching.');
        let flight;
        try {
            flight = this.rocket.animate(this.reducedMotion.matches ? [
                { opacity: 1 }, { opacity: 0 }
            ] : [
                { transform: 'translateY(0) rotate(0deg)', offset: 0 },
                { transform: `translateY(-${innerHeight + 260}px) rotate(-7deg)`, offset: 1 }
            ], { duration: this.reducedMotion.matches ? 200 : 1800, easing: 'cubic-bezier(.55,0,.8,.4)', fill: 'forwards' });
            await flight.finished;
        } finally {
            flight?.cancel();
            this.rocket.classList.remove('is-launching');
            this.launching = false;
        }
        return true;
    }

    static async launchRocketWithFile(files) {
        this.initialize();
        const payload = this.normalize(files);
        if (!this.upload || !payload.length || this.previewing || this.launching || this.connecting) return false;
        this.previewing = true;
        this.upload.disabled = true;
        try {
            this.startConnecting();
            const version = this.connectionVersion;
            this.announce('Local preview — preparing the rocket, then launching.');
            await new Promise(resolve => setTimeout(resolve, this.reducedMotion.matches ? 400 : 2200));
            if (version !== this.connectionVersion) return false;
            if (!await this.launchRocket()) return false;
            this.rocket.dispatchEvent(new CustomEvent('file-launched', { detail: { files: payload } }));
            this.dropParachute(payload);
            return true;
        } finally {
            this.upload.disabled = false;
            this.upload.value = '';
            this.previewing = false;
        }
    }
}

class ParachuteDelivery {
    constructor(files, type) {
        this.files = files;
        this.type = type;
        this.element = Animation.template.cloneNode(true);
        this.element.hidden = false;
        this.element.dataset.type = type;
        this.element.querySelector('.delivery-art').setAttribute('href', `#payload-${type}`);
        this.element.setAttribute('aria-label', `${type} delivery. Drag and release over the box. Space pauses or resumes, arrow keys move, Enter receives over the box.`);
        document.querySelector('.airspace').append(this.element);
        const width = this.element.offsetWidth;
        // Spread simultaneous deliveries across the sky without replacing older drops.
        const slot = [0, -1, 1, -2, 2][Animation.deliveries.size % 5];
        this.x = Animation.clamp((innerWidth - width) / 2 + slot * width * .7, 4, innerWidth - width - 4);
        this.y = 12;
        this.vx = this.vy = this.angle = this.angularVelocity = this.time = 0;
        this.pointer = this.last = this.frame = null;
        this.paused = this.disposed = this.receiving = false;
        this.events = new AbortController();
        const on = (type, handler) => this.element.addEventListener(type, handler, { signal: this.events.signal });
        on('pointerdown', event => {
            if (this.receiving || !event.isPrimary || event.button !== 0 || this.pointer !== null) return;
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
        on('pointermove', event => {
            if (event.pointerId !== this.pointer) return;
            this.pointerX = event.clientX;
            this.pointerY = event.clientY;
            this.targetX = Animation.clamp(event.clientX - this.offsetX, 0, innerWidth - this.element.offsetWidth);
            this.targetY = Animation.clamp(event.clientY - this.offsetY, 0, innerHeight - this.element.offsetHeight);
            Animation.updateTarget();
        });
        for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) on(type, event => this.release(event));
        on('keydown', event => this.keydown(event));
    }

    start() {
        this.render();
        this.frame = requestAnimationFrame(time => this.tick(time));
    }
    release(event) {
        if (this.pointer === null || event.pointerId !== this.pointer) return;
        const received = event.type === 'pointerup' && this.isPointOverBox(event.clientX, event.clientY);
        this.pointer = null;
        this.paused = false;
        // Preserve the spring's velocity: quick drags carry left or right after release.
        this.element.classList.remove('is-grabbed');
        this.element.setAttribute('aria-pressed', 'false');
        if (this.element.hasPointerCapture(event.pointerId)) this.element.releasePointerCapture(event.pointerId);
        if (received) return this.finish();
        else Animation.updateTarget();
    }
    keydown(event) {
        if (this.receiving) return;
        if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            if (event.key === 'Enter' && this.isFileOverBox()) return this.finish();
            this.paused = !this.paused;
            this.vx = this.vy = 0;
            this.element.setAttribute('aria-pressed', String(this.paused));
        }
        const move = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }[event.key];
        if (!move) return;
        event.preventDefault();
        this.x += move[0]; this.y += move[1];
        this.vx = move[0] * 5;
        this.vy = 0;
        this.render();
    }
    constrain() {
        const held = this.pointer !== null || this.paused;
        const w = this.element.offsetWidth, h = this.element.offsetHeight;
        const radians = this.angle * Math.PI / 180;
        const cosine = Math.cos(radians), sine = Math.sin(radians);
        const corners = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => [
            w / 2 + (x - w / 2) * cosine - (y - h * .12) * sine,
            h * .12 + (x - w / 2) * sine + (y - h * .12) * cosine
        ]);
        const x = Animation.clamp(this.x, 4 - Math.min(...corners.map(p => p[0])), innerWidth - Math.max(...corners.map(p => p[0])) - 4);
        const y = Animation.clamp(this.y, 4 - Math.min(...corners.map(p => p[1])), innerHeight - Math.max(...corners.map(p => p[1])) - 4);
        if (x !== this.x) {
            // Reflect only outward velocity, so rotation cannot flip an inward bounce.
            if (held) this.vx = 0;
            else if ((this.x < x && this.vx < 0) || (this.x > x && this.vx > 0)) this.vx *= -.8;
        }
        this.x = x;
        if (held) {
            if (y !== this.y) this.vy = 0;
            this.y = y;
        }
    }
    render() {
        this.constrain();
        this.element.style.transform = `translate(${this.x}px, ${this.y}px)`;
        this.element.querySelector('svg').style.transform = `rotate(${this.angle}deg)`;
        Animation.updateTarget();
    }
    isFileOverBox() {
        const w = this.element.offsetWidth, h = this.element.offsetHeight;
        const radians = this.angle * Math.PI / 180;
        const offset = h * (187.5 / 230 - .12);
        const x = this.x + w / 2 - offset * Math.sin(radians);
        const y = this.y + h * .12 + offset * Math.cos(radians);
        return this.isPointOverBox(x, y);
    }
    isPointOverBox(x, y) {
        // The main box rectangle excludes the decorative flaps outside its sides.
        const box = Animation.box.getBoundingClientRect();
        return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
    }
    tick(timestamp) {
        if (this.disposed || this.receiving) return;
        const dt = Math.min((timestamp - (this.last ?? timestamp)) / 1000, .032);
        this.last = timestamp;
        this.time += dt;
        const wind = Animation.reducedMotion.matches ? 0 : Math.sin(this.time * 1.7) * 18 + Math.sin(this.time * .63) * 12;
        if (this.pointer !== null) {
            const float = Animation.reducedMotion.matches ? 0 : Math.sin(this.time * 2.2) * 5;
            this.vx += ((this.targetX + wind * .35 - this.x) * 65 - this.vx * 12) * dt;
            this.vy += ((this.targetY + 7 + float - this.y) * 65 - this.vy * 12) * dt;
            this.x += this.vx * dt;
            this.y += this.vy * dt;
        } else if (!this.paused) {
            // Gentle air resistance preserves a throw, then gradually slows its drift.
            this.vx *= Math.exp(-.45 * dt);
            this.vy += (95 - this.vy * 2.5) * dt;
            this.x += this.vx * dt;
            this.y += this.vy * dt;
        }
        const desiredAngle = Animation.reducedMotion.matches ? 0 : Animation.clamp(-this.vx * .13 + wind * .18, -18, 18);
        this.angularVelocity += ((desiredAngle - this.angle) * 30 - this.angularVelocity * 7) * dt;
        this.angle += this.angularVelocity * dt;
        this.render();
        // Allow for the rotated canopy before removing an offscreen delivery.
        const margin = Math.max(this.element.offsetWidth, this.element.offsetHeight);
        if (this.pointer === null && !this.paused && this.y > innerHeight + margin) {
            this.cancel();
            return;
        }
        this.frame = requestAnimationFrame(time => this.tick(time));
    }
    async finish() {
        if (this.disposed || this.receiving) return;
        this.receiving = true;
        cancelAnimationFrame(this.frame);
        this.element.classList.remove('is-grabbed');
        this.element.classList.add('is-entering-box');
        Animation.openBox();
        Animation.updateTarget();
        const width = this.element.offsetWidth, height = this.element.offsetHeight;
        const box = Animation.box.getBoundingClientRect();
        const scale = Math.min(.85, (box.right - box.left - 24) / width);
        const x = (box.left + box.right - width * scale) / 2;
        const y = box.top - height * scale - 18;
        this.element.style.transformOrigin = '0 0';
        this.element.querySelector('svg').style.transform = 'rotate(0deg)';
        try {
            // Lift the exact held delivery above the rim, still in the foreground.
            this.receiptAnimation = this.element.animate(Animation.reducedMotion.matches ? [
                { opacity: 1 }, { opacity: 0 }
            ] : [
                { transform: `translate(${this.x}px, ${this.y}px) scale(1)` },
                { transform: `translate(${x}px, ${y}px) scale(${scale})` }
            ], { duration: Animation.reducedMotion.matches ? 120 : 480, easing: 'ease-out', fill: 'forwards' });
            await this.receiptAnimation.finished;
            if (this.disposed) return;
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
                const endScale = Math.min(scale, (Animation.box.offsetHeight - 48) / height);
                const endX = (boxWidth - width * endScale) / 2;
                const start = `translate(${startX}px, ${startY}px) scale(${scale})`;
                this.element.style.transform = start;
                this.receiptAnimation = this.element.animate([
                    { transform: start },
                    { transform: `translate(${endX}px, 40px) scale(${endScale})` }
                ], { duration: 650, easing: 'ease-in', fill: 'forwards' });
                await this.receiptAnimation.finished;
            }
        } catch {
            // Cancelling a delivery also cancels its pending receipt.
            this.cancel();
            return;
        }
        if (this.disposed) return;
        this.cancel();
        Animation.receiveFileInBox(this.files);
    }
    cancel() {
        if (this.disposed) return;
        this.disposed = true;
        this.receiptAnimation?.cancel();
        cancelAnimationFrame(this.frame);
        this.events.abort();
        if (this.pointer !== null && this.element.hasPointerCapture(this.pointer)) this.element.releasePointerCapture(this.pointer);
        this.pointer = null;
        if (document.activeElement === this.element) {
            (Animation.upload || document.querySelector('#send-parachute'))?.focus({ preventScroll: true });
        }
        this.element.remove();
        Animation.deliveries.delete(this);
        Animation.updateTarget();
    }
}

// Bound methods work even when passed directly as callbacks to other components.
const animation = Object.freeze(Object.fromEntries([
    'initialize', 'dropParachute', 'dropFile', 'dropFolder', 'dropMusic', 'dropLink',
    'dropPicture', 'dropVideo', 'dropOther', 'startConnecting', 'stopConnecting',
    'launchRocket', 'launchRocketWithFile', 'receiveFileInBox'
].map(name => [name, Animation[name].bind(Animation)])));
window.animation = animation;
window.ParachuteAnimation = Animation;
// Preserve this project's existing API; the lowercase facade is recommended.
window.Animation = Animation;
animation.initialize();
