const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { webcrypto } = require('node:crypto');
const path = require('node:path');
// Substitute only the network import; exercise the real controller and transfer protocol.
const source = fs.readFileSync(path.join(__dirname, '../connection.js'), 'utf8')
    .replace('window.loadParachuteMesh()', 'window.loadMesh()');
const transferSource = fs.readFileSync(path.join(__dirname, '../transfer.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };

function setup(t) {
    const clients = new Map();
    function client(uid, { audio, geo, beginResult, loadFailure } = {}) {
        const events = [], elements = new Map(), timers = new Map();
        let now = 0, timerId = 0, stopped = 0, reloads = 0;
        const permissionCalls = { audio: 0, location: 0, locationOptions: null };
        const stream = { getTracks: () => [{ stop: () => stopped++ }] };
        const panel = { dataset: {}, contains: () => false, querySelector: () => ({ focus() {} }) };
        function element(id) {
            if (!elements.has(id)) elements.set(id, {
                textContent: '', disabled: false, hidden: false, children: [], listeners: {},
                addEventListener(event, fn) { this.listeners[event] = fn; },
                closest: () => panel,
                replaceChildren(...items) { this.children = items; },
                append(...items) { this.children.push(...items); },
                setAttribute(key, value) { this[key] = value; }
            });
            return elements.get(id);
        }
        const emitter = new EventEmitter();
        const mesh = {
            uid, peers: [], connected: false, calls: [],
            on(event, callback) { emitter.on(event, callback); return () => emitter.off(event, callback); },
            emit: (...args) => emitter.emit(...args),
            async init() { this.connected = true; this.emit('initialized'); },
            async begin() {
                this.calls.push('begin');
                const results = await Promise.allSettled([
                    context.navigator.mediaDevices.getUserMedia({ audio: true }),
                    new Promise((resolve, reject) => context.navigator.geolocation.getCurrentPosition(resolve, reject, {
                        enableHighAccuracy: true, timeout: 10000, maximumAge: 0
                    }))
                ]);
                for (let i = 0; i < results.length; i++) {
                    if (results[i].status === 'rejected') {
                        const stage = i === 0 ? 'audio' : 'location';
                        this.emit('startError', { stage, result: { error: results[i].reason } });
                        throw Error(`Failed to begin ${stage} stream: [object GeolocationPositionError]`);
                    }
                }
                return beginResult ? beginResult.promise : { success: true };
            },
            async relayMessage(to, msg) {
                this.calls.push({ type: 'message', to, msg });
                await new Promise(setImmediate);
                clients.get(to)?.mesh.emit('relayMessage', { from: uid, msg: structuredClone(msg) });
            },
            async relay(to, data, options) {
                this.calls.push({ type: 'binary', to, data, options });
                await new Promise(setImmediate);
                clients.get(to)?.mesh.emit('relay', { from: uid, payload: new Uint8Array(data), meta: options.meta });
            },
            disconnect() { this.connected = false; }
        };
        const window = {
            isSecureContext: true,
            addEventListener() {},
            dispatchEvent(event) { events.push({ type: event.type, detail: event.detail, at: now }); },
            loadMesh: async () => { if (loadFailure) throw Error('offline'); return { MeshClient: mesh }; },
            parachuteSharing: {
                transport: null, sync() {},
                reset() { this.transport?.close(); this.transport = null; },
                connected(channel) {
                    this.reset();
                    this.transport = new window.ParachuteTransfer(channel, {
                        onOffer: (offer) => { if (offer && this.autoAccept) this.transport.accept(); },
                        onComplete: (result) => this.results.push(result)
                    });
                },
                results: [], autoAccept: false
            }
        };
        class Clock extends Date { static now() { return now; } }
        const context = {
            window, document: { getElementById: element, createElement: () => element(Symbol()), addEventListener() {} },
            navigator: {
                mediaDevices: { getUserMedia: () => {
                    permissionCalls.audio++;
                    return audio ? audio.promise : Promise.resolve(stream);
                } },
                geolocation: { getCurrentPosition: (resolve, reject, options) => {
                    permissionCalls.location++;
                    permissionCalls.locationOptions = options;
                    return geo ? geo.promise.then(resolve, reject) : resolve({ coords: {} });
                } }
            },
            location: { reload: () => reloads++ },
            CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
            Date: Clock, ArrayBuffer, Uint8Array, File, Blob, URL, crypto: webcrypto,
            setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, at: now + ms }); return id; },
            clearTimeout(id) { timers.delete(id); }, console
        };
        vm.runInNewContext(transferSource, context);
        vm.runInNewContext(source, context);
        const result = {
            c: window.parachuteConnection, window, mesh, events, elements, element, permissionCalls,
            browserAPIs: context.navigator,
            get stopped() { return stopped; }, get reloads() { return reloads; },
            async advance(ms) {
                now += ms;
                for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
                await flush();
            }
        };
        clients.set(uid, result);
        t.after(() => result.c.destroy());
        return result;
    }
    async function start(result, name) {
        await result.c.loading;
        const pending = result.c.begin(name);
        await flush();
        await result.advance(5000);
        assert.equal(await pending, true);
    }
    function match(a, b) {
        a.mesh.peers.push(b.mesh.uid); b.mesh.peers.push(a.mesh.uid);
        a.mesh.emit('peerAdded', { uid: b.mesh.uid }); b.mesh.emit('peerAdded', { uid: a.mesh.uid });
    }
    return { client, start, match };
}

