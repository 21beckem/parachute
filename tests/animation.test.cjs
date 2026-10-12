const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Minimal DOM/clock doubles keep the real controller and physics deterministic.
function setup() {
    class Element {
        constructor() {
            this.style = {}; this.dataset = {}; this.attributes = {}; this.listeners = {};
            this.offsetWidth = 155; this.offsetHeight = 178.25;
            this.children = {}; this.captured = new Set(); this.classes = new Set();
            this.classList = {
                add: (...names) => names.forEach(name => this.classes.add(name)),
                remove: (...names) => names.forEach(name => this.classes.delete(name)),
                toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name)
            };
        }
        querySelector(name) { return this.children[name] ||= new Element(); }
        cloneNode() { return new Element(); }
        setAttribute(name, value) { this.attributes[name] = value; }
        addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
        dispatchEvent(event) { for (const fn of this.listeners[event.type] || []) fn(event); }
        append(child) { child.parent = this; }
        remove() { this.removed = true; }
        setPointerCapture(id) { this.captured.add(id); }
        hasPointerCapture(id) { return this.captured.has(id); }
        releasePointerCapture(id) { this.captured.delete(id); }
        getBoundingClientRect() { return { left: 500, right: 705, top: 580, bottom: 752 }; }
        focus() { document.activeElement = this; }
        animate() { return { finished: Promise.resolve(), cancel() {} }; }
    }
    const elements = {};
    const document = {
        querySelector: name => elements[name] ||= new Element(),
        addEventListener() {}, activeElement: null
    };
    const frames = new Map(); let frameId = 0;
    const timers = new Map(); let timerId = 0;
    const window = { matchMedia: () => ({ matches: false }), addEventListener() {} };
    const context = vm.createContext({
        document, window, innerWidth: 1200, innerHeight: 800, AbortController,
        setTimeout: (fn, delay) => { fn.delay = delay; timers.set(++timerId, fn); return timerId; },
        clearTimeout: id => timers.delete(id),
        requestAnimationFrame: fn => { frames.set(++frameId, fn); return frameId; },
        cancelAnimationFrame: id => frames.delete(id),
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../parachute.js'), 'utf8'), context);
    const manager = window.ParachuteAnimation;
    for (const delivery of [...manager.deliveries]) delivery.cancel();
    return { api: window.animation, manager, elements, frames, timers };
}

test('all typed entry points are detached-call safe and run concurrently', () => {
    const { api, manager } = setup();
    const kinds = ['File', 'Folder', 'Music', 'Link', 'Picture', 'Video', 'Other'];
    const deliveries = kinds.map(kind => {
        const drop = api[`drop${kind}`];
        const d = drop();
        assert.equal(d.element.querySelector('.delivery-art').attributes.href, `#payload-${kind.toLowerCase()}`);
        return d;
    });
    assert.equal(manager.deliveries.size, 7);
    assert.equal(new Set(deliveries.map(d => d.element)).size, 7);
    deliveries[0].cancel();
    assert.equal(manager.deliveries.size, 6);
    assert.equal(deliveries[1].disposed, false);
});

test('left and right release preserve momentum with gradual drag', () => {
    for (const speed of [-220, 220]) {
        const { api } = setup();
        const d = api.dropMusic();
        d.pointer = 1; d.vx = speed; d.vy = 0;
        d.element.setPointerCapture(1);
        const x = d.x;
        d.release({ type: 'pointerup', pointerId: 1 });
        assert.equal(d.vx, speed);
        assert.equal(d.element.hasPointerCapture(1), false);
        d.last = 0;
        d.tick(16);
        assert.equal(Math.sign(d.x - x), Math.sign(speed));
        assert.ok(Math.abs(d.vx) < Math.abs(speed) && Math.abs(d.vx) > Math.abs(speed) * .95);
    }
});

test('dragging builds sideways velocity before a release', () => {
    const { api, frames } = setup();
    const d = api.dropFile();
    d.element.dispatchEvent({ type: 'pointerdown', pointerId: 2, isPrimary: true, button: 0, clientX: d.x + 10, clientY: d.y + 10, preventDefault() {} });
    d.element.dispatchEvent({ type: 'pointermove', pointerId: 2, clientX: d.x + 160, clientY: d.y + 10 });
    for (let t = 0; t <= 160; t += 16) { frames.delete(d.frame); d.tick(t); }
    assert.ok(d.vx > 100);
    d.release({ type: 'pointerup', pointerId: 2 });
    assert.ok(d.vx > 100);
});

test('released drops pass the viewport floor and dispose their nodes and frames', () => {
    const { api, manager, frames } = setup();
    const d = api.dropFolder();
    d.y = 810; d.last = 0;
    frames.delete(d.frame); d.tick(16);
    assert.ok(d.y > 810);
    assert.equal(d.disposed, false);
    d.y = 1200;
    frames.delete(d.frame); d.tick(32);
    assert.equal(d.disposed, true);
    assert.equal(d.element.removed, true);
    assert.equal(d.events.signal.aborted, true);
    assert.equal(manager.deliveries.size, 0);
    assert.equal(frames.size, 0);
    d.cancel(); // Idempotent cleanup.
});

test('receiving animates into the box, cleans up just that delivery, and preserves its payload', async () => {
    const { api, manager } = setup();
    const payload = { name: 'song.mp3', type: 'audio/mpeg' };
    const d = api.dropMusic(payload);
    const other = api.dropVideo();
    let received;
    manager.box.addEventListener('file-received', event => { received = event.detail.files; });
    // The artwork is far from the box; the release pointer controls receipt.
    d.x = 100;
    d.y = 100;
    d.pointer = 1;
    const receipt = d.release({ type: 'pointerup', pointerId: 1, clientX: 600, clientY: 740 });
    assert.equal(d.receiving, true);
    assert.equal(d.disposed, false);
    assert.equal(received, undefined);
    await receipt;
    assert.equal(d.disposed, true);
    assert.equal(received[0], payload);
    assert.equal(other.disposed, false);
    assert.equal(manager.deliveries.size, 1);
});

test('pointer position highlights the box and release outside does not receive overlapping artwork', () => {
    const { api, manager } = setup();
    const d = api.dropFile();
    d.element.dispatchEvent({ type: 'pointerdown', pointerId: 1, isPrimary: true, button: 0, clientX: 520, clientY: 100, preventDefault() {} });
    assert.ok(d.element.classes.has('is-grabbed'));
    d.element.dispatchEvent({ type: 'pointermove', pointerId: 1, clientX: 700, clientY: 745 });
    assert.ok(manager.box.classes.has('is-drop-target'));
    d.x = 600 - d.element.offsetWidth / 2;
    d.y = 650 - d.element.offsetHeight * (187.5 / 230);
    assert.equal(d.isFileOverBox(), true);
    d.release({ type: 'pointerup', pointerId: 1, clientX: 710, clientY: 745 });
    assert.equal(d.receiving, false);
    assert.ok(!d.element.classes.has('is-grabbed'));
    assert.ok(!manager.box.classes.has('is-drop-target'));
});

test('cancelled pointer gestures never receive and box bounds exclude side flaps', () => {
    const { api } = setup();
    const d = api.dropFile();
    assert.equal(d.isPointOverBox(500, 580), true);
    assert.equal(d.isPointOverBox(705, 752), true);
    assert.equal(d.isPointOverBox(490, 600), false);
    for (const type of ['pointercancel', 'lostpointercapture']) {
        d.pointer = 1;
        d.release({ type, pointerId: 1, clientX: 600, clientY: 700 });
        assert.equal(d.receiving, false);
    }
});

test('box reopens three seconds after the latest receipt, unaffected by arriving drops', () => {
    const { api, manager, timers } = setup();
    api.receiveFileInBox();
    const first = manager.boxTimer;
    assert.ok(manager.box.classes.has('is-closed'));
    assert.equal(timers.get(first).delay, 3000);
    api.dropFile();
    assert.ok(manager.box.classes.has('is-closed'));
    assert.ok(timers.has(first));
    api.receiveFileInBox();
    assert.ok(!timers.has(first));
    timers.get(manager.boxTimer)();
    assert.ok(!manager.box.classes.has('is-closed'));
    assert.ok(!manager.box.classes.has('is-receiving'));
    assert.equal(manager.box.attributes['aria-label'], 'Open receiving box');
});

test('cancelling during entry prevents a receipt event', async () => {
    const { api, manager } = setup();
    const d = api.dropFile();
    let finish, received = false;
    manager.box.addEventListener('file-received', () => { received = true; });
    d.element.animate = () => ({ finished: new Promise(resolve => { finish = resolve; }), cancel() {} });
    const receipt = d.finish();
    d.cancel();
    finish();
    await receipt;
    assert.equal(received, false);
});

test('the held delivery lifts, enters between the box panels, then triggers closure', async () => {
    const { api, manager } = setup();
    const d = api.dropPicture({ name: 'photo.png' });
    const originalElement = d.element;
    const phases = [];
    let received = 0;
    manager.box.addEventListener('file-received', () => received++);
    d.element.animate = (keyframes, options) => {
        let complete;
        const finished = new Promise(resolve => { complete = resolve; });
        phases.push({ keyframes, options, complete });
        return { finished, cancel() {} };
    };
    api.receiveFileInBox();
    received = 0;
    d.pointer = 1;
    const receipt = d.release({ type: 'pointerup', pointerId: 1, clientX: 600, clientY: 700 });
    assert.equal(phases.length, 1);
    assert.ok(!manager.box.classes.has('is-closed'), 'opens for the incoming delivery');
    assert.notEqual(d.element.parent, manager.box, 'lift stays in the foreground');
    phases[0].complete();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(phases.length, 2);
    assert.equal(d.element, originalElement, 'uses the held object rather than a replacement');
    assert.equal(d.element.parent, manager.box);
    assert.ok(d.element.classes.has('is-inside-box'));
    assert.equal(received, 0);
    assert.ok(!manager.box.classes.has('is-closed'), 'stays open during descent');
    phases[1].complete();
    await receipt;
    assert.equal(received, 1);
    assert.ok(manager.box.classes.has('is-closed'));
    assert.equal(d.disposed, true);
});

test('uploads classify content and initialization does not duplicate listeners', async () => {
    const { api, manager, timers } = setup();
    for (const [payload, expected] of [
        [{ name: 'bundle.zip' }, 'folder'], [{ name: 'song.mp3' }, 'music'],
        ['https://example.com', 'link'], [{ name: 'photo.png' }, 'picture'],
        [{ type: 'video/mp4' }, 'video'], [{ name: 'notes.pdf' }, 'file'],
        [{ name: 'data.bin' }, 'other'], [[{ name: 'a' }, { name: 'b' }], 'folder']
    ]) assert.equal(manager.typeOf(payload), expected);
    api.initialize(); api.initialize();
    const input = manager.upload;
    assert.equal(input.listeners.change.length, 1);
    const preview = api.launchRocketWithFile({ name: 'song.mp3' });
    assert.equal(manager.connecting, true);
    assert.equal(manager.launching, false);
    assert.equal(await api.launchRocketWithFile({ name: 'duplicate.mp3' }), false);
    for (const fn of timers.values()) fn();
    await preview;
    assert.equal([...manager.deliveries][0].type, 'music');
    assert.equal(input.disabled, false);
    assert.equal(manager.launching, false);
});

test('thrown rotated deliveries bounce off both walls without leaving the viewport', () => {
    for (const side of [-1, 1]) {
        const { api } = setup();
        const d = api.dropFile();
        d.angle = side * 18;
        d.x = side < 0 ? -100 : 1250;
        d.vx = side * 500;
        d.render();
        assert.equal(d.vx, side * -400);
        const angle = d.angle * Math.PI / 180;
        const w = d.element.offsetWidth, h = d.element.offsetHeight;
        for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h]]) {
            const screenX = d.x + w / 2 + (x - w / 2) * Math.cos(angle) - (y - h * .12) * Math.sin(angle);
            assert.ok(screenX >= 4 - 1e-9 && screenX <= 1196 + 1e-9);
        }
        d.render();
        assert.equal(d.vx, side * -400, 'does not reverse inward motion a second time');
        assert.equal(d.disposed, false);
    }
});

