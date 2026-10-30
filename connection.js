class ParachuteConnection {
    constructor() {
        this.generation = 0;
        for (const [key, id] of Object.entries({
            local: 'local-peer-id',
            remote: 'remote-peer-id',
            copy: 'copy-peer-id',
            form: 'connect-form',
            connect: 'connect-peer',
            disconnect: 'disconnect-peer',
            retry: 'retry-peer',
            send: 'send-parachute',
            state: 'connection-state',
            message: 'connection-message'
        }))
            this[key] = document.getElementById(id);
        this.panel = this.state.closest('.connection-panel');
        this.form.addEventListener('submit', (event) => {
            event.preventDefault();
            this.connectToPeer();
        });
        this.disconnect.addEventListener('click', () => this.closeConnection());
        this.retry.addEventListener('click', () => this.start());
        this.copy.addEventListener('click', () => this.copyId());
        this.send.addEventListener('click', () =>
            window.parachuteSharing?.open()
        );
        document.addEventListener('click', (event) => {
            if (!this.panel.contains(event.target)) this.panel.open = false;
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this.panel.open) {
                this.panel.open = false;
                this.panel.querySelector('summary').focus();
            }
        });
        window.addEventListener('pagehide', () => this.destroy());
        window.addEventListener('pageshow', (event) => {
            if (event.persisted) this.start();
        });
        this.start();
    }

    render(state, message) {
        this.state.textContent = state;
        this.message.textContent = message;
        this.panel.dataset.state = this.channel?.open
            ? 'connected'
            : this.connecting
              ? 'connecting'
              : this.ready
                ? 'ready'
                : 'offline';
        this.copy.disabled = !this.ready;
        this.connect.disabled =
            !this.ready || !!this.channel || this.connecting;
        this.remote.disabled = !!this.channel || this.connecting;
        this.disconnect.hidden = !this.channel && !this.connecting;
        this.retry.hidden = this.ready || this.connecting;
        this.send.disabled = !this.channel?.open;
        window.parachuteSharing?.sync();
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
                if (generation === this.generation)
                    this.fail(
                        'Connection timed out. Retry or check your internet connection and TURN configuration.'
                    );
            }, 25000);
            peer.on('open', (id) => {
                if (generation !== this.generation) return;
                this.ready = true;
                this.local.value = id;
                clearTimeout(this.timer);
                this.render(
                    'Ready to connect',
                    'Share your page ID, or paste your friend’s ID and click Connect.'
                );
            });
            peer.on('connection', (channel) => {
                // If both people click Connect, keep the connection initiated by the lower ID.
                if (
                    generation === this.generation &&
                    this.connecting &&
                    this.channel?.peer === channel.peer &&
                    this.peer.id > channel.peer
                ) {
                    this.closeConnection();
                }
                if (generation !== this.generation || this.channel) {
                    channel.on('open', () => channel.close());
                    channel.close();
                    return;
                }
                this.attach(channel, generation);
            });
            peer.on('error', (error) => {
                if (generation !== this.generation) return;
                console.error('PeerJS error', error);
                if (error.type === 'peer-unavailable') {
                    this.closeConnection(
                        'Peer not found. Check their current page ID and keep both pages open.'
                    );
                } else
                    this.fail(
                        `PeerJS connection failed (${error.type || 'network'}). Click Retry.`
                    );
            });
            peer.on('disconnected', () => {
                if (generation === this.generation)
                    this.fail(
                        'Signaling connection lost. Click Retry and share your new page ID.'
                    );
            });
        } catch {
            this.fail(
                'PeerJS could not start. Check your internet connection and browser support, then Retry.'
            );
        }
    }

    attach(channel, generation) {
        this.channel = channel;
        this.connecting = true;
        window.animation.startConnecting();
        const current = () =>
            generation === this.generation && this.channel === channel;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            if (current())
                this.closeConnection(
                    'Connection timed out. Check their page ID. Your network may block direct connections.'
                );
        }, 25000);
        channel.on('open', () => {
            if (!current()) return channel.close();
            clearTimeout(this.timer);
            this.connecting = false;
            window.animation.stopConnecting();
            this.remote.value = channel.peer;
            this.render(
                'Connected',
                'Both pages are connected. Click Drop parachute to send files or a website link.'
            );
            window.parachuteSharing?.connected(channel);
        });
        channel.on('data', (data) => {
            if (current() && channel.open) this.receive(data);
        });
        channel.on('close', () => {
            if (current())
                this.closeConnection(
                    'Your friend disconnected. Paste their current page ID to connect again.'
                );
        });
        channel.on('error', (error) => {
            console.error('Connection error', error);
            if (current())
                this.closeConnection(
                    'The data connection failed. Check the ID and network, then Connect again.'
                );
        });
        this.render('Connecting…', 'Opening the peer data connection…');
    }

    connectToPeer() {
        if (!this.ready || this.channel || this.connecting) return;
        const id = this.remote.value.trim();
        if (!/^[A-Za-z0-9]+(?:[ _-][A-Za-z0-9]+)*$/.test(id)) {
            this.message.textContent =
                'Paste your friend’s complete PeerJS page ID.';
        } else if (id === this.peer.id) {
            this.message.textContent =
                'That is your page ID. Enter the ID from the other page.';
        } else {
            try {
                this.attach(
                    this.peer.connect(id, { reliable: true }),
                    this.generation
                );
            } catch (error) {
                console.error('Connection error', error);
                this.closeConnection(
                    'Could not connect. Check their page ID and try again.'
                );
            }
        }
    }

    closeConnection(
        message = 'Disconnected. Your page ID is unchanged; connect whenever you’re ready.'
    ) {
        window.parachuteSharing?.reset();
        clearTimeout(this.timer);
        const channel = this.channel;
        this.channel = null;
        this.connecting = false;
        channel?.close();
        window.animation.stopConnecting();
        this.render('Ready to connect', message);
    }

    receive(data) {
        window.parachuteSharing?.transport?.receive(data);
    }

    async copyId() {
        if (!this.ready || !this.local.value) return;
        try {
            await navigator.clipboard.writeText(this.local.value);
            this.message.textContent =
                'Page ID copied. Share it with your friend.';
        } catch {
            this.local.focus();
            this.local.select();
            this.message.textContent =
                'Page ID selected. Copy it and share it with your friend.';
        }
    }

    fail(message) {
        this.destroy();
        this.local.value = '';
        this.render('Connection unavailable', message);
    }

    destroy() {
        window.parachuteSharing?.reset();
        this.generation++;
        clearTimeout(this.timer);
        const channel = this.channel,
            peer = this.peer;
        this.channel = null;
        this.peer = null;
        this.ready = false;
        this.connecting = false;
        channel?.close();
        peer?.destroy();
        window.animation.stopConnecting();
    }
}
window.parachuteConnection = new ParachuteConnection();
