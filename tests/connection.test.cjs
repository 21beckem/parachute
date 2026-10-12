const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

class Emitter {
    constructor() { this.events = {}; }
    on(name, fn) { (this.events[name] ||= []).push(fn); }
    emit(name, value) { for (const fn of this.events[name] || []) fn(value); }
}
class Channel extends Emitter {
    constructor(id = 'friend') { super(); this.peer = id; this.label = 'parachute-v1'; this.open = false; this.sent = []; }
    close() { this.open = false; this.closed = true; this.emit('close'); }
    send(data) { this.sent.push(data); }
}
function setup() {
    const elements = {};
    const panel = { dataset: {} };
    const document = { getElementById: id => elements[id] ||= {
        value: '', addEventListener() {}, closest: () => panel, focus() {}, select() {}
    } };
    const peers = [], timers = new Map();
    let clock = 0, drops = 0, launches = 0;
    class Peer extends Emitter {
        constructor() { super(); peers.push(this); this.id = 'self'; }
        connect(id, options) { this.options = options; return this.channel = new Channel(id); }
        destroy() { this.destroyed = true; this.emit('close'); }
    }
    const window = {
        Peer, addEventListener() {}, ParachuteAnimation: { deliveries: new Set() },
        animation: { startConnecting() {}, stopConnecting() {},
            launchRocket: async () => { launches++; return true; },
            dropParachute: payload => { assert.equal(payload.length, 0); drops++; } }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../connection.js'), 'utf8'), {
        window, document, navigator: {},
        setTimeout: fn => { timers.set(++clock, fn); return clock; },
        clearTimeout: id => timers.delete(id)
    });
    const controller = window.parachuteConnection;
    peers[0].emit('open', 'self');
    return { controller, peers, timers, window, elements, panel, drops: () => drops, launches: () => launches };
}

test('connects by trimmed ID, sends only the animation command and receives empty parachutes', async () => {
    const s = setup(), c = s.controller;
    assert.equal(c.local.value, 'self');
    assert.equal(c.send.disabled, true);
    c.remote.value = ' friend ';
    c.connectToPeer();
    const channel = c.connection;
    assert.equal(channel.peer, 'friend');
    channel.open = true; channel.emit('open');
    assert.equal(c.send.disabled, false);
    await c.sendParachute();
    assert.equal(JSON.stringify(channel.sent), '[{"type":"parachute","version":1}]');
    assert.equal(s.drops(), 0, 'sending does not drop locally');
    assert.equal(s.launches(), 1);
    channel.emit('data', { type: 'parachute', version: 1 });
    assert.equal(s.drops(), 1);
    for (const data of [null, 'parachute', { type: 'file' }, { type: 'parachute', version: 2 },
        { type: 'parachute', version: 1, files: ['secret.txt'] }]) channel.emit('data', data);
    assert.equal(s.drops(), 1, 'unknown and file payloads are ignored');
});

test('accepts incoming connections, rejects extra peers, and supports sending back', async () => {
    const s = setup(), c = s.controller, incoming = new Channel();
    s.peers[0].emit('connection', incoming);
    incoming.open = true; incoming.emit('open');
    await c.sendParachute();
    assert.equal(incoming.sent.length, 1);
    const extra = new Channel('someone-else');
    s.peers[0].emit('connection', extra);
    assert.equal(extra.closed, true);
    incoming.close();
    assert.equal(c.connection, null);
    assert.equal(c.send.disabled, true);
    assert.equal(c.connect.disabled, false);
});

test('self IDs, malformed IDs, unavailable peers, cancellation and timeout recover', () => {
    const s = setup(), c = s.controller;
    for (const id of ['self', 'bad/id', '']) { c.remote.value = id; c.connectToPeer(); assert.equal(c.connection, null); }
    c.remote.value = 'missing'; c.connectToPeer();
    s.peers[0].emit('error', { type: 'peer-unavailable' });
    assert.equal(c.connection, null);
    assert.equal(c.connect.disabled, false);
    c.connectToPeer();
    for (const fn of [...s.timers.values()]) fn();
    assert.equal(c.connection, null);
    assert.match(c.message.textContent, /timed out/);
    c.connectToPeer();
    const old = c.connection;
    c.closeConnection('Cancelled.');
    old.open = true; old.emit('open');
    old.emit('data', { type: 'parachute', version: 1 });
    assert.equal(c.send.disabled, true);
    assert.equal(s.drops(), 0);
});

test('disconnect during launch prevents sending to a closed or replacement connection', async () => {
    const s = setup(), c = s.controller;
    c.remote.value = 'friend'; c.connectToPeer();
    const channel = c.connection;
    channel.open = true; channel.emit('open');
    let finish;
    s.window.animation.launchRocket = () => new Promise(resolve => { finish = resolve; });
    const flight = c.sendParachute();
    await c.sendParachute(); // No overlapping send.
    channel.close();
    finish(true); await flight;
    assert.equal(channel.sent.length, 0);
    assert.equal(c.send.disabled, true);
});

test('service failure and retry ignore stale events and clean up the previous peer', () => {
    const s = setup(), c = s.controller, old = s.peers[0];
    old.emit('error', { type: 'network' });
    assert.equal(old.destroyed, true);
    assert.equal(c.retry.hidden, false);
    c.start();
    old.emit('open', 'stale');
    assert.equal(c.local.value, '');
    s.peers[1].emit('open', 'new-id');
    assert.equal(c.local.value, 'new-id');
    assert.equal(c.connect.disabled, false);
});

test('simultaneous connection attempts deterministically keep the same channel', () => {
    const s = setup(), c = s.controller;
    c.remote.value = 'friend'; c.connectToPeer();
    const outgoing = c.connection, incoming = new Channel('friend');
    s.peers[0].emit('connection', incoming);
    assert.equal(outgoing.closed, true); // self > friend; keep the incoming dial.
    assert.equal(c.connection, incoming);
});
