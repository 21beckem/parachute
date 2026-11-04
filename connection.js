// Only MeshClient is imported. Its modules, worker, and model load automatically.
const IDENTITY = 'parachute:identity:v1';
const WARMUP_MS = 5000;

class ParachuteConnection {
    constructor() {
        this.devices = new Map();
        this.handshakes = new Map();
        this.unsubscribers = [];
        this.active = false;
        this.starting = false;
        this.ready = false;
        this.channel = null;
        this.generation = 0;
        this.state = document.getElementById('connection-state');
        this.message = document.getElementById('connection-message');
        this.list = document.getElementById('nearby-devices');
        this.empty = document.getElementById('nearby-empty');
        this.send = document.getElementById('send-parachute');
        this.panel = this.state.closest('.connection-panel');
        this.send.addEventListener('click', () => window.parachuteSharing?.open());
        document.getElementById('disconnect-device').addEventListener('click', () => this.closeConnection());
        document.getElementById('retry-discovery').addEventListener('click', () => this.stopDiscovery());
        document.addEventListener('click', (event) => {
            if (!this.panel.contains(event.target)) this.panel.open = false;
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this.panel.open) {
                this.panel.open = false;
                this.panel.querySelector('summary').focus();
            }
        });
        // The upstream singleton cannot restart or release its private microphone.
        // Reloading is the supported way to stop capture and begin a new session.
        document.getElementById('stop-discovery').addEventListener('click', () => this.stopDiscovery());
        window.addEventListener('pagehide', () => this.destroy());
        window.addEventListener('pageshow', (event) => {
            if (event.persisted) location.reload();
        });
        this.loading = this.initialize();
    }

    listen(event, callback) {
        this.unsubscribers.push(this.mesh.on(event, callback));
    }

    async withTimeout(promise) {
        let timer;
        try {
            return await Promise.race([promise, new Promise((_, reject) => {
                timer = setTimeout(() => reject(Error('The discovery service timed out. Reload to retry.')), 30000);
            })]);
        } finally { clearTimeout(timer); }
    }

    async initialize() {
        try {
            const { MeshClient } = await this.withTimeout(window.loadParachuteMesh());
            this.mesh = MeshClient;
            this.listen('initialized', () => { this.initialized = true; });
            this.listen('initError', ({ error }) => { this.initError = error; });
            this.listen('peerAdded', ({ uid }) => {
                if (this.active) this.identify(uid);
                this.render();
            });
            this.listen('peerRemoved', ({ uid }) => {
                this.stopHandshake(uid);
                this.devices.delete(uid);
                if (this.channel?.peer === uid) this.closeConnection('That device left the nearby list.');
                this.render();
            });
            this.listen('peersUpdated', () => this.render());
            this.listen('relayMessage', (transfer) => this.receiveMessage(transfer));
            this.listen('relay', (transfer) => this.receiveBinary(transfer));
            this.listen('disconnected', () => {
                this.active = this.ready = false;
                this.generation++;
                for (const uid of this.handshakes.keys()) this.stopHandshake(uid);
                this.devices.clear();
                this.closeConnection('Discovery disconnected. Reload to reconnect.');
                document.getElementById('retry-discovery').hidden = false;
                window.dispatchEvent(new CustomEvent('discovery-error', {
                    detail: 'Discovery disconnected. Reload to reconnect.'
                }));
            });
            await this.withTimeout(this.mesh.init());
            if (!this.initialized || !this.mesh.connected)
                throw this.initError || Error('The discovery server could not connect.');
            window.dispatchEvent(new CustomEvent('discovery-initialized'));
            return true;
        } catch (error) {
            this.loadError = error;
            console.error('Parachute scanner initialization failed:', error);
            this.mesh?.disconnect();
            this.render('Nearby discovery could not load. Check your connection and reload.');
            window.dispatchEvent(new CustomEvent('discovery-error', {
                detail: `The nearby scanner could not load: ${error.message || 'Unknown connection error'}. Reload to try again.`
            }));
            return false;
        }
    }

    async begin(displayName, onStatus = () => {}) {
        if (this.starting || this.active) return false;
        this.starting = true;
        const generation = this.generation;
        const current = () => generation === this.generation;
        let permissionStream;
        try {
            if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !navigator.geolocation)
                throw Error('Microphone and location access need HTTPS or localhost in a supported browser.');
            onStatus('Allow microphone and location access to find nearby devices.');
            // Request both on Connect. Do not start the five-second window until
            // both have actually succeeded. MeshClient owns the lasting mic stream.
            const permissions = await Promise.allSettled([
                navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
                    permissionStream = stream;
                    return stream;
                }),
                new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true, timeout: 20000, maximumAge: 0
                }))
            ]);
            const denied = permissions.find((result) => result.status === 'rejected');
            if (denied) throw Error('Microphone and location are both needed. Allow them in your browser and try again.');
            if (!current()) throw Error('Discovery stopped. Reload to reconnect.');
            window.parachuteProfile = { displayName };
            const permissionsAcceptedAt = Date.now();
            this.permissionsAcceptedAt = permissionsAcceptedAt;
            onStatus('Permissions accepted. Getting five seconds of room sound…');
            // Future animation hook. The matching end event fires only when the
            // minimum window AND MeshClient readiness have both completed.
            window.dispatchEvent(new CustomEvent('discovery-warmup-start', {
                detail: { durationMs: WARMUP_MS, startedAt: permissionsAcceptedAt }
            }));
            if (!(await this.loading)) throw this.loadError || Error('The discovery service could not load. Reload to retry.');
            if (!current()) throw Error('Discovery stopped. Reload to reconnect.');
            permissionStream.getTracks().forEach((track) => track.stop());
            permissionStream = null;
            const result = await this.withTimeout(this.mesh.begin());
            if (!result?.success || !this.mesh.connected) throw Error('The scanner could not start. Reload and try again.');
            await new Promise((resolve) => setTimeout(resolve, Math.max(0, WARMUP_MS - (Date.now() - permissionsAcceptedAt))));
            if (!current() || !this.mesh.connected) throw Error('Discovery stopped. Reload to reconnect.');
            this.ready = this.active = true;
            window.dispatchEvent(new CustomEvent('discovery-warmup-end'));
            for (const uid of this.mesh.peers) this.identify(uid);
            this.panel.open = true;
            this.render();
            return true;
        } catch (error) {
            onStatus(error.message || 'Discovery could not start. Check your permissions and retry.');
            window.dispatchEvent(new CustomEvent('discovery-warmup-error', { detail: error.message }));
            return false;
        } finally {
            permissionStream?.getTracks().forEach((track) => track.stop());
            this.starting = false;
        }
    }

    stopHandshake(uid) {
        clearTimeout(this.handshakes.get(uid)?.timer);
        this.handshakes.delete(uid);
    }

    sendIdentity(uid, requestIdentity) {
        return this.mesh.relayMessage(uid, {
            type: IDENTITY,
            name: window.parachuteProfile.displayName,
            requestIdentity
        });
    }

    identify(uid) {
        if (!this.active || this.devices.has(uid) || this.handshakes.has(uid)) return;
        const state = { attempts: 0, timer: null };
        this.handshakes.set(uid, state);
        const attempt = async () => {
            if (this.handshakes.get(uid) !== state || !this.active || !this.mesh.peers.includes(uid)) return;
            state.attempts++;
            try { await this.sendIdentity(uid, true); } catch { /* Retry while the other device finishes starting. */ }
            if (this.handshakes.get(uid) !== state) return;
            if (state.attempts < 3) state.timer = setTimeout(attempt, 2500);
            else this.stopHandshake(uid);
        };
        void attempt();
    }

    receiveMessage({ from, msg }) {
        if (!Number.isInteger(from) || !msg) return;
        if (msg.type === IDENTITY) {
            if (typeof msg.name !== 'string' || !msg.name.trim()) return;
            if (!this.devices.has(from) && this.devices.size >= 100) return;
            this.devices.set(from, { name: msg.name.trim().slice(0, 40) });
            this.stopHandshake(from);
            if (this.active && msg.requestIdentity === true)
                void this.sendIdentity(from, false).catch(() => {});
            this.render();
            return;
        }
        if (!this.active || !this.mesh.peers.includes(from) || msg.version !== 2) return;
        if (msg.type === 'offer' && this.channel?.peer !== from) {
            const transport = window.parachuteSharing?.transport;
            if (transport?.outgoing || transport?.incoming) {
                void this.mesh.relayMessage(from, { version: 2, type: 'decline', id: msg.id }).catch(() => {});
                return;
            }
            this.selectDevice(from);
        }
        if (this.channel?.peer === from) window.parachuteSharing?.transport?.receive(msg);
    }

    receiveBinary({ from, payload, meta }) {
        if (!this.active || this.channel?.peer !== from || !this.mesh.peers.includes(from)
            || meta?.version !== 2 || meta.type !== 'chunk' || !ArrayBuffer.isView(payload)) return;
        window.parachuteSharing?.transport?.receive({ ...meta, bytes: payload });
    }

    selectDevice(uid) {
        if (!this.active || !this.mesh.peers.includes(uid)) return;
        if (this.channel?.peer === uid) return;
        const transport = window.parachuteSharing?.transport;
        if (transport?.outgoing || transport?.incoming) {
            this.render('Finish or cancel the current transfer before choosing another device.');
            return;
        }
        this.closeConnection();
        // This is a small transport adapter, not a PeerJS connection. JSON
        // messages use relayMessage; file bytes use the mesh binary relay.
        const channel = { open: true, peer: uid };
        let queue = Promise.resolve();
        channel.send = (packet) => {
            if (!channel.open) throw Error('The selected device disconnected.');
            queue = queue.then(async () => {
                if (!channel.open) return;
                if (packet.type === 'chunk') {
                    const { bytes, ...meta } = packet;
                    await this.mesh.relay(uid, bytes, { meta });
                } else await this.mesh.relayMessage(uid, packet);
            }).catch((error) => {
                if (this.channel === channel) this.closeConnection(`Sharing failed: ${error.message}`);
            });
            return queue;
        };
        this.channel = channel;
        window.parachuteSharing?.connected(channel);
        this.render();
    }

    closeConnection(message) {
        const transport = window.parachuteSharing?.transport;
        const transfers = [transport?.outgoing, transport?.incoming];
        if (this.channel?.open && this.mesh?.connected && this.active) {
            for (const transfer of transfers) {
                if (transfer) void this.mesh.relayMessage(this.channel.peer, {
                    version: 2, type: 'cancel', id: transfer.id
                }).catch(() => {});
            }
        }
        if (this.channel) this.channel.open = false;
        this.channel = null;
        window.parachuteSharing?.reset();
        this.render(message);
    }

    render(message) {
        const ids = this.active ? this.mesh.peers : [];
        this.state.textContent = this.channel ? 'Ready to share' : this.active ? `Nearby devices (${ids.length})` : 'Not connected';
        this.panel.dataset.state = this.channel ? 'connected' : this.active ? 'ready' : 'offline';
        this.message.textContent = message || (this.channel
            ? `Sharing with ${this.devices.get(this.channel.peer)?.name || 'a nearby device'}.`
            : this.active ? 'Choose a nearby device to share files or a link.' : 'Click Connect to start nearby discovery.');
        this.list.replaceChildren();
        this.empty.hidden = ids.length > 0;
        this.empty.textContent = this.active ? 'No devices found yet. Open Parachute on another device and click Connect.' : 'Nearby devices will appear after you connect.';
        for (const uid of ids) {
            const item = document.createElement('li');
            const button = document.createElement('button');
            const selected = uid === this.channel?.peer;
            button.type = 'button';
            button.disabled = !this.devices.has(uid);
            button.textContent = `${this.devices.get(uid)?.name || 'Identifying device…'}${selected ? ' · Selected' : ''}`;
            button.setAttribute('aria-pressed', String(selected));
            button.addEventListener('click', () => this.selectDevice(uid));
            item.append(button);
            this.list.append(item);
        }
        document.getElementById('disconnect-device').hidden = !this.channel;
        document.getElementById('stop-discovery').hidden = !this.active;
        this.send.disabled = !this.channel?.open;
        window.parachuteSharing?.sync();
    }

    destroy() {
        this.generation++;
        this.active = this.ready = false;
        for (const uid of this.handshakes.keys()) this.stopHandshake(uid);
        this.closeConnection();
        this.mesh?.disconnect();
        for (const unsubscribe of this.unsubscribers) unsubscribe();
        this.unsubscribers = [];
    }

    stopDiscovery() {
        this.destroy();
        location.reload();
    }
}
window.parachuteConnection = new ParachuteConnection();
