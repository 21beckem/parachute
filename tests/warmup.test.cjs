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

test('normal flight uses four seconds of approach followed by a one-second bump and pan', async () => {
    const { flight, effects, classes } = setup();
    flight.ready();
    assert.equal(effects[0].options.duration, 3500);
    effects[0].complete(); await flush();
    assert.equal(effects[2].options.duration, 500);
    assert.equal(classes.has('is-camera-panning'), false);
    effects[2].complete(); await flush();
    assert.equal(classes.has('is-camera-panning'), true);
    const sky = effects.find(effect => effect.frames[1]?.transform === 'translateY(32px) rotate(.3deg)');
    assert.equal(sky.options.duration, 1000);
    sky.complete(); await flush();
    assert.equal(await flight.finished, true);
    flight.dispose();
    assert.equal(classes.size, 0);
    assert.equal(flight.icon.removed, true);
});

test('a slow scanner keeps swaying and cannot start the impact or pan early', async () => {
    const { flight, effects, classes } = setup();
    effects[0].complete(); await flush();
    assert.equal(effects.length, 2);
    assert.equal(effects[1].options.iterations, Infinity);
    assert.equal(classes.has('is-camera-panning'), false);
    flight.ready(); await flush();
    assert.equal(effects[2].options.duration, 500);
    flight.cancel(); await flush();
    assert.equal(await flight.finished, false);
});

test('startup failure during the pan clears every effect and never reveals the sharing scene', async () => {
    const { flight, effects, classes } = setup();
    flight.ready(); effects[0].complete(); await flush(); effects[2].complete(); await flush();
    flight.cancel(); await flush();
    assert.equal(await flight.finished, false);
    assert.equal(effects.every(effect => effect.cancelled), true);
    assert.equal(classes.size, 0);
});

test('reduced-motion startup keeps the sensor timing while avoiding scale, sway, and camera transforms', async () => {
    const { flight, effects } = setup(true);
    flight.ready(); effects[0].complete(); await flush(); effects[2].complete(); await flush();
    assert.equal(effects.every(effect => effect.frames.every(frame => !frame.transform)), true);
    flight.cancel(); await flush();
});
