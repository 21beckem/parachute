// UI-only fixture: synthetic permissions and a BroadcastChannel mesh.
// No microphone, location, detection server, or user files are accessed.
// Run with node tests/mesh-preview.cjs, then open localhost:3001 in two tabs.
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { createParachuteServer } = require('../server.cjs');
const fixture = `
const isHostedLocally = false;
class FixtureMesh {
    constructor() {
        this.uid = Math.floor(Math.random() * 1000000);
        this.peers = [];
        this.listeners = new Map();
        this.bus = new BroadcastChannel('parachute-ui-fixture');
        this.bus.onmessage = ({data}) => {
            if (!this.ready || data.from === this.uid) return;
            if (data.type === 'hello') {
                if (!this.peers.includes(data.from)) {
                    this.peers.push(data.from);
                    this.emit('peerAdded', { uid: data.from });
                    this.emit('peersUpdated');
                }
                if (data.reply) this.bus.postMessage({ type: 'hello', from: this.uid });
            } else if (data.to === this.uid) {
                this.emit(data.type === 'binary' ? 'relay' : 'relayMessage', data.transfer);
            }
        };
    }
    on(event, fn) {
        if (!this.listeners.has(event)) this.listeners.set(event, new Set());
        this.listeners.get(event).add(fn);
        return () => this.listeners.get(event).delete(fn);
    }
    emit(event, value) { for (const fn of this.listeners.get(event) || []) fn(value); }
    async init() { this.connected = true; this.emit('initialized'); }
    async begin() {
        this.ready = true;
        this.timer = setInterval(() => this.bus.postMessage({ type: 'hello', from: this.uid, reply: true }), 1000);
        return { success: true };
    }
    async relayMessage(to, msg) {
        this.bus.postMessage({ type: 'message', from: this.uid, to, transfer: { from: this.uid, msg } });
    }
    async relay(to, bytes, {meta}) {
        this.bus.postMessage({ type: 'binary', from: this.uid, to,
            transfer: { from: this.uid, payload: new Uint8Array(bytes), meta } });
    }
    disconnect() { clearInterval(this.timer); this.bus.close(); }
}
export const MeshClient = new FixtureMesh();
`;
const permissions = `
Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => ({getTracks: () => [{stop() {}}]}) });
Object.defineProperty(navigator.geolocation, 'getCurrentPosition', { value: (resolve) => resolve({coords: {latitude: 0, longitude: 0}}) });
`;
const server = createParachuteServer({ fetchMesh: async () => new Response(fixture) });
const serve = server.listeners('request')[0];
server.removeAllListeners('request');
server.on('request', (req, res) => {
    if (req.url === '/') {
        res.setHeader('Content-Type', 'text/html');
        return res.end(readFileSync(path.join(__dirname, '../index.html'), 'utf8')
            .replace('<title>Parachute</title>', '<title>Parachute · UI fixture</title><script src="/fixture-permissions.js"></script>'));
    }
    if (req.url === '/fixture-permissions.js') {
        res.setHeader('Content-Type', 'text/javascript');
        return res.end(permissions);
    }
    return serve(req, res);
});
server.listen(3001, '127.0.0.1', () => console.log('UI fixture only: http://localhost:3001'));