test('both permissions must succeed before the five-second selection window starts', async (t) => {
    const { client } = setup(t);
    const audio = deferred(), geo = deferred();
    const a = client(1, { audio, geo });
    await a.c.loading;
    const pending = a.c.begin('A');
    audio.resolve({ getTracks: () => [{ stop() {} }] });
    await a.advance(10000);
    assert.equal(a.events.some(e => e.type === 'discovery-warmup-start'), false);
    assert.equal(a.mesh.calls.length, 1);
    geo.resolve({ coords: {} });
    await flush();
    assert.equal(a.events.find(e => e.type === 'discovery-warmup-start').at, 10000);
    await a.advance(4999);
    assert.equal(a.c.active, false);
    a.c.selectDevice(2);
    assert.equal(a.c.channel, null);
    await a.advance(1);
    assert.equal(await pending, true);
    assert.equal(a.c.active, true);
    assert.equal(a.permissionCalls.audio, 1, 'only MeshClient requests the microphone');
    assert.equal(a.permissionCalls.location, 1, 'only MeshClient requests location');
});

test('a slow analyzer keeps selection locked beyond five seconds', async (t) => {
    const { client } = setup(t);
    const beginResult = deferred();
    const a = client(1, { beginResult });
    await a.c.loading;
    const pending = a.c.begin('A');
    await flush();
    await a.advance(8000);
    assert.equal(a.c.active, false);
    beginResult.resolve({ success: true });
    await flush();
    await a.advance(0);
    assert.equal(await pending, true);
});

test('denied location releases the scanner microphone and explains the actual error', async (t) => {
    const { client } = setup(t);
    const geo = deferred();
    const a = client(1, { geo });
    const nativeAudio = a.browserAPIs.mediaDevices.getUserMedia;
    const nativeLocation = a.browserAPIs.geolocation.getCurrentPosition;
    const messages = [];
    const pending = a.c.begin('A', message => messages.push(message));
    geo.reject({ code: 1, message: 'User denied geolocation' });
    assert.equal(await pending, false);
    assert.equal(a.stopped, 1);
    assert.equal(a.mesh.calls.length, 1);
    assert.equal(a.c.active, false);
    assert.match(messages.at(-1), /Location access is blocked/);
    assert.equal(a.browserAPIs.mediaDevices.getUserMedia, nativeAudio);
    assert.equal(a.browserAPIs.geolocation.getCurrentPosition, nativeLocation);
});

