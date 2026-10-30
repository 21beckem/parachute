const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(
    require('node:path').join(__dirname, '../connection.js'),
    'utf8'
);
const tick = () => new Promise((resolve) => setImmediate(resolve));

function setup() {
    const peers = new Map(),
        clients = [];
    class Channel extends EventEmitter {
        constructor(peer, options) {
            super();
            Object.assign(this, options);
            this.peer = peer;
            this.open = false;
            this.sent = [];
        }
        send(data) {
            if (!this.open) throw Error('closed');
            this.sent.push(data);
            setImmediate(() => {
                if (this.other.open)
                    this.other.emit('data', JSON.parse(JSON.stringify(data)));
            });
        }
        close() {
            if (this.closed) return;
            this.closed = true;
            this.open = false;
            this.emit('close');
            this.other?.close();
        }
    }
    class Peer extends EventEmitter {
        constructor(options) {
            super();
            assert.equal(options.debug, 2);
            this.id = `Page-${webcrypto.randomUUID()}`;
            peers.set(this.id, this);
            setImmediate(() => {
                if (!this.destroyed) this.emit('open', this.id);
            });
        }
        connect(id, options) {
            const a = new Channel(id, options),
                target = peers.get(id);
            if (!target) {
                setImmediate(() =>
                    this.emit('error', { type: 'peer-unavailable' })
                );
                return a;
            }
            const b = new Channel(this.id, options);
            a.other = b;
            b.other = a;
            setImmediate(() => {
                target.emit('connection', b);
                if (b.closed) return;
                a.open = b.open = true;
                a.emit('open');
                b.emit('open');
            });
            return a;
        }
        destroy() {
            this.destroyed = true;
            peers.delete(this.id);
        }
    }
    function client() {
        const elements = {},
            listeners = {},
            packets = [];
        const panel = {
            dataset: {},
            contains: (target) => target === panel,
            open: false,
            querySelector: () => ({ focus() {} })
        };
        const document = {
            addEventListener: (event, fn) => (listeners[event] = fn),
            getElementById: (id) =>
                (elements[id] ||= {
                    value: '',
                    addEventListener() {},
                    closest: () => panel,
                    focus() {},
                    select() {}
                })
        };
        const window = {
            addEventListener() {},
            animation: { startConnecting() {}, stopConnecting() {} },
            parachuteSharing: {
                sync() {},
                reset() {},
                connected() {},
                transport: { receive: (data) => packets.push(data) }
            }
        };
        vm.runInNewContext(source, {
            window,
            document,
            navigator: {},
            Peer,
            crypto: webcrypto,
            setTimeout,
            clearTimeout,
            console: { error() {} }
        });
        const result = {
            c: window.parachuteConnection,
            window,
            panel,
            listeners,
            packets
        };
        clients.push(result);
        return result;
    }
    return { client, close: () => clients.forEach((s) => s.c.destroy()) };
}
async function pair(t) {
    const s = setup();
    t.after(s.close);
    const a = s.client(),
        b = s.client();
    await tick();
    b.c.remote.value = ` ${a.c.local.value} `;
    b.c.connectToPeer();
    await tick();
    await tick();
    assert.equal(a.c.state.textContent, 'Connected');
    assert.equal(b.c.state.textContent, 'Connected');
    assert.notEqual(a.c.local.value, b.c.local.value);
    assert.equal(a.c.remote.value, b.c.local.value);
    assert.equal(b.c.remote.value, a.c.local.value);
    return { ...s, a, b };
}

test('page IDs connect directly and forward transfer messages in both directions', async (t) => {
    const { a, b } = await pair(t);
    const packet = {
        version: 2,
        type: 'offer',
        id: 'test',
        sender: 'Sender',
        kind: 'link',
        url: 'https://example.com/'
    };
    a.c.channel.send(packet);
    await tick();
    assert.equal(b.packets[0].url, packet.url);
    assert.equal(a.c.channel.reliable, true);
    b.c.channel.send({ version: 2, type: 'accept', id: 'test' });
    await tick();
    assert.equal(a.packets[0].type, 'accept');
    assert.equal(a.c.send.disabled, false);
    const id = a.c.local.value;
    a.c.closeConnection();
    assert.equal(a.c.local.value, id);
    assert.equal(b.c.ready, true);
    assert.equal(b.c.send.disabled, true);
});

test('invalid, self, missing and busy peers are handled; dropdown closes', async (t) => {
    const { a, b, client } = await pair(t);
    const c = client();
    await tick();
    for (const code of ['bad/id', c.c.local.value]) {
        c.c.remote.value = code;
        c.c.connectToPeer();
        assert.equal(c.c.ready, true);
    }
    c.c.remote.value = a.c.local.value;
    c.c.connectToPeer();
    await tick();
    await tick();
    assert.equal(a.c.state.textContent, 'Connected');
    assert.equal(b.c.state.textContent, 'Connected');
    assert.equal(c.c.send.disabled, true);
    c.c.start();
    await tick();
    const id = c.c.local.value;
    c.c.remote.value = 'missing-peer';
    c.c.connectToPeer();
    await tick();
    await tick();
    assert.match(c.c.message.textContent, /Peer not found/);
    assert.equal(c.c.local.value, id);
    assert.equal(c.c.connect.disabled, false);
    a.panel.open = true;
    a.listeners.click({ target: {} });
    assert.equal(a.panel.open, false);
    a.panel.open = true;
    a.listeners.keydown({ key: 'Escape' });
    assert.equal(a.panel.open, false);
});

test('messages from a previous connection are ignored after a restart', async (t) => {
    const { a, b } = await pair(t);
    const oldChannel = a.c.channel;
    a.c.start();
    oldChannel.emit('data', { version: 2, type: 'offer', id: 'stale' });
    assert.equal(a.packets.length, 0);
    assert.equal(b.c.send.disabled, true);
    await tick();
    assert.equal(a.c.send.disabled, true);
});

test('both people clicking Connect converge on one connection', async (t) => {
    const s = setup();
    t.after(s.close);
    const a = s.client(),
        b = s.client();
    await tick();
    a.c.remote.value = b.c.local.value;
    b.c.remote.value = a.c.local.value;
    a.c.connectToPeer();
    b.c.connectToPeer();
    await tick();
    await tick();
    assert.equal(a.c.channel?.open, true);
    assert.equal(b.c.channel?.open, true);
    assert.equal(a.c.channel.other, b.c.channel);
    a.c.channel.send({ version: 2, type: 'offer', id: 'test' });
    await tick();
    assert.equal(b.packets[0].id, 'test');
});

test('case-sensitive IDs are kept intact; old peer events do not affect a retry', async (t) => {
    const s = setup();
    t.after(s.close);
    const a = s.client(),
        b = s.client();
    await tick();
    const oldPeer = a.c.peer;
    a.c.remote.value = b.c.local.value.toLowerCase();
    a.c.connectToPeer();
    await tick();
    await tick();
    assert.match(a.c.message.textContent, /Peer not found/);
    a.c.start();
    await tick();
    const id = a.c.local.value;
    oldPeer.emit('disconnected');
    oldPeer.emit('error', { type: 'network' });
    assert.equal(a.c.ready, true);
    assert.equal(a.c.local.value, id);
    a.c.remote.value = b.c.local.value;
    a.c.connectToPeer();
    await tick();
    await tick();
    assert.equal(a.c.state.textContent, 'Connected');
});
