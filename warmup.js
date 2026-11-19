// Tower preparation and camera travel, timed from sensor acceptance.
class ParachuteWelcomeFlight {
    constructor() {
        this.active = true;
        this.effects = [];
        this.body = document.body;
        this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
        this.scannerReady = new Promise(resolve => { this.ready = resolve; });
        this.finished = new Promise(resolve => { this.resolve = resolve; });
        this.icon = document.createElement('div');
        this.icon.className = 'warmup-countdown';
        this.icon.textContent = '5';
        this.icon.setAttribute('aria-hidden', 'true');
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
            // Four seconds for crew preparation, then one second of camera travel.
            const approach = this.animate(this.icon, [{ opacity: .13 }, { opacity: .13 }],
                { duration: 4000, fill: 'forwards', easing: 'linear' });
            await approach.finished;
            if (!this.active) return;
            await this.scannerReady;
            if (!this.active) return;
            this.body.classList.add('is-camera-panning');
            const fallTiming = { duration: 1000, fill: 'forwards', easing: 'cubic-bezier(.55,0,.8,.65)' };
            const scenery = document.querySelector('.scenery');
            this.animate(this.icon, [{ opacity: .13 }, { opacity: 0 }], fallTiming);
            const sky = this.animate(scenery, this.reduced ? [{ opacity: .6 }, { opacity: 1 }] : [
                { transform: 'translateY(0)' }, { transform: 'translateY(-50%)' }
            ], fallTiming);
            this.animate(document.querySelector('main'), this.reduced ? [{ opacity: 0 }, { opacity: 1 }] : [
                { transform: 'translateY(100dvh)' }, { transform: 'translateY(0)' }
            ], fallTiming);
            const tower = document.querySelector('.control-tower');
            const towerStyle = getComputedStyle(tower);
            const towerMotion = this.animate(tower, this.reduced ? [{ opacity: 1 }, { opacity: 1 }] : [
                { transform: 'none' },
                { transform: `translate(${towerStyle.getPropertyValue('--tower-x')}, ${towerStyle.getPropertyValue('--tower-y')}) scale(${towerStyle.getPropertyValue('--tower-scale')})` }
            ], fallTiming);
            await Promise.all([sky.finished, towerMotion.finished]);
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
