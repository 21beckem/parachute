// Same core as peerjs-test.html: Peer assigns an ID, then peer.connect(otherId).
class ParachuteConnection {
    constructor() {
        this.generation = 0;
        this.pending = new Map();
        this.received = new Set();
        for (const [key, id] of Object.entries({
            local: 'local-peer-id', remote: 'remote-peer-id', copy: 'copy-peer-id',
            form: 'connect-form', connect: 'connect-peer', disconnect: 'disconnect-peer',
            retry: 'retry-peer', send: 'send-parachute', state: 'connection-state',
            message: 'connection-message', kind: 'package-kind'
        })) this[key] = document.getElementById(id);
        this.panel = this.state.closest('.connection-panel');
        this.form.addEventListener('submit', event => { event.preventDefault(); this.connectToPeer(); });
        this.disconnect.addEventListener('click', () => this.closeConnection());
        this.retry.addEventListener('click', () => this.start());
        this.copy.addEventListener('click', () => this.copyId());
        this.send.addEventListener('click', () => this.sendParachute());
        document.addEventListener('click', event => {
            if (!this.panel.contains(event.target)) this.panel.open = false;
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && this.panel.open) {
                this.panel.open = false;
                this.panel.querySelector('summary').focus();
            }
        });
        window.addEventListener('pagehide', () => this.destroy());
        window.addEventListener('pageshow', event => { if (event.persisted) this.start(); });
        this.start();
    }

    render(state, message) {
        this.state.textContent = state;
        this.message.textContent = message;
        this.panel.dataset.state = this.channel?.open ? 'connected' : this.connecting ? 'connecting' : this.ready ? 'ready' : 'offline';
        this.copy.disabled = !this.ready;
        this.connect.disabled = !this.ready || !!this.channel || this.connecting;
        this.remote.disabled = !!this.channel || this.connecting;
        this.disconnect.hidden = !this.channel && !this.connecting;
        this.retry.hidden = this.ready || this.connecting;
        this.send.disabled = !this.channel?.open || this.sending || this.pending.size > 0;
    }

    start() {
        this.destroy();
        const generation = this.generation;
        this.local.value = '';
        this.connecting = false;
        this.render('Connecting…', 'Getting this page’s PeerJS ID…');
        try {
            const peer = new Peer({ debug: 2 });
            this.peer = peer;
            this.timer = setTimeout(() => {
                if (generation === this.generation) this.fail('Connection timed out. Retry or check your internet connection and TURN configuration.');
            }, 25000);
            peer.on('open', id => {
                if (generation !== this.generation) return;
                this.ready = true;
                this.local.value = id;
                clearTimeout(this.timer);
                this.render('Ready to connect', 'Share your page ID, or paste your friend’s ID and click Connect.');
            });
            peer.on('connection', channel => {
                // If both people click Connect, keep the connection initiated by the lower ID.
                if (generation === this.generation && this.connecting &&
                    this.channel?.peer === channel.peer && this.peer.id > channel.peer) {
                    this.closeConnection();
                }
                if (generation !== this.generation || this.channel) {
                    channel.on('open', () => channel.close());
                    channel.close();
                    return;
                }
                this.attach(channel, generation);
            });
            peer.on('error', error => {
                if (generation !== this.generation) return;
                console.error('PeerJS error', error);
                if (error.type === 'peer-unavailable') {
                    this.closeConnection('Peer not found. Check their current page ID and keep both pages open.');
                } else this.fail(`PeerJS connection failed (${error.type || 'network'}). Click Retry.`);
            });
            peer.on('disconnected', () => {
                if (generation === this.generation) this.fail('Signaling connection lost. Click Retry and share your new page ID.');
            });
        } catch {
            this.fail('PeerJS could not start. Check your internet connection and browser support, then Retry.');
        }
    }

    attach(channel, generation) {
        this.channel = channel;
        this.connecting = true;
        window.animation.startConnecting();
        const current = () => generation === this.generation && this.channel === channel;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            if (current()) this.closeConnection('Connection timed out. Check their page ID. Your network may block direct connections.');
        }, 25000);
        channel.on('open', () => {
            if (!current()) return channel.close();
            clearTimeout(this.timer);
            this.connecting = false;
            window.animation.stopConnecting();
            this.remote.value = channel.peer;
            this.render('Connected', 'Both pages are connected. Launch a rocket to send a package.');
        });
        channel.on('data', data => {
            if (current() && channel.open) this.receive(data);
        });
        channel.on('close', () => {
            if (current()) this.closeConnection('Your friend disconnected. Paste their current page ID to connect again.');
        });
        channel.on('error', error => {
            console.error('Connection error', error);
            if (current()) this.closeConnection('The data connection failed. Check the ID and network, then Connect again.');
        });
        this.render('Connecting…', 'Opening the peer data connection…');
    }

    connectToPeer() {
        if (!this.ready || this.channel || this.connecting) return;
        const id = this.remote.value.trim();
        if (!/^[A-Za-z0-9]+(?:[ _-][A-Za-z0-9]+)*$/.test(id)) {
            this.message.textContent = 'Paste your friend’s complete PeerJS page ID.';
        } else if (id === this.peer.id) {
            this.message.textContent = 'That is your page ID. Enter the ID from the other page.';
        } else {
            try { this.attach(this.peer.connect(id), this.generation); }
            catch (error) {
                console.error('Connection error', error);
                this.closeConnection('Could not connect. Check their page ID and try again.');
            }
        }
    }

    closeConnection(message = 'Disconnected. Your page ID is unchanged; connect whenever you’re ready.') {
        clearTimeout(this.timer);
        for (const { timer } of this.pending.values()) clearTimeout(timer);
        this.pending.clear();
        this.received.clear();
        const channel = this.channel;
        this.channel = null;
        this.connecting = false;
        this.sending = false;
        channel?.close();
        window.animation.stopConnecting();
        this.render('Ready to connect', message);
    }

    receive(data) {
        if (!data || data.version !== 1 || typeof data.id !== 'string' ||
            !/^[a-zA-Z0-9-]{1,80}$/.test(data.id)) return;
        if (data.type === 'receipt' && Object.keys(data).length === 3) {
            const pending = this.pending.get(data.id);
            if (!pending) return;
            clearTimeout(pending.timer);
            this.pending.delete(data.id);
            this.render('Connected', `Package ${data.id.slice(0, 8)} delivered. Your friend confirmed receipt.`);
            return;
        }
        if (data.type !== 'package' || Object.keys(data).length !== 5 ||
            !data.rocket || Object.keys(data.rocket).length !== 1 || data.rocket.action !== 'launch' ||
            !data.parachute || Object.keys(data.parachute).length !== 2 ||
            !['file', 'folder', 'music', 'link', 'picture', 'video', 'other'].includes(data.parachute.kind) ||
            !Array.isArray(data.parachute.payload) || data.parachute.payload.length !== 0) return;
        if (!this.received.has(data.id)) {
            if (window.ParachuteAnimation.deliveries.size >= 20) {
                this.message.textContent = 'The sky is full. Clear a delivery before receiving another package.';
                return;
            }
            window.animation.dropParachute(data.parachute.payload, data.parachute.kind);
            this.received.add(data.id);
            if (this.received.size > 200) this.received.delete(this.received.values().next().value);
            this.render('Connected', `Package ${data.id.slice(0, 8)} received automatically. A ${data.parachute.kind} parachute arrived!`);
        }
        try { this.channel.send({ type: 'receipt', version: 1, id: data.id }); }
        catch { this.fail('Receipt could not be sent. Reconnect before sending more packages.'); }
    }

    async sendParachute(kind = this.kind.value) {
        if (!this.channel?.open || this.sending || this.pending.size) return;
        if (!['file', 'folder', 'music', 'link', 'picture', 'video', 'other'].includes(kind)) return;
        const channel = this.channel, generation = this.generation;
        this.sending = true;
        this.render('Connected', 'Launching the rocket with your package…');
        try {
            if (!await window.animation.launchRocket()) return;
            if (generation !== this.generation || this.channel !== channel || !channel.open) return;
            const id = crypto.randomUUID();
            const packet = { type: 'package', version: 1, id,
                rocket: { action: 'launch' }, parachute: { kind, payload: [] } };
            const timer = setTimeout(() => {
                if (!this.pending.delete(id)) return;
                this.render('Connected', 'Receipt timed out. Delivery is unconfirmed; check the other computer before sending again.');
            }, 10000);
            this.pending.set(id, { timer });
            channel.send(packet);
            this.render('Connected', `Package ${id.slice(0, 8)} sent. Waiting for receipt…`);
        } catch {
            if (generation === this.generation) this.fail('The package could not be sent. Click Retry.');
        } finally {
            if (generation === this.generation && this.channel === channel) {
                this.sending = false;
                this.send.disabled = !this.channel?.open || this.pending.size > 0;
            }
        }
    }

    async copyId() {
        if (!this.ready || !this.local.value) return;
        try {
            await navigator.clipboard.writeText(this.local.value);
            this.message.textContent = 'Page ID copied. Share it with your friend.';
        } catch {
            this.local.focus(); this.local.select();
            this.message.textContent = 'Page ID selected. Copy it and share it with your friend.';
        }
    }

    fail(message) {
        this.destroy();
        this.local.value = '';
        this.render('Connection unavailable', message);
    }

    destroy() {
        this.generation++;
        clearTimeout(this.timer);
        for (const { timer } of this.pending.values()) clearTimeout(timer);
        this.pending.clear();
        this.received.clear();
        const channel = this.channel, peer = this.peer;
        this.channel = null; this.peer = null;
        this.ready = false; this.connecting = false; this.sending = false;
        channel?.close(); peer?.destroy();
        window.animation.stopConnecting();
    }
}
window.parachuteConnection = new ParachuteConnection();
