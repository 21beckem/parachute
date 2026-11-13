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
        matchMedia: () => ({ matches: reduced }), getComputedStyle: () => ({ transform: 'matrix(1,0,0,1,0,0)' }),
        innerWidth: 1200, innerHeight: 800
    });
    const flight = new window.ParachuteWelcomeFlight();
    return { flight, effects, classes };
}

test('four seconds of approach flow directly into a one-second camera pan', async () => {
    const { flight, effects, classes } = setup();
    flight.ready();
    assert.equal(effects[0].options.duration, 4000);
    assert.notEqual(effects[0].frames[0].transform, effects[0].frames[1].transform);
    effects[0].complete(); await flush();
    assert.equal(classes.has('is-camera-panning'), true);
    const sky = effects.find(effect => effect.frames[1]?.transform === 'translateY(-50%)');
    assert.equal(sky.options.duration, 1000);
    assert.equal(sky.frames[0].transform, 'translateY(0)');
    assert.equal(effects.length, 4, 'only approach, parachute camera motion, sky, and main scene');
    sky.complete(); await flush();
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

test('parachute grows throughout the approach and stays anchored to the sky during the pan', async () => {
    const { flight, effects } = setup();
    const scaleOf = frame => Number(frame.transform.match(/scale\(([^)]+)\)/)[1]);
    const positionOf = frame => frame.transform.match(/translate\(([^,]+)px, ([^)]+)px\)/).slice(1).map(Number);
    const frames = effects[0].frames;
    const visible = frames.filter(frame => {
        const scale = scaleOf(frame), [x, y] = positionOf(frame);
        const left = 200 + x + 50 * (1 - scale);
        const top = 150 + y + 95 * .8 * (1 - scale);
        return left >= 0 && left + 100 * scale <= 1200 && top >= 0 && top + 95 * scale <= 800;
    });
    assert.ok(visible.length / frames.length > .7, 'full silhouette fits for over 70% of the approach');
    for (let i = 1; i < frames.length; i++) assert.ok(scaleOf(frames[i]) > scaleOf(frames[i - 1]));
    flight.ready(); effects[0].complete(); await flush();
    const pan = effects.find(effect => effect.element === flight.icon && effect.options.duration === 1000);
    assert.equal(pan.frames[0].transform, frames.at(-1).transform);
    assert.equal(pan.frames.every(frame => scaleOf(frame) === scaleOf(frames.at(-1))), true);
    const [startX, startY] = positionOf(pan.frames[0]);
    const [endX, endY] = positionOf(pan.frames.at(-1));
    assert.equal(endX, startX, 'no sideways wind lift');
    assert.equal(startY - endY, 800, 'moves with the scenery by one viewport height');
    assert.equal(pan.frames.every(frame => frame.opacity === undefined), true, 'no independent disappearance');
    flight.cancel(); await flush();
});
