// Two computers share a server; only parachute animation messages cross it.
class ParachuteConnection {
    constructor() {
        this.session = null;
        this.events = null;
        this.ready = false;
        this.partner = null;
        this.pairId = null;
        this.connecting = false;
        this.sending = false;
        this.generation = 0;
        for (const [key, id] of Object.entries({
            local: 'local-peer-id', remote: 'remote-peer-id', copy: 'copy-peer-id',
            form: 'connect-form', connect: 'connect-peer', disconnect: 'disconnect-peer',
            retry: 'retry-peer', send: 'send-parachute', state: 'connection-state',
            message: 'connection-message'
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
        this.panel.dataset.state = this.partner ? 'connected' : this.connecting ? 'connecting' : this.ready ? 'ready' : 'offline';
        this.copy.disabled = !this.ready;
        this.connect.disabled = !this.ready || !!this.partner || this.connecting;
        this.remote.disabled = !!this.partner || this.connecting;
        this.disconnect.hidden = !this.partner;
        this.retry.hidden = this.ready;
        this.send.disabled = !this.partner || !this.ready || this.sending;
    }

    async request(action, data = {}, session = this.session) {
        const response = await fetch(`/api/${action}`, {
            method: 'POST', headers: {
                'Content-Type': 'application/json',
                ...(session ? { Authorization: `Bearer ${session.token}` } : {})
            },
            body: JSON.stringify(data), signal: AbortSignal.timeout(15000)
        });
        let result;
        try { result = await response.json(); }
        catch { throw new Error('Run this website with npm start, or open its shared server URL.'); }
        if (!response.ok) throw new Error(result.error || 'The connection service is unavailable. Retry.');
        return result;
    }

    async start() {
        this.destroy();
        const generation = this.generation;
        this.local.value = '';
        this.render('Connecting…', 'Getting your connection code…');
        this.retry.hidden = true;
        try {
            const session = await this.request('session', {}, null);
            if (generation !== this.generation) {
                this.request('leave', {}, session).catch(() => {});
                return;
            }
            this.session = session;
            const events = new EventSource(`/api/events?token=${encodeURIComponent(session.token)}`);
            this.events = events;
            const timeout = setTimeout(() => {
                if (this.events === events && !this.ready) this.fail('The connection service took too long. Click Retry.');
            }, 15000);
            this.timer = timeout;
            events.onmessage = event => {
                if (this.events !== events) return;
                let data;
                try { data = JSON.parse(event.data); } catch { return; }
                if (data.type === 'ready') {
                    clearTimeout(timeout);
                    this.ready = true;
                    this.local.value = session.code.match(/.{4}/g).join('-');
                    this.partner = data.partner;
                    this.pairId = data.pairId;
                    this.render(this.partner ? 'Connected' : 'Connect a friend', 'Share your code, or enter a friend’s code. Open the same website on both computers.');
                } else if (data.type === 'connected') {
                    this.connecting = false;
                    this.partner = data.code;
                    this.pairId = data.pairId;
                    window.animation.stopConnecting();
                    this.render('Connected', 'Drop a parachute to send it to your friend’s sky.');
                } else if (data.type === 'disconnected') {
                    this.partner = null;
                    this.pairId = null;
                    this.connecting = false;
                    window.animation.stopConnecting();
                    this.render('Connect a friend', 'Disconnected. Share your code to connect again.');
                } else if (data.type === 'parachute' && data.version === 1 && Object.keys(data).length === 2 && this.partner) {
                    if (window.ParachuteAnimation.deliveries.size >= 20) return;
                    window.animation.dropParachute([], 'other');
                    this.message.textContent = 'A parachute arrived! Grab it and drop it into your box.';
                }
            };
            events.onerror = () => {
                if (this.events === events) this.fail('Connection service lost. Click Retry, then share your new code.');
            };
        } catch (error) {
            if (generation === this.generation) this.fail(error.name === 'TypeError'
                ? 'Open the shared server URL on both computers. Start it with node server.cjs, then click Retry.'
                : error.message || 'The connection service is unavailable. Click Retry.');
        }
    }

    fail(message) {
        this.destroy();
        this.local.value = '';
        this.render('Connection unavailable', message);
    }

    async connectToPeer() {
        if (!this.ready || this.partner || this.connecting) return;
        const code = this.remote.value.toUpperCase().replace(/[\s-]/g, '');
        if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) {
            this.message.textContent = 'Enter the 8-character code from the other computer.';
            return;
        }
        if (code === this.session.code) {
            this.message.textContent = "That's your code. Enter the other computer's code.";
            return;
        }
        const generation = this.generation;
        this.connecting = true;
        window.animation.startConnecting();
        this.render('Connecting…', 'Connecting to your friend…');
        try { await this.request('connect', { code }); }
        catch (error) {
            if (generation !== this.generation || this.partner) return;
            this.connecting = false;
            window.animation.stopConnecting();
            this.render('Connect a friend', error.message);
        }
    }

    async closeConnection() {
        if (!this.ready || !this.partner) return;
        const generation = this.generation;
        try { await this.request('disconnect'); }
        catch (error) { if (generation === this.generation) this.fail(error.message); }
    }

    async sendParachute() {
        if (!this.ready || !this.partner || this.sending) return;
        const partner = this.partner, pairId = this.pairId, generation = this.generation;
        this.sending = true;
        this.send.disabled = true;
        try {
            if (!await window.animation.launchRocket()) return;
            if (generation !== this.generation || this.pairId !== pairId || !this.ready) return;
            await this.request('send', { type: 'parachute', version: 1, code: partner, pairId });
            if (generation === this.generation && this.pairId === pairId) this.message.textContent = 'Parachute sent to your friend’s sky!';
        } catch (error) {
            if (generation === this.generation) this.message.textContent = error.message;
        } finally {
            this.sending = false;
            this.send.disabled = !this.partner || !this.ready;
        }
    }

    async copyId() {
        const code = this.local.value;
        if (!this.ready || !code) return;
        try {
            await navigator.clipboard.writeText(code);
            this.message.textContent = 'Code copied. Share it with your friend.';
        } catch {
            this.local.focus();
            this.local.select();
            this.message.textContent = 'Your code is selected. Copy it and share it with your friend.';
        }
    }

    destroy() {
        this.generation++;
        clearTimeout(this.timer);
        this.events?.close();
        this.events = null;
        if (this.session) {
            fetch('/api/leave', { method: 'POST', headers: { Authorization: `Bearer ${this.session.token}` }, keepalive: true }).catch(() => {});
        }
        this.session = null;
        this.partner = null;
        this.pairId = null;
        this.ready = false;
        this.connecting = false;
        window.animation.stopConnecting();
    }
}

window.parachuteConnection = new ParachuteConnection();
