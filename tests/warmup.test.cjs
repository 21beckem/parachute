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

test('cloud contacts at three and a half seconds, followed by a knock, stunned beat, and full second of falling', async () => {
    const { flight, effects, classes } = setup();
    flight.ready();
    assert.equal(effects[0].options.duration, 3500);
    assert.notEqual(effects[0].frames[0].transform, effects[0].frames[1].transform, 'motion starts immediately');
    effects[0].complete(); await flush();
    assert.equal(classes.has('is-camera-knocked'), true);
    assert.equal(effects[2].options.duration, 200);
    assert.equal(classes.has('is-camera-panning'), false);
    effects[2].complete(); await flush();
    const hold = effects.at(-1);
    assert.equal(hold.options.duration, 300);
    assert.equal(classes.has('is-camera-panning'), false, 'the camera stays stunned before falling');
    hold.complete(); await flush();
    const sky = effects.find(effect => effect.frames[1]?.transform === 'translateY(-50%) rotate(0deg)');
    assert.equal(sky.options.duration, 1000);
    assert.equal(sky.frames[0].transform, 'translateY(38px) rotate(-.4deg)');
    assert.equal(effects[0].options.duration + effects[2].options.duration + hold.options.duration + sky.options.duration, 5000);
    sky.complete(); await flush();
    assert.equal(await flight.finished, true);
    flight.dispose();
    assert.equal(classes.size, 0);
    assert.equal(flight.icon.removed, true);
    assert.equal(flight.glass.removed, true, 'lens cracks are removed after the sequence');
});

test('a slow scanner extends the stunned hold without starting the fall or another zoom', async () => {
    const { flight, effects, classes } = setup();
    effects[0].complete(); await flush();
    effects[2].complete(); await flush(); effects.at(-1).complete(); await flush();
    assert.equal(classes.has('is-camera-knocked'), true);
    assert.equal(classes.has('is-camera-panning'), false);
    const count = effects.length;
    flight.ready(); await flush();
    assert.ok(effects.length > count);
    assert.equal(classes.has('is-camera-panning'), true);
    flight.cancel(); await flush();
    assert.equal(await flight.finished, false);
});

test('startup failure during the pan clears every effect and never reveals the sharing scene', async () => {
    const { flight, effects, classes } = setup();
    flight.ready(); effects[0].complete(); await flush(); effects[2].complete(); await flush();
    effects.at(-1).complete(); await flush();
    flight.cancel(); await flush();
    assert.equal(await flight.finished, false);
    assert.equal(effects.every(effect => effect.cancelled), true);
    assert.equal(flight.glass.removed, true, 'startup errors also clear the glass overlay');
    assert.equal(classes.size, 0);
});

test('reduced-motion startup keeps the sensor timing while avoiding scale, sway, and camera transforms', async () => {
    const { flight, effects } = setup(true);
    flight.ready(); effects[0].complete(); await flush(); effects[2].complete(); await flush();
    effects.at(-1).complete(); await flush();
    assert.equal(effects.every(effect => effect.frames.every(frame => !frame.transform)), true);
    flight.cancel(); await flush();
});

test('whole parachute stays visible for most of the approach and stops growing during knock and departure', async () => {
    const { flight, effects } = setup();
    const scaleOf = frame => Number(frame.transform.match(/scale\(([^)]+)\)/)[1]);
    const frames = effects[0].frames;
    const positionOf = frame => frame.transform.match(/translate\(([^,]+)px, ([^)]+)px\)/).slice(1).map(Number);
    const visible = frames.filter(frame => {
        const scale = scaleOf(frame), [x, y] = positionOf(frame);
        const left = 200 + x + 50 * (1 - scale);
        const top = 150 + y + 95 * .8 * (1 - scale);
        return left >= 0 && left + 100 * scale <= 1200 && top >= 0 && top + 95 * scale <= 800;
    });
    assert.ok(visible.length / frames.length > .7, 'the full silhouette fits for over 70% of the approach');
    assert.ok(scaleOf(frames.at(-1)) - scaleOf(frames.at(-2)) < scaleOf(frames[1]) - scaleOf(frames[0]), 'growth settles gently into contact');
    assert.match(frames.at(-1).transform, /translate\(350px, 174px\)/);
    effects[0].complete(); await flush();
    const iconKnock = effects[1];
    const contactScale = scaleOf(frames.at(-1));
    assert.equal(iconKnock.frames.every(frame => scaleOf(frame) === contactScale), true);
    const [, contactY] = positionOf(iconKnock.frames[0]), [, heldY] = positionOf(iconKnock.frames[1]);
    assert.equal(heldY - contactY, 38, 'parachute follows the same camera knock');
    effects[2].complete(); await flush(); effects.at(-1).complete(); flight.ready(); await flush();
    const departure = effects.find(effect => effect.element === flight.icon && effect.options.duration === 1000);
    assert.equal(departure.frames[0].transform, iconKnock.frames[1].transform, 'departure starts from the held collision position');
    assert.equal(departure.frames.every(frame => scaleOf(frame) === contactScale), true);
    const last = departure.frames.at(-1);
    const exitY = Number(last.transform.match(/translate\([^,]+, ([^)]+)px\)/)[1]);
    assert.ok(150 + 95 * .8 + exitY + 95 * .2 * contactScale < 0, 'parachute exits above the camera during the downward pan');
    flight.cancel(); await flush();
});
