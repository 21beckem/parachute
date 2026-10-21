const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(require('node:path').join(__dirname, '../connection.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup() {
    const peers = new Map(), clients = [];
    class Channel extends EventEmitter {
        constructor(peer, options) { super(); Object.assign(this, options); this.peer = peer; this.open = false; this.sent = []; }
        send(data) { if (!this.open) throw Error('closed'); this.sent.push(data); setImmediate(() => { if (this.other.open) this.other.emit('data', JSON.parse(JSON.stringify(data))); }); }
        close() { if (this.closed) return; this.closed = true; this.open = false; this.emit('close'); this.other?.close(); }
    }
    class Peer extends EventEmitter {
        constructor(id) { super(); this.id = id || webcrypto.randomUUID(); peers.set(this.id, this); setImmediate(() => { if (!this.destroyed) this.emit('open', this.id); }); }
        connect(id, options) {
            const a = new Channel(id, options), target = peers.get(id);
            if (!target) { setImmediate(() => this.emit('error', { type: 'peer-unavailable' })); return a; }
            const b = new Channel(this.id, options); a.other = b; b.other = a;
            setImmediate(() => {
                target.emit('connection', b);
                if (b.closed) return;
                a.open = b.open = true; a.emit('open'); b.emit('open');
            });
            return a;
        }
        destroy() { this.destroyed = true; peers.delete(this.id); }
    }
    function client() {
        const elements = {}, listeners = {}, drops = [];
        const panel = { dataset: {}, contains: target => target === panel, open: false, querySelector: () => ({ focus() {} }) };
        const document = { addEventListener: (event, fn) => listeners[event] = fn,
            getElementById: id => elements[id] ||= { value: id === 'package-kind' ? 'other' : '', addEventListener() {}, closest: () => panel, focus() {}, select() {} } };
        const window = { addEventListener() {}, ParachuteAnimation: { deliveries: new Set() }, animation: {
            startConnecting() {}, stopConnecting() {}, launchRocket: async () => true,
            dropParachute: (payload, kind) => drops.push({ payload, kind }) } };
        vm.runInNewContext(source, { window, document, navigator: {}, Peer, crypto: webcrypto, setTimeout, clearTimeout });
        const result = { c: window.parachuteConnection, window, panel, listeners, drops };
        clients.push(result); return result;
    }
    return { client, close: () => clients.forEach(s => s.c.destroy()) };
}
async function pair(t) {
    const s = setup(); t.after(s.close);
    const a = s.client(), b = s.client(); await tick();
    b.c.remote.value = a.c.local.value.toLowerCase(); b.c.connectToPeer();
    await tick(); await tick();
    assert.equal(a.c.state.textContent, 'Connected'); assert.equal(b.c.state.textContent, 'Connected');
    assert.equal(a.c.local.value, b.c.local.value);
    return { ...s, a, b };
}

test('shared room connects and sends acknowledged packages in both directions', async t => {
    const { a, b } = await pair(t);
    for (const kind of ['other', 'file', 'folder', 'music', 'link', 'picture', 'video']) {
        await a.c.sendParachute(kind); await tick(); await tick();
        assert.equal(b.drops.at(-1).kind, kind);
        assert.equal(b.drops.at(-1).payload.length, 0);
        assert.match(a.c.message.textContent, /confirmed receipt/);
        assert.equal(a.c.send.disabled, false);
    }
    await b.c.sendParachute('picture'); await tick(); await tick();
    assert.equal(a.drops[0].kind, 'picture'); assert.match(b.c.message.textContent, /confirmed receipt/);
    const packet = a.c.channel.sent.find(p => p.type === 'package');
    b.c.receive(packet); assert.equal(b.drops.length, 7, 'duplicate acknowledged without another drop');
    assert.equal(packet.rocket.action, 'launch');
});

test('invalid payloads, files, unknown receipts and sky overflow are rejected', async t => {
    const { a, b } = await pair(t);
    const packet = { type: 'package', version: 1, id: 'test', rocket: { action: 'launch' }, parachute: { kind: 'other', payload: [] } };
    for (const data of [null, {}, { ...packet, files: ['secret'] }, { ...packet, version: 2 },
        { ...packet, parachute: { kind: 'file', payload: ['secret'] } },
        { ...packet, parachute: { kind: 'invalid', payload: [] } }, { type: 'receipt', version: 1, id: 'unknown' }]) b.c.receive(data);
    assert.equal(b.drops.length, 0);
    b.window.ParachuteAnimation.deliveries = new Set(Array.from({ length: 20 }, (_, i) => i));
    b.c.receive(packet); assert.equal(b.drops.length, 0); assert.equal(b.c.channel.sent.length, 0);
    a.c.start(); assert.equal(b.c.ready, false); assert.equal(b.c.send.disabled, true);
});

test('invalid, self, missing and full rooms are handled; dropdown closes', async t => {
    const { a, b, client } = await pair(t);
    const c = client(); await tick();
    for (const code of ['bad/id', c.c.local.value]) { c.c.remote.value = code; c.c.connectToPeer(); assert.equal(c.c.ready, true); }
    c.c.remote.value = a.c.local.value; c.c.connectToPeer(); await tick(); await tick();
    assert.equal(a.c.state.textContent, 'Connected'); assert.equal(b.c.state.textContent, 'Connected');
    assert.equal(c.c.send.disabled, true);
    c.c.start(); await tick(); c.c.remote.value = 'ZZZZ-2222'; c.c.connectToPeer(); await tick(); await tick();
    assert.match(c.c.message.textContent, /Room not found/);
    a.panel.open = true; a.listeners.click({ target: {} }); assert.equal(a.panel.open, false);
    a.panel.open = true; a.listeners.keydown({ key: 'Escape' }); assert.equal(a.panel.open, false);
});

test('disconnect or reconnect during launch never sends a stale package', async t => {
    const { a, b } = await pair(t);
    let finish; a.window.animation.launchRocket = () => new Promise(resolve => finish = resolve);
    const channel = a.c.channel, flight = a.c.sendParachute();
    a.c.start(); finish(true); await flight;
    assert.equal(channel.sent.length, 0); assert.equal(b.drops.length, 0);
    await tick(); assert.equal(a.c.send.disabled, true);
});
