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
        this.body.classList.add('is-warming');
        void this.fly();
    }

    animate(element, frames, options) {
        const effect = element.animate(frames, options);
        // Infinite sways and short visual effects are also cancelled on errors.
        void effect.finished.catch(() => {});
        this.effects.push(effect);
        return effect;
    }

    async fly() {
        try {
            const r = this.rect;
            const dx = innerWidth / 2 - (r.left + r.width / 2);
            const dy = innerHeight * .45 - (r.top + r.height * .25);
            const near = Math.min(5, Math.max(2.5, innerWidth / r.width * .35));
            const pose = (x, y, scale, angle) => `translate(${x}px, ${y}px) rotate(${angle}deg) scale(${scale})`;
            const hovering = pose(dx, dy, near, -2);
            const approach = this.animate(this.icon, this.reduced ? [{ opacity: 1 }, { opacity: 1 }] : [
                { transform: pose(0, 0, 1, 0) },
                { transform: pose(dx * .18 + 14, dy * .2 - 12, 1 + (near - 1) * .15, 4) },
                { transform: pose(dx * .4 - 20, dy * .45 + 14, 1 + (near - 1) * .4, -5) },
                { transform: pose(dx * .7 + 12, dy * .7 - 10, 1 + (near - 1) * .7, 3) },
                { transform: hovering }
            ], { duration: 3500, fill: 'forwards', easing: 'linear' });
            await approach.finished;
            if (!this.active) return;
            this.body.classList.add('is-warmup-hovering');
            const sway = this.animate(this.icon, this.reduced ? [{ opacity: 1 }, { opacity: 1 }] : [
                { transform: hovering },
                { transform: pose(dx + 12, dy - 10, near, 2) },
                { transform: hovering }
            ], { duration: 1600, iterations: Infinity, easing: 'ease-in-out' });
            await this.scannerReady;
            if (!this.active) return;
            this.body.classList.remove('is-warmup-hovering');
            // Read the current sway so a longer-than-normal startup has no jump.
            const from = getComputedStyle(this.icon).transform;
            const lens = Math.max(innerWidth / r.width, innerHeight / (r.height * .45)) * 1.5;
            const impact = pose(dx, dy, lens, 1);
            await this.animate(this.icon, this.reduced ? [{ opacity: 1 }, { opacity: 0 }] : [
                { transform: from }, { transform: impact }
            ], { duration: 500, fill: 'forwards', easing: 'cubic-bezier(.55,0,.9,.5)' }).finished;
            sway.cancel();
            if (!this.active) return;
            this.body.classList.add('is-camera-panning');
            if (!this.reduced) this.animate(this.icon, [{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: 'forwards' });
            // The world shifts down briefly: the camera has been nudged upwards.
            const sky = this.animate(document.querySelector('.scenery'), this.reduced ? [{ opacity: .6 }, { opacity: 1 }] : [
                { transform: 'translateY(0)', offset: 0 },
                { transform: 'translateY(32px) rotate(.3deg)', offset: .12 },
                { transform: 'translateY(-50%) rotate(0deg)', offset: 1 }
            ], { duration: 1000, fill: 'forwards', easing: 'cubic-bezier(.3,0,.2,1)' });
            this.animate(document.querySelector('main'), this.reduced ? [{ opacity: 0 }, { opacity: 1 }] : [
                { transform: 'translateY(100dvh)', offset: 0 },
                { transform: 'translateY(calc(100dvh + 32px))', offset: .12 },
                { transform: 'translateY(0)', offset: 1 }
            ], { duration: 1000, fill: 'forwards', easing: 'cubic-bezier(.3,0,.2,1)' });
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
        this.body.classList.remove('is-warming', 'is-warmup-hovering', 'is-camera-panning');
    }

    cancel() {
        this.dispose();
        this.resolve(false);
    }
}
window.ParachuteWelcomeFlight = ParachuteWelcomeFlight;
