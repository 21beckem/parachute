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
            // Keep growing throughout the four-second approach.
            const frames = Array.from({ length: 61 }, (_, i) => {
                const t = i / 60;
                const travel = t * t * (3 - 2 * t);
                const sway = i === 60 ? 0 : Math.sin(t * Math.PI);
                return { offset: t, transform: pose(
                    dx * travel + Math.sin(t * Math.PI * 2) * 14 * sway,
                    dy * travel + Math.sin(t * Math.PI * 3) * 9 * sway,
                    1 + (near - 1) * t,
                    Math.sin(t * Math.PI * 2) * 4 * sway
                ) };
            });
            const approach = this.animate(this.icon, this.reduced ? [{ opacity: 1 }, { opacity: 1 }] : frames,
                { duration: 4000, fill: 'forwards', easing: 'linear' });
            await approach.finished;
            if (!this.active) return;
            await this.scannerReady;
            if (!this.active) return;
            this.body.classList.add('is-camera-panning');
            const fallTiming = { duration: 1000, fill: 'forwards', easing: 'cubic-bezier(.55,0,.8,.65)' };
            const scenery = document.querySelector('.scenery');
            // The parachute stays in the sky. It only moves on screen because
            // the camera pans down by the same distance as the scenery.
            this.animate(this.icon, this.reduced ? [{ opacity: 1 }, { opacity: 0 }] : [
                { transform: pose(dx, dy, near, 0) },
                { transform: pose(dx, dy - innerHeight, near, 0) }
            ], fallTiming);
            const sky = this.animate(scenery, this.reduced ? [{ opacity: .6 }, { opacity: 1 }] : [
                { transform: 'translateY(0)' }, { transform: 'translateY(-50%)' }
            ], fallTiming);
            this.animate(document.querySelector('main'), this.reduced ? [{ opacity: 0 }, { opacity: 1 }] : [
                { transform: 'translateY(100dvh)' }, { transform: 'translateY(0)' }
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
        this.body.classList.remove('is-warming', 'is-camera-panning');
    }

    cancel() {
        this.dispose();
        this.resolve(false);
    }
}
window.ParachuteWelcomeFlight = ParachuteWelcomeFlight;
