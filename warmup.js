// A flight through the existing sky, timed from sensor acceptance.
class ParachuteWelcomeFlight {
    constructor() {
        this.active = true;
        this.effects = [];
        this.body = document.body;
        this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
        this.scannerReady = new Promise(resolve => { this.ready = resolve; });
        this.finished = new Promise(resolve => { this.resolve = resolve; });
        const logo = document.querySelector('.wordmark .brand-icon');
        const rect = logo.getBoundingClientRect();
        this.rect = rect;
        this.icon = document.createElement('div');
        this.icon.className = 'warmup-parachute';
        this.icon.setAttribute('aria-hidden', 'true');
        Object.assign(this.icon.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
        this.icon.append(logo.cloneNode(true));
        this.body.append(this.icon);
        this.glass = document.createElement('div');
        this.glass.className = 'warmup-lens-glass';
        this.glass.setAttribute('aria-hidden', 'true');
        const cracks = document.createElement('img');
        cracks.src = 'lens-cracks.svg';
        cracks.alt = '';
        cracks.className = 'warmup-lens-cracks';
        this.glass.append(cracks);
        this.body.append(this.glass);
        this.body.classList.add('is-warming');
        void this.fly();
    }

    animate(element, frames, options) {
        const effect = element.animate(frames, options);
        // Every visual effect is also cancelled on errors or page exit.
        void effect.finished.catch(() => {});
        this.effects.push(effect);
        return effect;
    }

    async fly() {
        try {
            const r = this.rect;
            const dx = innerWidth / 2 - (r.left + r.width / 2);
            // The cloud sits around (50%, 80%) in the existing logo artwork.
            // Bring that point to the lens, rather than aiming the canopy at it.
            const dy = innerHeight * .5 - (r.top + r.height * .8);
            // Keep the complete silhouette in view for most of the approach.
            const near = Math.max(1, Math.min(innerWidth * .72 / r.width, innerHeight * .65 / r.height));
            const pose = (x, y, scale, angle) => `translate(${x}px, ${y}px) rotate(${angle}deg) scale(${scale})`;
            // Move immediately, then gently stop growing as the wind takes over.
            const frames = Array.from({ length: 61 }, (_, i) => {
                const t = i / 60;
                const travel = t * t * (3 - 2 * t);
                const sway = Math.sin(t * Math.PI);
                const tail = Math.max(0, t - .8);
                const growth = t <= .8 ? t / .9 : (.8 + tail - tail * tail / .4) / .9;
                return { offset: t, transform: pose(
                    dx * travel + Math.sin(t * Math.PI * 2) * 14 * sway,
                    dy * travel + Math.sin(t * Math.PI * 3) * 9 * sway,
                    1 + (near - 1) * growth,
                    Math.sin(t * Math.PI * 2) * 4 * sway
                ) };
            });
            const approach = this.animate(this.icon, this.reduced ? [{ opacity: 1 }, { opacity: 1 }] : frames,
                { duration: 3500, fill: 'forwards', easing: 'linear' });
            await approach.finished;
            if (!this.active) return;
            this.body.classList.add('is-camera-knocked');
            // The parachute shares the camera knock and stays at the contact
            // point during the stun, so the collision remains visually connected.
            const contact = pose(dx, dy, near, 0);
            const held = pose(dx, dy + 38, near, 0);
            const knockTiming = { duration: 200, fill: 'forwards', easing: 'cubic-bezier(.15,.7,.3,1)' };
            this.animate(this.icon, this.reduced ? [{ opacity: 1 }, { opacity: 1 }] : [
                { transform: contact }, { transform: held }
            ], knockTiming);
            const scenery = document.querySelector('.scenery');
            const header = document.querySelector('.site-header');
            const knocked = 'translateY(38px) rotate(-.4deg)';
            const knock = this.animate(scenery, this.reduced ? [{ opacity: 1 }, { opacity: 1 }] : [
                { transform: 'translateY(0) rotate(0deg)' }, { transform: knocked }
            ], knockTiming);
            if (!this.reduced) this.animate(header, [
                { transform: 'translateY(0) rotate(0deg)' }, { transform: 'translateY(18px) rotate(-.3deg)' }
            ], knockTiming);
            await knock.finished;
            if (!this.active) return;
            this.body.classList.add('is-warmup-hovering');
            // Give the camera a stunned beat before gravity takes over. A slow
            // scanner can extend this hold, without exposing sharing too early.
            await this.animate(scenery, this.reduced ? [{ opacity: 1 }, { opacity: 1 }] : [
                { transform: knocked }, { transform: knocked }
            ], { duration: 300, fill: 'forwards' }).finished;
            await this.scannerReady;
            if (!this.active) return;
            this.body.classList.remove('is-warmup-hovering');
            this.body.classList.add('is-camera-panning');
            const fallTiming = { duration: 1000, fill: 'forwards', easing: 'cubic-bezier(.55,0,.8,.65)' };
            const clearLens = innerHeight * .7 + r.height * near * .25 + 80;
            this.animate(this.icon, this.reduced ? [{ opacity: 1 }, { opacity: 0 }] : [
                { transform: held, opacity: 1 },
                { transform: pose(dx + 30, dy + 38 - clearLens * .18, near, -4), opacity: 1, offset: .35 },
                { transform: pose(dx + 80, dy + 38 - clearLens, near, -10), opacity: 0 }
            ], fallTiming);
            const sky = this.animate(scenery, this.reduced ? [{ opacity: .6 }, { opacity: 1 }] : [
                { transform: knocked }, { transform: 'translateY(-50%) rotate(0deg)' }
            ], fallTiming);
            this.animate(document.querySelector('main'), this.reduced ? [{ opacity: 0 }, { opacity: 1 }] : [
                { transform: 'translateY(calc(100dvh + 38px))' }, { transform: 'translateY(0)' }
            ], fallTiming);
            if (!this.reduced) this.animate(header, [
                { transform: 'translateY(18px) rotate(-.3deg)' }, { transform: 'translateY(0) rotate(0deg)' }
            ], fallTiming);
            await sky.finished;
            if (this.active) this.resolve(true);
        } catch {
            this.cancel();
        }
    }

    dispose() {
        this.active = false;
        this.ready();
        for (const effect of this.effects) effect.cancel();
        this.icon.remove();
        this.glass.remove();
        this.body.classList.remove('is-warming', 'is-camera-knocked', 'is-warmup-hovering', 'is-camera-panning');
    }

    cancel() {
        this.dispose();
        this.resolve(false);
    }
}
window.ParachuteWelcomeFlight = ParachuteWelcomeFlight;
