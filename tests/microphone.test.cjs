const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(getUserMedia, secure = true) {
    const elements = {}, events = {};
    const track = {
        stopped: false,
        stop() { this.stopped = true; },
        addEventListener(type, callback) { this[type] = callback; }
    };
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
    const requests = [];
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../microphone.js'), 'utf8'), {
        document: { getElementById: id => elements[id] ||= {
            attributes: {},
            setAttribute(key, value) { this.attributes[key] = value; },
            addEventListener(type, callback) { this[type] = callback; }
        } },
        window: { isSecureContext: secure, addEventListener: (type, callback) => events[type] = callback },
        navigator: { mediaDevices: { getUserMedia: constraints => {
            requests.push(constraints);
            return getUserMedia ? getUserMedia(stream) : Promise.resolve(stream);
        } } }
    });
    return { button: elements['microphone-toggle'], label: elements['microphone-label'],
        status: elements['microphone-status'], events, track, requests };
}

test('requests audio only after a click and releases it when toggled off', async () => {
    const s = setup();
    assert.equal(s.requests.length, 0);
    await s.button.click();
    assert.equal(JSON.stringify(s.requests), '[{"audio":true,"video":false}]');
    assert.equal(s.button.attributes['aria-pressed'], 'true');
    assert.equal(s.button.disabled, false);
    await s.button.click();
    assert.equal(s.track.stopped, true);
    assert.equal(s.button.attributes['aria-pressed'], 'false');
});

test('explains insecure contexts and permission denial, allowing a retry', async () => {
    const insecure = setup(null, false);
    await insecure.button.click();
    assert.equal(insecure.requests.length, 0);
    assert.match(insecure.status.textContent, /HTTPS or localhost/);
    const denied = setup(() => Promise.reject({ name: 'NotAllowedError' }));
    await denied.button.click();
    assert.match(denied.status.textContent, /denied/);
    assert.equal(denied.button.disabled, false);
    assert.equal(denied.button.attributes['aria-pressed'], 'false');
    await denied.button.click();
    assert.equal(denied.requests.length, 2);
});

test('releases microphone on page exit, including a pending permission request', async () => {
    const active = setup();
    await active.button.click();
    active.events.pagehide();
    assert.equal(active.track.stopped, true);
    let resolve;
    const pending = setup(stream => new Promise(done => { resolve = () => done(stream); }));
    const request = pending.button.click();
    pending.events.pagehide();
    resolve();
    await request;
    assert.equal(pending.track.stopped, true);
    assert.equal(pending.button.attributes['aria-pressed'], 'false');
});

test('resets the control when the device disconnects', async () => {
    const s = setup();
    await s.button.click();
    s.track.ended();
    assert.equal(s.button.attributes['aria-pressed'], 'false');
    assert.equal(s.track.stopped, true);
    assert.match(s.status.textContent, /disconnected/);
});
