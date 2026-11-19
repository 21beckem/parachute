const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup(reduced = false, width = 1280, height = 720) {
    const nodes = new Map(), events = {}, classes = new Set();
    let now = 0, nextFrame;
    const node = key => {
        if (!nodes.has(key)) nodes.set(key, {
            style: {}, attrs: {}, textContent: '', hidden: true, offsetTop: 100,
            setAttribute(name, value) { this.attrs[name] = value; },
            querySelector: node, append() {},
            getBoundingClientRect: () => ({ bottom: key === '.welcome' ? height * .26 + 210 : 560, left: key === 'span' ? width * .82 : 0, top: key === 'main' ? height + 100 : key === '.desk' ? height * 1.75 : key === 'span' ? height * 1.67 : 0 })
        });
        return nodes.get(key);
    };
    const body = { append() {}, classList: { contains: name => classes.has(name) } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../tower.js'), 'utf8'), {
        document: { body, createElement: node, querySelector: node, append() {}, getElementById: node },
        window: { addEventListener(name, fn) { events[name] = fn; } },
        matchMedia: () => ({ matches: reduced }), performance: { now: () => now },
        innerWidth: width, innerHeight: height,
        ResizeObserver: class { observe() {} },
        requestAnimationFrame(fn) { nextFrame = fn; return 1; }, cancelAnimationFrame() {}
    });
    const tick = ms => { now = ms; const callback = nextFrame; nextFrame = null; callback(now); };
    const emit = name => events[name]();
    const attr = (selector, name) => node(selector).attrs[name];
    const opacity = selector => node(selector).style.opacity;
    return { tick, emit, attr, opacity, node, classes, pending: () => !!nextFrame };
}

test('idle crew have separate pacing, gaming and paper routines; preparation is staggered', () => {
    const s = setup();
    s.tick(1000);
    const walker = s.attr('.parcel-0', 'transform');
    const gamer = s.attr('.parcel-1', 'transform');
    s.tick(1500);
    assert.notEqual(s.attr('.parcel-0', 'transform'), walker);
    assert.notEqual(s.attr('.parcel-1', 'transform'), gamer);
    assert.equal(s.opacity('.screen-game'), '1');
    assert.equal(s.opacity('.parcel-1 .crew-controller'), '1');
    assert.ok(Number(s.opacity('.parcel-2 .crew-files')) > 0);
    s.emit('discovery-warmup-start');
    s.tick(2200);
    assert.equal(s.opacity('.parcel-0 .crew-headset'), '0');
    assert.equal(s.opacity('.parcel-1 .crew-headset'), '1');
    assert.equal(s.opacity('.parcel-1 .crew-controller'), '0', 'controller is set down before work');
    s.tick(2700);
    assert.equal(s.opacity('.screen-game'), '0', 'gamer switches to work after fitting headset');
    s.tick(4900);
    assert.equal(s.opacity('.parcel-0 .crew-headset'), '1');
    assert.equal(s.opacity('.parcel-2 .crew-headset'), '1');
    assert.equal(s.opacity('.parcel-2 .crew-files'), '0', 'files are placed on the desk');
    assert.equal(s.attr('.tower-ready-light', 'fill'), '#a9cd8b');
    const raisedArm = s.attr('.parcel-0 .arm-left', 'd');
    s.tick(6300);
    assert.equal(s.attr('.parcel-0 .arm-left', 'd'), raisedArm, 'ready signal stays raised throughout the pan');
    s.classes.add('has-entered');
    s.tick(6500);
    assert.equal(s.pending(), false, 'hidden crew stops requesting frames in the distant tower');
});

test('a failed connection restores idle crew and the gaming screen', () => {
    const s = setup();
    s.tick(0); s.emit('discovery-warmup-start'); s.tick(3500);
    assert.equal(s.opacity('.screen-game'), '0');
    s.emit('discovery-warmup-error'); s.tick(3600);
    assert.equal(s.opacity('.screen-game'), '1');
    assert.equal(s.opacity('.parcel-0 .crew-headset'), '0');
    assert.equal(s.attr('.tower-ready-light', 'fill'), '#d1dadb');
});

test('pacing parcel faces its direction of travel and turns forward at its desk', () => {
    const s = setup();
    s.tick(1000);
    assert.match(s.attr('.parcel-0 .parcel-body', 'transform'), /scale\(-1 1\)/);
    assert.equal(s.attr('.parcel-0 .parcel-face', 'transform'), 'translate(-6 0)', 'face offsets toward the leading side of the mirrored box');
    s.tick(3000);
    assert.match(s.attr('.parcel-0 .parcel-body', 'transform'), /scale\(1 1\)/);
    s.emit('discovery-warmup-start');
    s.tick(5000);
    assert.match(s.attr('.parcel-0 .parcel-body', 'transform'), /scale\(1 1\)/);
    assert.equal(s.attr('.parcel-0 .parcel-face', 'transform'), 'translate(0 0)');
});

test('reduced motion holds idle poses and immediately seats the crew for preparation', () => {
    const s = setup(true);
    s.tick(0);
    const pose = s.attr('.parcel-0', 'transform');
    s.tick(1000);
    assert.equal(s.attr('.parcel-0', 'transform'), pose);
    s.emit('discovery-warmup-start'); s.tick(1010);
    assert.equal(s.opacity('.parcel-0 .crew-headset'), '1');
    assert.equal(s.attr('.parcel-0', 'transform'), 'translate(-115 146)');
});

test('cabin remains inside split-pane, phone and short viewports without covering the form', () => {
    for (const [w, h] of [[800, 700], [960, 842], [390, 844], [320, 568], [1280, 450]]) {
        const s = setup(false, w, h);
        const css = s.node('div').style.cssText;
        const width = Number(css.match(/width:([\d.]+)px/)[1]);
        const top = Number(css.match(/top:([\d.]+)px/)[1]);
        const left = Number(css.match(/left:([\d.]+)px/)[1]);
        assert.ok(top >= 0 && top + width * 325 / 460 <= h - 10, `${w}x${h}: full cabin fits`);
        const dy = Number(css.match(/--tower-y:([-\d.]+)px/)[1]);
        const scale = Number(css.match(/--tower-scale:([-\d.]+)/)[1]);
        const base = top + dy + width * scale * 893 / 460;
        assert.ok(Math.abs(base - (h * .67 + 5)) < .01, 'base meets the measured hill crest');
        assert.ok(top + dy > 0, 'distant tower fits fully in the sharing viewport');
        const form = s.node('.welcome').style;
        if (w >= 720) {
            assert.ok(parseFloat(form.left) + parseFloat(form.width) <= left - 19, 'form stays beside cabin');
        } else {
            assert.equal(form.maxHeight, 'none', 'welcome has no scrolling height limit');
            assert.ok(h * .26 + 210 <= top - 15, 'complete form stays above cabin');
        }
    }
});
