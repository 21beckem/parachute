// A single bidirectional data channel. Only an animation command crosses it.
class ParachuteConnection {
    constructor() {
        this.peer = null;
        this.connection = null;
        this.ready = false;
        this.sending = false;
        this.timer = null;
        for (const [key, id] of Object.entries({
            local: 'local-peer-id', remote: 'remote-peer-id', copy: 'copy-peer-id',
            form: 'connect-form', connect: 'connect-peer', disconnect: 'disconnect-peer',
            retry: 'retry-peer', send: 'send-parachute', state: 'connection-state',
            message: 'connection-message'
        })) this[key] = document.getElementById(id);
        this.form.addEventListener('submit', event => { event.preventDefault(); this.connectToPeer(); });
        this.disconnect.addEventListener('click', () => this.closeConnection('Disconnected. Share your ID to connect again.'));
        this.retry.addEventListener('click', () => this.start());
        this.copy.addEventListener('click', () => this.copyId());
        this.send.addEventListener('click', () => this.sendParachute());
        window.addEventListener('pagehide', () => this.destroy());
        window.addEventListener('pageshow', event => { if (event.persisted) this.start(); });
        this.start();
    }

    render(state, message) {
        this.state.textContent = state;
        this.message.textContent = message;
        this.state.closest('.connection-panel').dataset.state = this.connection?.open ? 'connected' : this.connection ? 'connecting' : this.ready ? 'ready' : 'offline';
        this.copy.disabled = !this.ready;
        this.connect.disabled = !this.ready || !!this.connection;
        this.remote.disabled = !!this.connection;
        this.disconnect.hidden = !this.connection;
        this.disconnect.textContent = this.connection?.open ? 'Disconnect' : 'Cancel';
        this.retry.hidden = this.ready;
        this.send.disabled = !this.connection?.open || this.sending;
    }

    start() {
        this.destroy();
        this.local.value = '';
        this.render('Getting your ID…', 'Connecting to the connection service…');
        this.retry.hidden = true;
        if (typeof window.Peer !== 'function') {
            this.render('Connection unavailable', 'The connection library could not load. Reload the page to try again.');
            return;
        }
        let peer;
        try { peer = new window.Peer({ debug: 0 }); }
        catch { this.render('Connection unavailable', 'This browser could not start a peer connection. Try a current browser.'); return; }
        this.peer = peer;
        this.timer = setTimeout(() => {
            if (this.peer !== peer || this.ready) return;
            this.destroy();
            this.render('Connection unavailable', 'The connection service took too long. Check your internet connection and retry.');
        }, 20000);
        peer.on('open', id => {
            if (this.peer !== peer) return;
            clearTimeout(this.timer);
            this.ready = true;
            this.local.value = id;
            this.render('Ready to connect', "Share your ID, or enter a friend's. Keep both pages open.");
        });
        peer.on('connection', connection => {
            if (this.peer !== peer || !this.ready) { connection.close(); return; }
            // Simultaneous dials choose the same channel on both computers.
            if (this.connection && !this.connection.open && this.connection.peer === connection.peer && peer.id > connection.peer) {
                this.closeConnection('Connecting…');
            }
            if (this.connection || connection.label !== 'parachute-v1') { connection.close(); return; }
            this.attach(connection);
        });
        peer.on('error', error => {
            if (this.peer !== peer) return;
            if (error.type === 'peer-unavailable') {
                if (!this.connection?.open) this.closeConnection('That ID is unavailable. Check the ID and make sure their page is open.');
                return;
            }
            if (error.type === 'webrtc' && this.ready) {
                this.closeConnection('Could not connect to that computer. Retry, or try a different network.');
                return;
            }
            this.destroy();
            this.render('Connection unavailable', 'The connection service is unavailable. Check your internet connection and retry.');
        });
        peer.on('disconnected', () => {
            if (this.peer !== peer) return;
            this.ready = false;
            if (!this.connection?.open) this.closeConnection('Connection service lost. Retry to become available again.');
            else this.render('Connected · service offline', 'Your parachute connection is still open. Retry to reconnect to the connection service.');
        });
        peer.on('close', () => {
            if (this.peer !== peer) return;
            this.destroy();
            this.render('Connection closed', 'Retry to get a new connection ID.');
        });
    }

    connectToPeer() {
        if (!this.ready || this.connection) return;
        const id = this.remote.value.trim();
        if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9 _-]{0,126}[a-zA-Z0-9])?$/.test(id)) {
            this.message.textContent = 'Enter a valid connection ID.';
            return;
        }
        if (id === this.peer.id) { this.message.textContent = "That's your ID. Enter the ID from the other computer."; return; }
        try {
            this.attach(this.peer.connect(id, { label: 'parachute-v1', serialization: 'json', reliable: true }));
        } catch { this.closeConnection('Could not start the connection. Check the ID and try again.'); }
    }

    attach(connection) {
        this.connection = connection;
        window.animation.startConnecting();
        this.render('Connecting…', `Connecting to ${connection.peer}…`);
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            if (this.connection === connection) this.closeConnection('Connection timed out. Keep both pages open and try again; some networks block peer connections.');
        }, 20000);
        connection.on('open', () => {
            if (this.connection !== connection) return;
            clearTimeout(this.timer);
            window.animation.stopConnecting();
            this.render('Connected', `Connected to ${connection.peer}. Drop a parachute to send it to their sky.`);
        });
        connection.on('data', data => {
            if (this.connection !== connection || !connection.open) return;
            // Reject all other payloads, including file metadata or file contents.
            if (!data || typeof data !== 'object' || Array.isArray(data) ||
                Object.keys(data).length !== 2 || data.type !== 'parachute' || data.version !== 1) return;
            if (window.ParachuteAnimation.deliveries.size >= 20) return;
            window.animation.dropParachute([], 'other');
            this.message.textContent = 'A parachute arrived! Grab it and drop it into your box.';
        });
        connection.on('close', () => {
            if (this.connection === connection) this.closeConnection('The other computer disconnected. Connect again when they are ready.');
        });
        connection.on('error', () => {
            if (this.connection === connection) this.closeConnection('The peer connection failed. Check the ID and try again.');
        });
    }

    closeConnection(message) {
        clearTimeout(this.timer);
        const connection = this.connection;
        this.connection = null;
        connection?.close();
        window.animation.stopConnecting();
        this.render(this.ready ? 'Ready to connect' : 'Connection unavailable', message);
    }

    async sendParachute() {
        const connection = this.connection;
        if (!connection?.open || this.sending) return;
        this.sending = true;
        this.send.disabled = true;
        try {
            if (!await window.animation.launchRocket()) return;
            if (this.connection !== connection || !connection.open) return;
            connection.send({ type: 'parachute', version: 1 });
            this.message.textContent = 'Parachute sent to your friend’s sky!';
        } catch {
            if (this.connection === connection) this.closeConnection('Could not send the parachute. Reconnect and try again.');
        } finally {
            this.sending = false;
            this.send.disabled = !this.connection?.open;
        }
    }

    async copyId() {
        const id = this.local.value;
        if (!this.ready || !id) return;
        try {
            await navigator.clipboard.writeText(id);
            this.message.textContent = 'ID copied. Share it with your friend.';
        } catch {
            this.local.focus();
            this.local.select();
            this.message.textContent = 'Your ID is selected. Copy it and share it with your friend.';
        }
    }

    destroy() {
        clearTimeout(this.timer);
        this.ready = false;
        const peer = this.peer;
        this.peer = null;
        this.closeConnection('Connection closed.');
        peer?.destroy();
    }
}

window.parachuteConnection = new ParachuteConnection();
