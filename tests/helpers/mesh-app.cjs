const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { webcrypto } = require('node:crypto');
const sources = ['transfer.js', 'connection.js', 'sharing.js'].map(file => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'));
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(setImmediate); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function setup(t) {
    const clients = new Map();
    function client(uid, { audio, geo, beginResult, loadFailure, arrival } = {}) {
        const events = [], nodes = new Map(), timers = new Map(), deliveries = new Set();
        const permissionCalls = { audio: 0, location: 0, locationOptions: null };
        const receipts = [];
        let now = 0, nextTimer = 0, stopped = 0, reloads = 0, launches = 0;
        const panel = { dataset: {}, contains: () => false, querySelector: () => ({ focus() {} }) };
        const element = id => {
            if (!nodes.has(id)) nodes.set(id, {
                textContent: '', value: '', files: [], dataset: {}, children: [], listeners: {}, open: false,
                classList: { add() {} },
                addEventListener(event, callback) { this.listeners[event] = callback; },
                setAttribute(key, value) { this[key] = value; },
                removeAttribute(key) { delete this[key]; },
                getBoundingClientRect: () => ({ left: 500, right: 705, top: 580, bottom: 752 }),
                animate() { return { finished: arrival?.promise || Promise.resolve(), cancel() {} }; },
                closest: () => panel,
                append(...items) { this.children.push(...items); },
                prepend(item) { this.children.unshift(item); },
                replaceChildren(...items) { this.children = items; },
                remove() { this.removed = true; },
                showModal() { this.open = true; }, close() { this.open = false; }
            });
            return nodes.get(id);
        };
        const emitter = new EventEmitter();
        let context;
        const stream = { getTracks: () => [{ stop: () => stopped++ }] };
        const mesh = {
            uid, peers: [], connected: false, calls: [],
            on(name, callback) { emitter.on(name, callback); return () => emitter.off(name, callback); },
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
                const target = clients.get(to);
                if (!this.connected || !target?.mesh.connected) throw Error('Unknown peer');
                target.mesh.emit('relayMessage', { from: uid, msg: structuredClone(msg) });
            },
            async relay(to, data, options) {
                this.calls.push({ type: 'binary', to, data, options });
                await new Promise(setImmediate);
                const target = clients.get(to);
                if (!this.connected || !target?.mesh.connected) throw Error('Unknown peer');
                target.mesh.emit('relay', { from: uid, payload: new Uint8Array(data), meta: structuredClone(options.meta) });
            },
            disconnect() { this.connected = false; }
        };
        const window = {
            isSecureContext: true,
            matchMedia: () => ({ matches: false }),
            addEventListener() {},
            dispatchEvent(event) { events.push({ type: event.type, detail: event.detail, at: now }); },
            loadParachuteMesh: async () => { if (loadFailure) throw Error('offline'); return { MeshClient: mesh }; },
            ParachuteAnimation: { deliveries, typeOf: () => 'file' },
            animation: {
                receiveFileInBox(files) { receipts.push(files); },
                async launchRocket() { launches++; return true; },
                dropParachute(preview, type, options) {
                    const delivery = {
                        element: element(Symbol()), preview, type, options, disposed: false,
                        cancel(reason = 'cancelled') {
                            if (this.disposed) return;
                            this.disposed = true;
                            deliveries.delete(this);
                            if (reason !== 'received') options.onExpire?.(reason);
                        }
                    };
                    deliveries.add(delivery);
                    return delivery;
                }
            }
        };
        class Clock extends Date { static now() { return now; } }
        context = {
            window,
            document: { getElementById: element, querySelector: element, querySelectorAll: () => [], createElement: () => element(Symbol()), createElementNS: () => element(Symbol()), addEventListener() {} },
            navigator: {
                mediaDevices: { getUserMedia: () => { permissionCalls.audio++; return audio ? audio.promise : Promise.resolve(stream); } },
                geolocation: { getCurrentPosition(resolve, reject, options) {
                    permissionCalls.location++; permissionCalls.locationOptions = options;
                    return geo ? geo.promise.then(resolve, reject) : resolve({ coords: {} });
                } }
            },
            location: { reload: () => reloads++ },
            CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
            Date: Clock, ArrayBuffer, Uint8Array, File, Blob, URL, crypto: webcrypto, innerWidth: 1200, innerHeight: 800,
            setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, at: now + ms }); return id; },
            clearTimeout(id) { timers.delete(id); }, console: { error() {} }
        };
        vm.createContext(context);
        for (const source of sources) vm.runInContext(source, context);
        const result = {
            c: window.parachuteConnection, sharing: window.parachuteSharing, window, mesh, events, element, nodes, deliveries, permissionCalls, receipts,
            browserAPIs: context.navigator,
            get stopped() { return stopped; }, get reloads() { return reloads; }, get launches() { return launches; },
            async advance(ms) {
                now += ms;
                for (const [id, timer] of [...timers]) if (timers.has(id) && timer.at <= now) { timers.delete(id); timer.fn(); }
                await flush();
            },
            catchOffer(from) {
                const item = this.sharing.offers.get(from);
                if (!item) throw Error('No offer to catch');
                item.delivery.cancel('received');
                item.delivery.options.onCatch();
            },
            missOffer(from) { this.sharing.offers.get(from)?.delivery.cancel('missed'); }
        };
        clients.set(uid, result);
        t.after(() => {
            result.c.destroy();
            for (const entry of [...result.sharing.entries]) result.sharing.remove(entry);
        });
        return result;
    }
    async function start(app, name = 'Test user') {
        await app.c.loading;
        const pending = app.c.begin(name);
        await flush(); await app.advance(5000);
        if (!(await pending)) throw Error('Test startup failed');
    }
    function match(a, b) {
        if (!a.mesh.peers.includes(b.mesh.uid)) a.mesh.peers.push(b.mesh.uid);
        if (!b.mesh.peers.includes(a.mesh.uid)) b.mesh.peers.push(a.mesh.uid);
        a.mesh.emit('peerAdded', { uid: b.mesh.uid }); b.mesh.emit('peerAdded', { uid: a.mesh.uid });
    }
    function unmatch(a, b) {
        a.mesh.peers = a.mesh.peers.filter(uid => uid !== b.mesh.uid);
        b.mesh.peers = b.mesh.peers.filter(uid => uid !== a.mesh.uid);
        a.mesh.emit('peerRemoved', { uid: b.mesh.uid, score: 0.4 });
        b.mesh.emit('peerRemoved', { uid: a.mesh.uid, score: 0.4 });
    }
    return { client, start, match, unmatch, flush };
}
module.exports = { setup, deferred, flush };