test('location timeouts allow a recent fix and show a useful retry message', async (t) => {
    const { client } = setup(t);
    const geo = deferred();
    const a = client(1, { geo });
    const messages = [];
    const pending = a.c.begin('A', message => messages.push(message));
    await flush();
    assert.equal(a.permissionCalls.locationOptions.timeout, 30000);
    assert.equal(a.permissionCalls.locationOptions.maximumAge, 60000);
    assert.equal(a.permissionCalls.locationOptions.enableHighAccuracy, true);
    geo.reject({ code: 3, message: 'Timeout expired' });
    assert.equal(await pending, false);
    assert.match(messages.at(-1), /Finding your location timed out/);
    assert.doesNotMatch(messages.at(-1), /\[object/);
    assert.equal(a.stopped, 1);
});

test('names exchange safely; binary files and links travel both ways only after consent', async (t) => {
    const { client, start, match } = setup(t);
    const a = client(1), b = client(2);
    await start(a, 'A'); await start(b, '<b>B</b>');
    match(a, b); await flush();
    assert.equal(a.c.devices.get(2).name, '<b>B</b>');
    assert.equal(a.element('nearby-devices').children[0].children[0].textContent, '<b>B</b>');
    a.c.selectDevice(2);
    const bytes = Uint8Array.from({ length: 70000 }, (_, i) => i % 251);
    const pending = a.window.parachuteSharing.transport.send({ files: [new File([bytes], 'test.bin')], sender: 'A' });
    await flush();
    assert.equal(b.window.parachuteSharing.transport.incoming.accepted, false);
    assert.equal(a.mesh.calls.some(c => c.type === 'binary'), false);
    b.window.parachuteSharing.transport.accept();
    await pending;
    const result = b.window.parachuteSharing.results[0];
    assert.deepEqual(new Uint8Array(await result.files[0].arrayBuffer()), bytes);
    assert.equal(a.mesh.calls.filter(c => c.type === 'binary').length, 2);
    assert.equal(a.mesh.calls.filter(c => c.type === 'message').some(c => c.msg.bytes), false);
    a.window.parachuteSharing.autoAccept = true;
    await b.window.parachuteSharing.transport.send({ url: 'https://example.com/', sender: 'B' });
    assert.equal(a.window.parachuteSharing.results[0].url, 'https://example.com/');
});

test('unmatched senders are ignored, busy recipients decline, and lost peers disable sharing', async (t) => {
    const { client, start, match } = setup(t);
    const a = client(1), b = client(2), c = client(3);
    await start(a, 'A'); await start(b, 'B'); await start(c, 'C');
    a.c.receiveMessage({ from: 99, msg: { version: 2, type: 'offer', id: 'unknown' } });
    assert.equal(a.c.channel, null);
    match(a, b); match(a, c); await flush();
    a.c.selectDevice(2);
    a.window.parachuteSharing.transport.incoming = { id: 'busy' };
    a.c.receiveMessage({ from: 3, msg: { version: 2, type: 'offer', id: 'other' } });
    assert.equal(a.c.channel.peer, 2);
    assert.equal(a.mesh.calls.at(-1).msg.type, 'decline');
    a.window.parachuteSharing.transport.incoming = null;
    a.mesh.peers = [3]; a.mesh.emit('peerRemoved', { uid: 2 });
    assert.equal(a.c.channel, null);
    assert.equal(a.c.send.disabled, true);
});

test('a room-match loss during a binary transfer preserves bytes, consent, and later links', async (t) => {
    const { client, start, match } = setup(t);
    const a = client(1), b = client(2);
    await start(a, 'A'); await start(b, 'B');
    match(a, b); await flush();
    a.c.selectDevice(2);
    b.window.parachuteSharing.autoAccept = true;
    const bytes = Uint8Array.from({ length: 150000 }, (_, i) => i % 251);
    const gate = deferred();
    let readingSecondChunk = false;
    t.after(() => gate.resolve());
    const file = {
        name: 'room-change.bin', size: bytes.length, type: 'application/octet-stream',
        slice(start, end) {
            return { async arrayBuffer() {
                if (start > 0) { readingSecondChunk = true; await gate.promise; }
                return bytes.slice(start, end).buffer;
            } };
        }
    };
    const flight = a.window.parachuteSharing.transport.send({ files: [file], sender: 'A' });
    for (let i = 0; i < 20 && !readingSecondChunk; i++) await flush();
    assert.equal(readingSecondChunk, true);
    const aChannel = a.c.channel, bChannel = b.c.channel;
    a.mesh.peers = []; b.mesh.peers = [];
    a.mesh.emit('peerRemoved', { uid: 2, score: 0.4 });
    b.mesh.emit('peerRemoved', { uid: 1, score: 0.4 });
    await flush();
    assert.equal(a.c.channel, aChannel);
    assert.equal(b.c.channel, bChannel);
    assert.equal(a.mesh.peers.length, 0, 'the app must not invent a new sound match');
    assert.match(a.c.message.textContent, /Room signal changed/);
    gate.resolve();
    await flight;
    assert.deepEqual(new Uint8Array(await b.window.parachuteSharing.results[0].files[0].arrayBuffer()), bytes);
    a.window.parachuteSharing.autoAccept = true;
    await b.window.parachuteSharing.transport.send({ url: 'https://example.com/after-room-change', sender: 'B' });
    assert.equal(a.window.parachuteSharing.results[0].url, 'https://example.com/after-room-change');
    match(a, b); await flush();
    assert.equal(a.c.channel, aChannel);
    assert.doesNotMatch(a.c.message.textContent, /Room signal changed/);
});

test('an unreachable recipient after a room-match loss still aborts the pending transfer', async (t) => {
    const { client, start, match } = setup(t);
    const a = client(1), b = client(2);
    await start(a, 'A'); await start(b, 'B');
    match(a, b); await flush();
    a.c.selectDevice(2);
    const flight = a.window.parachuteSharing.transport.send({ url: 'https://example.com/' });
    const failure = assert.rejects(flight, /Connection closed/);
    await flush();
    a.mesh.relayMessage = async () => { throw Error('Unknown peer'); };
    a.mesh.peers = [];
    a.mesh.emit('peerRemoved', { uid: 2, score: 0 });
    await failure;
    assert.equal(a.c.channel, null);
    assert.equal(a.c.send.disabled, true);
    assert.match(a.c.message.textContent, /no longer reachable/);
});

test('service failure and disconnect during warmup never enable sharing; stop reloads', async (t) => {
    const { client } = setup(t);
    const offline = client(9, { loadFailure: true });
    assert.equal(await offline.c.loading, false);
    const a = client(1);
    await a.c.loading;
    const pending = a.c.begin('A');
    await flush();
    a.mesh.connected = false; a.mesh.emit('disconnected');
    await a.advance(5000);
    assert.equal(await pending, false);
    assert.equal(a.c.active, false);
    assert.equal(a.c.send.disabled, true);
    a.c.stopDiscovery();
    assert.equal(a.reloads, 1);
});

test('a failed mesh relay aborts the pending transfer and disables sharing', async (t) => {
    const { client, start, match } = setup(t);
    const a = client(1), b = client(2);
    await start(a, 'A'); await start(b, 'B');
    match(a, b); await flush();
    a.c.selectDevice(2);
    a.mesh.relayMessage = async () => { throw Error('relay offline'); };
    await assert.rejects(a.window.parachuteSharing.transport.send({ url: 'https://example.com/' }), /Connection closed/);
    assert.equal(a.c.channel, null);
    assert.equal(a.c.send.disabled, true);
    assert.match(a.c.message.textContent, /relay offline/);
});
