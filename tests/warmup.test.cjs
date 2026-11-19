const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function setup(reduced = false) {
    const effects = [], classes = new Set(), nodes = new Map();
    const element = () => ({
        style: {}, setAttribute() {}, append() {}, remove() { this.removed = true; },
        cloneNode() { return element(); },
        getBoundingClientRect: () => ({ left: 200, top: 150, width: 100, height: 95 }),
        animate(frames, options) {
            let resolve, reject;
            const effect = { frames, options, element: this, cancelled: false,
                finished: new Promise((yes, no) => { resolve = yes; reject = no; }),
                complete() { resolve(); }, cancel() { this.cancelled = true; reject(Error('cancelled')); }
            };
            effects.push(effect);
            return effect;
        }
    });
    const body = element();
    body.classList = { add: name => classes.add(name), remove: (...names) => names.forEach(name => classes.delete(name)) };
    const window = {};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../warmup.js'), 'utf8'), {
        window, document: { body, createElement: element, querySelector(selector) {
            if (!nodes.has(selector)) nodes.set(selector, element());
            return nodes.get(selector);
        } },
        matchMedia: () => ({ matches: reduced }), getComputedStyle: () => ({ transform: 'matrix(1,0,0,1,0,0)', getPropertyValue: name => name === '--tower-scale' ? '.25' : '100px' }),
        innerWidth: 1200, innerHeight: 800
    });
    const flight = new window.ParachuteWelcomeFlight();
    return { flight, effects, classes };
}

test('four seconds of crew preparation flow directly into a one-second camera pan', async () => {
    const { flight, effects, classes } = setup();
    flight.ready();
    assert.equal(effects[0].options.duration, 4000);
    assert.equal(flight.icon.className, 'warmup-countdown');
    assert.equal(flight.icon.textContent, '5');
    effects[0].complete(); await flush();
    assert.equal(classes.has('is-camera-panning'), true);
    const sky = effects.find(effect => effect.frames[1]?.transform === 'translateY(-50%)');
    assert.equal(sky.options.duration, 1000);
    assert.equal(sky.frames[0].transform, 'translateY(0)');
    assert.equal(effects.length, 5, 'preparation clock, countdown fade, sky, main scene and tower');
    const tower = effects.at(-1);
    assert.equal(tower.options.duration, sky.options.duration);
    assert.equal(tower.options.easing, sky.options.easing);
    sky.complete(); await flush();
    let finished = false;
    flight.finished.then(() => { finished = true; });
    await flush();
    assert.equal(finished, false, 'sharing waits for the tower as well as the sky');
    effects.at(-1).complete(); await flush();
    assert.equal(await flight.finished, true);
    flight.dispose();
    assert.equal(classes.size, 0);
    assert.equal(flight.icon.removed, true);
});

test('a slow scanner holds the final position until readiness without starting another zoom', async () => {
    const { flight, effects, classes } = setup();
    effects[0].complete(); await flush();
    assert.equal(classes.has('is-camera-panning'), false);
    assert.equal(effects.length, 1);
    flight.ready(); await flush();
    assert.equal(classes.has('is-camera-panning'), true);
    flight.cancel(); await flush();
    assert.equal(await flight.finished, false);
});

test('startup failure during the pan clears every effect and never reveals the sharing scene', async () => {
    const { flight, effects, classes } = setup();
    flight.ready(); effects[0].complete(); await flush();
    flight.cancel(); await flush();
    assert.equal(await flight.finished, false);
    assert.equal(effects.every(effect => effect.cancelled), true);
    assert.equal(flight.icon.removed, true);
    assert.equal(classes.size, 0);
});

test('reduced-motion startup keeps the sensor timing while avoiding scale, sway, and camera transforms', async () => {
    const { flight, effects } = setup(true);
    flight.ready(); effects[0].complete(); await flush();
    assert.equal(effects[0].options.duration, 4000);
    assert.equal(effects.every(effect => effect.frames.every(frame => !frame.transform)), true);
    flight.cancel(); await flush();
});

test('countdown stays decorative and fades while the existing sky pans without a parachute clone', async () => {
    const { flight, effects } = setup();
    assert.equal(flight.icon.className, 'warmup-countdown');
    assert.equal(effects[0].frames.every(frame => frame.transform === undefined), true);
    flight.ready(); effects[0].complete(); await flush();
    const fade = effects.find(effect => effect.element === flight.icon && effect.options.duration === 1000);
    assert.equal(fade.frames.at(-1).opacity, 0);
    const sky = effects.find(effect => effect.frames.at(-1).transform === 'translateY(-50%)');
    sky.complete(); await flush();
    let finished = false;
    flight.finished.then(() => { finished = true; });
    await flush();
    assert.equal(finished, false, 'sharing waits for the tower as well as the sky');
    effects.at(-1).complete(); await flush();
    assert.equal(await flight.finished, true);
    flight.dispose();
});
