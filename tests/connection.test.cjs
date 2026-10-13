const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const tick = () => new Promise(resolve => setImmediate(resolve));

async function setup() {
    const elements = {}, listeners = {}, streams = [], requests = [];
    const panel = { dataset: {}, contains: target => target === panel, open: false, querySelector: () => ({ focus() {} }) };
    const document = {
        addEventListener: (event, fn) => listeners[event] = fn,
        getElementById: id => elements[id] ||= {
            value: '', addEventListener() {}, closest: () => panel, focus() {}, select() {}
        }
    };
    let drops = 0;
    class EventSource {
        constructor() { streams.push(this); }
        close() { this.closed = true; }
        emit(data) { this.onmessage({ data: JSON.stringify(data) }); }
    }
    const window = {
        addEventListener() {}, ParachuteAnimation: { deliveries: new Set() },
        animation: { startConnecting() {}, stopConnecting() {}, launchRocket: async () => true,
            dropParachute: payload => { assert.equal(payload.length, 0); drops++; } }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../connection.js'), 'utf8'), {
        window, document, navigator: {}, EventSource, AbortSignal, setTimeout, clearTimeout,
        fetch: async (url, options) => {
            requests.push({ url, options });
            return { ok: true, json: async () => ({ code: 'ABCD2345', token: 'secret' }) };
        }
    });
    await tick();
    streams[0].emit({ type: 'ready', partner: null });
    return { c: window.parachuteConnection, window, streams, requests, panel, listeners, drops: () => drops };
}

test('formats codes, joins, sends only parachutes, receives, and closes dropdown', async t => {
    const s = await setup(), c = s.c;
    t.after(() => c.destroy());
    assert.equal(c.local.value, 'ABCD-2345');
    assert.equal(c.send.disabled, true);
    c.remote.value = ' efgh-6789 ';
    await c.connectToPeer();
    assert.equal(s.requests.at(-1).options.body, '{"code":"EFGH6789"}');
    s.streams[0].emit({ type: 'connected', code: 'EFGH6789', pairId: 'pair' });
    await c.sendParachute();
    assert.equal(s.requests.at(-1).options.body, '{"type":"parachute","version":1,"code":"EFGH6789","pairId":"pair"}');
    assert.equal(s.drops(), 0);
    s.streams[0].emit({ type: 'parachute', version: 1 });
    s.streams[0].emit({ type: 'parachute', version: 1, files: ['secret'] });
    assert.equal(s.drops(), 1);
    s.panel.open = true;
    s.listeners.click({ target: {} });
    assert.equal(s.panel.open, false);
    s.panel.open = true;
    s.listeners.keydown({ key: 'Escape' });
    assert.equal(s.panel.open, false);
});

test('invalid and self codes are rejected; disconnect during launch prevents sending', async t => {
    const s = await setup(), c = s.c;
    t.after(() => c.destroy());
    for (const code of ['', 'bad/id', 'ABCD-2345']) {
        c.remote.value = code;
        await c.connectToPeer();
        assert.equal(s.requests.length, 1);
    }
    s.streams[0].emit({ type: 'connected', code: 'EFGH6789' });
    let finish;
    s.window.animation.launchRocket = () => new Promise(resolve => finish = resolve);
    const flight = c.sendParachute();
    s.streams[0].emit({ type: 'disconnected' });
    finish(true);
    await flight;
    assert.equal(s.requests.length, 1);
    assert.equal(c.send.disabled, true);
});

test('service loss disables sending; retry discards stale events', async t => {
    const s = await setup(), c = s.c;
    t.after(() => c.destroy());
    const old = s.streams[0];
    old.onerror();
    assert.equal(old.closed, true);
    assert.equal(c.retry.hidden, false);
    assert.equal(c.ready, false);
    await c.start();
    old.emit({ type: 'connected', code: 'OLD23456' });
    assert.equal(c.partner, null);
    s.streams[1].emit({ type: 'ready', partner: null });
    assert.equal(c.ready, true);
});

test('reconnecting to the same friend during launch does not send the old parachute', async t => {
    const s = await setup(), c = s.c;
    t.after(() => c.destroy());
    s.streams[0].emit({ type: 'connected', code: 'EFGH6789', pairId: 'first' });
    let finish;
    s.window.animation.launchRocket = () => new Promise(resolve => finish = resolve);
    const flight = c.sendParachute();
    s.streams[0].emit({ type: 'disconnected' });
    s.streams[0].emit({ type: 'connected', code: 'EFGH6789', pairId: 'second' });
    finish(true);
    await flight;
    assert.equal(s.requests.length, 1);
});