test('connection preparation and launch work independently without a file', async () => {
    const { api, manager } = setup();
    assert.equal(api.startConnecting(), true);
    assert.equal(api.startConnecting(), false);
    assert.ok(manager.rocketPad.classes.has('is-connecting'));
    let finish;
    manager.rocket.animate = () => ({ finished: new Promise(resolve => { finish = resolve; }), cancel() {} });
    const flight = api.launchRocket();
    assert.equal(manager.connecting, false);
    assert.equal(manager.launching, true);
    assert.ok(!manager.rocketPad.classes.has('is-connecting'));
    assert.equal(api.startConnecting(), false);
    assert.equal(await api.launchRocket(), false);
    finish();
    assert.equal(await flight, true);
    assert.equal(manager.launching, false);
    assert.equal(manager.deliveries.size, 0);
    api.startConnecting();
    api.stopConnecting();
    assert.equal(manager.connecting, false);
});

test('stopping preparation cancels the pending preview launch', async () => {
    const { api, manager, timers } = setup();
    const preview = api.launchRocketWithFile({ name: 'notes.txt' });
    api.stopConnecting();
    for (const fn of timers.values()) fn();
    assert.equal(await preview, false);
    assert.equal(manager.deliveries.size, 0);
    assert.equal(manager.upload.disabled, false);
    assert.equal(manager.previewing, false);
});

test('each payload symbol exists and the template references swappable artwork', () => {
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    for (const type of ['file', 'folder', 'music', 'link', 'picture', 'video', 'other']) {
        assert.ok(html.includes(`id="payload-${type}"`));
    }
    assert.ok(html.includes('class="delivery-art"'));
    assert.ok(!html.includes('class="preview-note"'));
    assert.ok(!html.includes('<footer>'));
});
