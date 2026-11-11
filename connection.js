// Only MeshClient is imported. Its modules, worker, and model load automatically.
const IDENTITY = 'parachute:identity:v1';
const WARMUP_MS = 5000;
const TRANSFER_CHECK = 'parachute:transfer-check:v1';
const DEPARTURE = 'parachute:leaving:v1';
const CHECK_INTERVAL_MS = 2000;
const CHECK_TIMEOUT_MS = 3000;

class ParachuteConnection {
    constructor() {
        this.devices = new Map();
        this.handshakes = new Map();
        this.unsubscribers = [];
        this.active = false;
        this.starting = false;
        this.ready = false;
        this.channels = new Map();
        this.generation = 0;
        this.state = document.getElementById('connection-state');
        this.message = document.getElementById('connection-message');
        this.list = document.getElementById('nearby-devices');
        this.empty = document.getElementById('nearby-empty');
        this.send = document.getElementById('send-parachute');
        this.panel = this.state.closest('.connection-panel');
        this.send.addEventListener('click', () => window.parachuteSharing?.open());
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

    async withTimeout(promise, timeoutMs = 30000) {
        let timer;
        try {
            return await Promise.race([promise, new Promise((_, reject) => {
                timer = setTimeout(() => reject(Error('The discovery service timed out. Reload to retry.')), timeoutMs);
            })]);
        } finally { clearTimeout(timer); }
    }

    async initialize() {
        try {
            const { MeshClient } = await this.withTimeout(window.loadParachuteMesh());
            this.mesh = MeshClient;
            this.listen('initialized', () => { this.initialized = true; });
            this.listen('initError', ({ error }) => { this.initError = error; });
            this.listen('startError', ({ stage, error, result }) => {
                this.startFailure = { stage, error: result?.error || error };
            });
            this.listen('peerAdded', ({ uid }) => {
                if (this.active) this.identify(uid);
                this.render();
            });
            this.listen('peerRemoved', ({ uid }) => {
                this.stopHandshake(uid);
                const channel = this.channels.get(uid);
                if (channel && window.parachuteSharing?.hasActiveTransfer(uid)) {
                    void this.checkPeer(uid, channel);
                } else {
                    this.devices.delete(uid);
                    this.closePeer(uid);
                }
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
                this.closeAll('Discovery disconnected. Reload to reconnect.');
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
        const media = navigator.mediaDevices;
        const geo = navigator.geolocation;
        const getAudio = media?.getUserMedia;
        const getLocation = geo?.getCurrentPosition;
        const streams = new Set();
        let wrappedAudio, wrappedLocation;
        let finished = false, succeeded = false;
        let audioAccepted = false, locationAccepted = !!this.locationAccepted;
        let permissionsAcceptedAt = null;
        this.startFailure = null;
        const permissionsReady = () => {
            if (finished || !current() || !audioAccepted || !locationAccepted || permissionsAcceptedAt !== null) return;
            permissionsAcceptedAt = Date.now();
            this.permissionsAcceptedAt = permissionsAcceptedAt;
            onStatus('Permissions accepted. Getting five seconds of room sound…');
            window.dispatchEvent(new CustomEvent('discovery-warmup-start', {
                detail: { durationMs: WARMUP_MS, startedAt: permissionsAcceptedAt }
            }));
        };
        try {
            if (!window.isSecureContext || !getAudio || !getLocation)
                throw Error('Microphone and location access need HTTPS or localhost in a supported browser.');
            if (!(await this.loading)) throw this.loadError || Error('The discovery service could not load. Reload to retry.');
            if (!current()) throw Error('Discovery stopped. Reload to reconnect.');
            window.parachuteProfile = { displayName };
            onStatus('Allow microphone and location access to find nearby devices.');
            // Observe MeshClient's own requests instead of making a second set.
            // Keep the native callbacks and constraints; only allow more time
            // for location and accept a recent position on slow desktop providers.
            wrappedAudio = (constraints) => getAudio.call(media, constraints).then((stream) => {
                if (finished) stream.getTracks().forEach((track) => track.stop());
                else {
                    streams.add(stream);
                    audioAccepted = true;
                    permissionsReady();
                }
                return stream;
            });
            wrappedLocation = (success, failure, options) => getLocation.call(geo, (position) => {
                if (!finished && current()) {
                    this.locationAccepted = locationAccepted = true;
                    permissionsReady();
                }
                success(position);
            }, (error) => {
                if (!finished) this.startFailure = { stage: 'location', error };
                failure?.(error);
            }, { ...options, timeout: 30000, maximumAge: 60000 });
            media.getUserMedia = wrappedAudio;
            geo.getCurrentPosition = wrappedLocation;
            const result = await this.withTimeout(this.mesh.begin(), 45000);
            if (!result?.success || !this.mesh.connected) throw Error('The scanner could not start. Reload and try again.');
            // Cached upstream location or a browser with non-writable methods
            // may not call the observers. Successful begin still confirms both.
            audioAccepted = locationAccepted = true;
            permissionsReady();
            window.dispatchEvent(new CustomEvent('discovery-scanner-ready'));
            await new Promise((resolve) => setTimeout(resolve, Math.max(0, WARMUP_MS - (Date.now() - permissionsAcceptedAt))));
            if (!current() || !this.mesh.connected) throw Error('Discovery stopped. Reload to reconnect.');
            this.ready = this.active = true;
            window.dispatchEvent(new CustomEvent('discovery-warmup-end'));
            for (const uid of this.mesh.peers) this.identify(uid);
            this.panel.open = true;
            this.render();
            succeeded = true;
            return true;
        } catch (error) {
            const message = this.startErrorMessage(error);
            onStatus(message);
            window.dispatchEvent(new CustomEvent('discovery-warmup-error', { detail: message }));
            return false;
        } finally {
            finished = true;
            if (media && wrappedAudio && media.getUserMedia === wrappedAudio) media.getUserMedia = getAudio;
            if (geo && wrappedLocation && geo.getCurrentPosition === wrappedLocation) geo.getCurrentPosition = getLocation;
            if (!succeeded) for (const stream of streams) stream.getTracks().forEach((track) => track.stop());
            this.starting = false;
        }
    }

    startErrorMessage(error) {
        const failure = this.startFailure;
        if (failure?.stage === 'location') {
            if (failure.error?.code === 1) return 'Location access is blocked. Allow Location for this website and in your device settings, then try again.';
            if (failure.error?.code === 2) return 'Your device could not find its location. Check that Location services are on, then try again.';
            if (failure.error?.code === 3) return 'Finding your location timed out. Check Location services and keep this page open while you try again.';
            return 'Location could not start. Check Location services and this website’s location permission, then try again.';
        }
        if (failure?.stage === 'audio') {
            if (failure.error?.name === 'NotAllowedError') return 'Microphone access is blocked. Allow the microphone for this website and in your device settings, then try again.';
            return `The microphone could not start: ${failure.error?.message || 'check your microphone and try again'}.`;
        }
        return error.message || 'Discovery could not start. Check your permissions and retry.';
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
        if (msg.type === DEPARTURE) {
            this.devices.delete(from);
            this.closePeer(from, 'That device disconnected. Its unfinished transfers were removed.');
            return;
        }
        if (msg.type === TRANSFER_CHECK) return;
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
        if (!this.active || msg.version !== 2) return;
        const sharing = window.parachuteSharing;
        if (msg.type === 'offer' && !this.mesh.peers.includes(from)) {
            void this.mesh.relayMessage(from, { version: 2, type: 'decline', id: msg.id, reason: 'not-nearby' }).catch(() => {});
            return;
        }
        const existing = sharing?.transports.get(from);
        if (!existing && !this.mesh.peers.includes(from)) return;
        const transport = existing || sharing?.transportFor(from);
        transport?.receive(msg);
    }

    receiveBinary({ from, payload, meta }) {
        if (!this.active || !this.channels.get(from)?.open
            || meta?.version !== 2 || meta.type !== 'chunk' || !ArrayBuffer.isView(payload)) return;
        window.parachuteSharing?.transports.get(from)?.receive({ ...meta, bytes: payload });
    }

    channelFor(uid) {
        const existing = this.channels.get(uid);
        if (existing?.open) return existing;
        if (!this.active || !this.mesh.connected || !this.mesh.peers.includes(uid)) return null;
        // Every recipient has an independent queue and transfer state.
        const channel = { open: true, peer: uid };
        let queue = Promise.resolve();
        channel.send = packet => {
            if (!channel.open) throw Error('The device disconnected.');
            this.monitorPeer(uid, channel);
            queue = queue.then(async () => {
                if (!channel.open) return;
                if (packet.type === 'chunk') {
                    const { bytes, ...meta } = packet;
                    await this.mesh.relay(uid, bytes, { meta });
                } else await this.mesh.relayMessage(uid, packet);
            }).catch(error => {
                if (this.channels.get(uid) === channel)
                    this.closePeer(uid, `Sharing with that device failed: ${error.message}`);
            });
            return queue;
        };
        this.channels.set(uid, channel);
        this.monitorPeer(uid, channel);
        return channel;
    }

    monitorPeer(uid, channel) {
        if (channel.monitor || !channel.open) return;
        channel.monitor = setTimeout(async () => {
            channel.monitor = null;
            if (this.channels.get(uid) !== channel || !window.parachuteSharing?.hasActiveTransfer(uid)) return;
            await this.checkPeer(uid, channel);
            if (this.channels.get(uid) === channel) this.monitorPeer(uid, channel);
        }, CHECK_INTERVAL_MS);
    }

    async checkPeer(uid, channel) {
        if (channel.checking || !channel.open) return;
        channel.checking = true;
        let timer;
        try {
            await Promise.race([
                this.mesh.relayMessage(uid, { type: TRANSFER_CHECK }, { timeout: CHECK_TIMEOUT_MS }),
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(Error('Device is no longer reachable.')), CHECK_TIMEOUT_MS);
                })
            ]);
        } catch {
            if (this.channels.get(uid) === channel)
                this.closePeer(uid, 'That device disconnected. Its unfinished transfers were removed.');
        } finally {
            clearTimeout(timer);
            channel.checking = false;
        }
    }

    closePeer(uid, message) {
        const channel = this.channels.get(uid);
        if (channel) { channel.open = false; clearTimeout(channel.monitor); }
        this.channels.delete(uid);
        window.parachuteSharing?.closePeer(uid);
        this.render(message);
    }

    closeAll(message) {
        for (const channel of this.channels.values()) {
            channel.open = false;
            clearTimeout(channel.monitor);
        }
        this.channels.clear();
        window.parachuteSharing?.reset();
        this.render(message);
    }

    render(message) {
        const nearby = this.active ? [...this.mesh.peers] : [];
        const ids = [...nearby];
        for (const uid of this.channels.keys())
            if (!ids.includes(uid) && window.parachuteSharing?.hasActiveTransfer(uid)) ids.push(uid);
        this.state.textContent = this.active ? `Nearby devices (${nearby.length})` : 'Not connected';
        this.panel.dataset.state = this.active ? 'ready' : 'offline';
        this.message.textContent = message || (this.active
            ? 'Drop parachute sends an offer to everyone currently nearby. Each person catches their own.'
            : 'Click Connect to start nearby discovery.');
        this.list.replaceChildren();
        this.empty.hidden = ids.length > 0;
        this.empty.textContent = this.active
            ? 'No devices found yet. Open Parachute on another device and click Connect.'
            : 'Nearby devices will appear after you connect.';
        for (const uid of ids) {
            const item = document.createElement('li');
            const label = document.createElement('span');
            label.textContent = `${this.devices.get(uid)?.name || 'Identifying device…'}${nearby.includes(uid) ? '' : ' · Sharing (room signal changed)'}`;
            item.append(label);
            this.list.append(item);
        }
        document.getElementById('stop-discovery').hidden = !this.active;
        this.send.disabled = !this.active || !nearby.length;
        window.parachuteSharing?.sync();
    }

    destroy() {
        if (this.destroyed) return this.shutdown;
        this.destroyed = true;
        const mesh = this.mesh;
        // Best effort on a normal exit. Abrupt tab/network loss is covered by
        // bounded reachability checks while any offer or transfer is active.
        const notices = mesh?.connected && this.active ? [...this.channels.keys()].map(uid =>
            mesh.relayMessage(uid, { type: DEPARTURE }, { timeout: 150 }).catch(() => {})
        ) : [];
        this.generation++;
        this.active = this.ready = false;
        for (const uid of this.handshakes.keys()) this.stopHandshake(uid);
        this.closeAll();
        if (notices.length) {
            this.shutdown = new Promise(resolve => {
                let ended = false;
                const disconnect = () => { if (!ended) { ended = true; mesh.disconnect(); resolve(); } };
                const timer = setTimeout(disconnect, 150);
                void Promise.allSettled(notices).then(() => { clearTimeout(timer); disconnect(); });
            });
        } else mesh?.disconnect();
        for (const unsubscribe of this.unsubscribers) unsubscribe();
        this.unsubscribers = [];
        return this.shutdown;
    }

    stopDiscovery() {
        const closing = this.destroy();
        if (closing) void closing.then(() => location.reload());
        else location.reload();
    }

}
window.parachuteConnection = new ParachuteConnection();
