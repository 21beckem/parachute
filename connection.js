// Room codes map to PeerJS host IDs; packages travel over reliable WebRTC data channels.
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
        this.disconnect.addEventListener('click', () => this.start());
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

    randomCode() {
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        return Array.from(crypto.getRandomValues(new Uint8Array(8)), n => alphabet[n % 32]).join('');
    }

    start(room = null) {
        this.destroy();
        const generation = this.generation;
        this.room = room || this.randomCode();
        this.local.value = '';
        this.connecting = !!room;
        if (room) window.animation.startConnecting();
        this.render('Connecting…', room ? 'Joining the shared room…' : 'Creating your room…');
        try {
            // Keep PeerJS's default STUN/TURN config, unless deployment supplies its own.
            const peer = new Peer(room ? undefined : `parachute-room-${this.room}`, {
                ...window.PARACHUTE_PEER_OPTIONS, secure: true
            });
            this.peer = peer;
            this.timer = setTimeout(() => {
                if (generation === this.generation) this.fail('Connection timed out. Retry or check your internet connection and TURN configuration.');
            }, 25000);
            peer.on('open', () => {
                if (generation !== this.generation) return;
                this.ready = true;
                this.local.value = this.room.match(/.{4}/g).join('-');
                if (room) {
                    this.attach(peer.connect(`parachute-room-${room}`, {
                        reliable: true, serialization: 'json', label: 'parachute-v1',
                        metadata: { version: 1, room }
                    }), generation);
                } else {
                    clearTimeout(this.timer);
                    this.render('Room ready', 'Share this room code. Your friend enters it under Join a friend’s room.');
                }
            });
            peer.on('connection', channel => {
                if (generation !== this.generation || room || this.channel ||
                    channel.label !== 'parachute-v1' || channel.metadata?.version !== 1 || channel.metadata?.room !== this.room) {
                    channel.on('open', () => channel.close());
                    channel.close();
                    return;
                }
                this.attach(channel, generation);
            });
            peer.on('error', error => {
                if (generation !== this.generation) return;
                if (error.type === 'unavailable-id' && !room) return this.start();
                this.fail(error.type === 'peer-unavailable'
                    ? 'Room not found. Check the code and keep the room creator’s page open.'
                    : `PeerJS connection failed (${error.type || 'network'}). Click Retry.`);
            });
            peer.on('disconnected', () => {
                if (generation === this.generation) this.fail('Signaling connection lost. Click Retry and share the new room code.');
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
            if (current()) this.fail('The peer could not connect. Check the room code, firewall, or TURN service, then Retry.');
        }, 25000);
        channel.on('open', () => {
            if (!current()) return channel.close();
            clearTimeout(this.timer);
            this.connecting = false;
            window.animation.stopConnecting();
            this.render('Connected', 'Both computers are connected. Launch a rocket to send a package.');
        });
        channel.on('data', data => {
            if (current() && channel.open) this.receive(data);
        });
        channel.on('close', () => {
            if (current()) this.fail('Your friend disconnected. Click Retry to create a new room.');
        });
        channel.on('error', () => {
            if (current()) this.fail('The data connection failed. Click Retry to create a new room.');
        });
        this.render('Connecting…', 'Opening the peer data connection…');
    }

    connectToPeer() {
        if (!this.ready || this.channel || this.connecting) return;
        const code = this.remote.value.toUpperCase().replace(/[\s-]/g, '');
        if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) {
            this.message.textContent = 'Enter an 8-character room code.';
        } else if (code === this.room) {
            this.message.textContent = 'You are already hosting this room. Share its code with your friend.';
        } else this.start(code);
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
            if (generation === this.generation) {
                this.sending = false;
                this.send.disabled = !this.channel?.open || this.pending.size > 0;
            }
        }
    }

    async copyId() {
        if (!this.ready || !this.local.value) return;
        try {
            await navigator.clipboard.writeText(this.local.value);
            this.message.textContent = 'Room code copied. Share it with your friend.';
        } catch {
            this.local.focus(); this.local.select();
            this.message.textContent = 'Room code selected. Copy it and share it with your friend.';
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
