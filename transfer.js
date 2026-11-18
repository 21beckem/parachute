// File protocol over the selected MeshClient relay adapter.
// A bounded window keeps the relay busy; acknowledged chunks survive retries.
class ParachuteTransfer {
    static COLORS = Object.freeze(['coral', 'sky', 'sage', 'gold', 'lavender', 'rose']);
    static MAX_BYTES = 100 * 1024 * 1024;
    static CHUNK_BYTES = 64 * 1024;
    static MAX_FILES = 20;
    static OFFER_TIMEOUT_MS = 60000;
    static WINDOW_CHUNKS = 8;
    static RETRY_MS = 3000;
    static DELIVERY_GRACE_MS = 30000;

    constructor(channel, hooks = {}) {
        this.channel = channel;
        this.hooks = hooks;
        this.outgoing = null;
        this.incoming = null;
        this.closed = false;
        this.completed = new Map();
    }

    static website(value) {
        if (typeof value !== 'string' || value.length > 2048)
            throw Error('Enter a website address of up to 2,048 characters.');
        const url = new URL(value);
        if (
            !['https:', 'http:'].includes(url.protocol) ||
            url.username ||
            url.password
        ) {
            throw Error(
                'Use an http:// or https:// website address without login details.'
            );
        }
        return url.href;
    }

    static validateOffer(data) {
        if (data.color !== undefined && !this.COLORS.includes(data.color)) return false;
        if (data.title !== undefined && (typeof data.title !== 'string' || data.title.length > 80 || /[\x00-\x1f]/.test(data.title))) return false;
        if (
            typeof data.sender !== 'string' ||
            !data.sender.trim() ||
            data.sender.length > 40
        )
            return false;
        if (data.kind === 'link') {
            try {
                return this.website(data.url) === data.url;
            } catch {
                return false;
            }
        }
        if (
            data.kind !== 'files' ||
            !Array.isArray(data.files) ||
            !data.files.length ||
            data.files.length > this.MAX_FILES
        )
            return false;
        let total = 0;
        for (const file of data.files) {
            if (
                !file ||
                typeof file.name !== 'string' ||
                !file.name.trim() ||
                file.name.length > 255 ||
                /[\x00-\x1f/\\]/.test(file.name) ||
                typeof file.mime !== 'string' ||
                file.mime.length > 255 ||
                !Number.isSafeInteger(file.size) ||
                file.size < 0
            )
                return false;
            total += file.size;
        }
        return total <= this.MAX_BYTES;
    }

    static offerFor({ files = [], url, title = '', color = 'coral', sender = 'Someone nearby' }) {
        const manifest = { kind: url ? 'link' : 'files', color, sender: sender.trim().slice(0, 40) || 'Someone nearby' };
        if (title.trim()) manifest.title = title.trim();
        if (url) manifest.url = this.website(url);
        else manifest.files = files.map(file => ({ name: file.name, size: file.size, mime: file.type || '' }));
        if (!this.validateOffer(manifest)) throw Error('Choose up to 20 files, totaling no more than 100 MB.');
        return manifest;
    }

    packet(type, id, fields = {}) {
        if (this.closed || !this.channel.open)
            throw Error('The connection closed. Reconnect and send again.');
        return this.channel.send({ version: 2, type, id, ...fields });
    }

    request(state, type, fields, expected, sequence, timeout = ParachuteTransfer.DELIVERY_GRACE_MS) {
        return new Promise((resolve, reject) => {
            const key = `${expected}:${sequence}`;
            const waiter = { expected, sequence, resolve, reject };
            const cleanup = () => {
                clearTimeout(waiter.timer);
                clearTimeout(waiter.retry);
                state.waiters.delete(key);
            };
            waiter.resolve = reply => {
                cleanup();
                if (waiter.interrupted && ![...state.waiters.values()].some(pending => pending.interrupted))
                    this.hooks.onConnectionStatus?.(false);
                resolve(reply);
            };
            waiter.reject = error => { cleanup(); reject(error); };
            state.waiters.set(key, waiter);
            waiter.timer = setTimeout(() => {
                const error = Error(
                        expected === 'accept'
                            ? 'The parachute offer expired.'
                            : 'Transfer timed out. Reconnect and try again.'
                    );
                if (expected === 'accept') error.code = 'offer-expired';
                waiter.reject(error);
            }, timeout);
            let sending = false;
            const attempt = () => {
                if (!state.waiters.has(key)) return;
                // Errors are retried within the same deadline, never discarded bytes.
                try {
                    if (!sending) {
                        sending = true;
                        Promise.resolve(this.packet(type, state.id, fields)).then(
                            () => { sending = false; }, () => { sending = false; }
                        );
                    }
                }
                catch (error) { waiter.reject(error); return; }
                if (!state.waiters.has(key)) return;
                waiter.retry = setTimeout(() => {
                    if (expected !== 'accept') {
                        waiter.interrupted = true;
                        this.hooks.onConnectionStatus?.(true);
                    }
                    attempt();
                }, ParachuteTransfer.RETRY_MS);
            };
            attempt();
        });
    }

    async send(
        { files = [], url, title = '', color = 'coral', sender = 'Your friend' },
        launch = async () => true
    ) {
        if (this.outgoing || this.closed || !this.channel.open)
            throw Error('Connect to someone before sending.');
        const manifest = ParachuteTransfer.offerFor({ files, url, title, color, sender });
        const state = { id: crypto.randomUUID(), waiters: new Map() };
        this.outgoing = state;
        const current = () =>
            !this.closed && this.channel.open && this.outgoing === state;
        try {
            this.hooks.onStatus?.('Waiting for the parachute to enter their box…', 0);
            const acceptance = await this.request(
                state,
                'offer',
                manifest,
                'accept',
                undefined,
                ParachuteTransfer.OFFER_TIMEOUT_MS
            );
            // Older pages accept without a window capability and still receive serially.
            const windowChunks = acceptance?.windowChunks === ParachuteTransfer.WINDOW_CHUNKS
                ? ParachuteTransfer.WINDOW_CHUNKS : 1;
            if (!current() || !(await launch()) || !current())
                throw Error('Transfer cancelled.');
            let sent = 0,
                sequence = 0;
            let pending = [];
            const flush = async () => {
                const results = await Promise.all(pending);
                pending = [];
                const failed = results.find(result => result.error);
                if (failed) throw failed.error;
            };
            const total = files.reduce((sum, file) => sum + file.size, 0);
            if (manifest.kind === 'files')
                for (let index = 0; index < files.length; index++) {
                    const file = files[index];
                    for (
                        let offset = 0;
                        offset < file.size;
                        offset += ParachuteTransfer.CHUNK_BYTES
                    ) {
                        const bytes = await file
                            .slice(
                                offset,
                                offset + ParachuteTransfer.CHUNK_BYTES
                            )
                            .arrayBuffer();
                        if (!current()) throw Error('Transfer cancelled.');
                        const delivery = this.request(
                            state,
                            'chunk',
                            { index, offset, sequence, bytes },
                            'chunk-received',
                            sequence
                        ).then(() => {
                            sent += bytes.byteLength;
                            this.hooks.onSendProgress?.(total ? sent / total : 1);
                            this.hooks.onStatus?.(
                                `Sending ${Math.round((sent / total) * 100)}%`,
                                total ? sent / total : 1
                            );
                            return {};
                        }, error => ({ error }));
                        pending.push(delivery);
                        sequence++;
                        if (pending.length === windowChunks) await flush();
                    }
                }
            await flush();
            await this.request(state, 'finish', {}, 'complete');
            this.hooks.onStatus?.(
                'Delivered. Your friend received the complete transfer.',
                1
            );
        } catch (error) {
            if (current()) this.packet('cancel', state.id);
            throw error;
        } finally {
            for (const waiter of state.waiters.values()) waiter.reject(Error('Transfer cancelled.'));
            if (this.outgoing === state) this.outgoing = null;
        }
    }

    watchIncoming() {
        const state = this.incoming;
        clearTimeout(state.timer);
        state.timer = setTimeout(
            () => this.decline(state.accepted ? 'Incoming transfer timed out.' : 'The parachute offer expired.', state.accepted ? 'timeout' : 'expired'),
            state.accepted ? 65000 : ParachuteTransfer.OFFER_TIMEOUT_MS
        );
    }

    accept() {
        const state = this.incoming;
        if (!state || state.accepted) return;
        state.accepted = true;
        this.watchIncoming();
        this.packet('accept', state.id, { windowChunks: ParachuteTransfer.WINDOW_CHUNKS });
        this.hooks.onOffer?.(null);
        this.hooks.onReceiveProgress?.(0);
        this.hooks.onStatus?.('Receiving your friend’s transfer…', 0);
    }

    remember(id, type, reason) {
        const previous = this.completed.get(id);
        if (previous) clearTimeout(previous.timer);
        if (this.completed.size >= 100) {
            const oldest = this.completed.keys().next().value;
            clearTimeout(this.completed.get(oldest).timer);
            this.completed.delete(oldest);
        }
        this.completed.set(id, { type, reason, timer: setTimeout(() => this.completed.delete(id), 65000) });
    }

    decline(message = 'Incoming transfer declined.', reason = 'declined') {
        const state = this.incoming;
        if (!state) return;
        clearTimeout(state.timer);
        this.incoming = null;
        this.remember(state.id, 'decline', reason);
        this.packet('decline', state.id, { reason });
        this.hooks.onOffer?.(null);
        this.hooks.onStatus?.(message);
    }

    receive(data) {
        if (
            !data ||
            data.version !== 2 ||
            typeof data.id !== 'string' ||
            !/^[a-zA-Z0-9-]{1,80}$/.test(data.id) ||
            this.closed
        )
            return;
        const outgoing = this.outgoing;
        if (outgoing?.id === data.id) {
            const waiter = outgoing.waiters.get(`${data.type}:${data.sequence}`);
            if (['decline', 'cancel'].includes(data.type)) {
                for (const pending of outgoing.waiters.values()) {
                    const error = Error(data.reason === 'expired'
                        ? 'The parachute offer expired.'
                        : 'Your friend declined or cancelled the transfer.');
                    if (data.reason === 'expired') error.code = 'offer-expired';
                    pending.reject(error);
                }
                // Also cancel a transfer that is waiting for the rocket or a file read.
                this.outgoing = null;
                return;
            }
            if (
                waiter &&
                data.type === waiter.expected &&
                data.sequence === waiter.sequence
            ) {
                waiter.resolve(data);
                return;
            }
        }
        // A lost completion reply must not create a duplicate Received package.
        if (this.completed.has(data.id)) {
            const terminal = this.completed.get(data.id);
            if (['finish', 'offer'].includes(data.type)) this.packet(terminal.type, data.id, { reason: terminal.reason });
            return;
        }
        if (data.type === 'offer') {
            if (this.incoming?.id === data.id) {
                if (this.incoming.accepted) this.packet('accept', data.id, { windowChunks: ParachuteTransfer.WINDOW_CHUNKS });
                return;
            }
            if (this.incoming || !ParachuteTransfer.validateOffer(data)) {
                this.packet('decline', data.id);
                return;
            }
            this.incoming = {
                ...data,
                accepted: false,
                sequence: 0,
                received: 0,
                pending: new Map(),
                parts: data.kind === 'files' ? data.files.map(() => []) : [],
                offsets: data.kind === 'files' ? data.files.map(() => 0) : []
            };
            this.watchIncoming();
            this.hooks.onOffer?.(data);
            return;
        }
        const state = this.incoming;
        if (!state || state.id !== data.id) return;
        if (data.type === 'cancel') {
            clearTimeout(state.timer);
            this.incoming = null;
            this.remember(state.id, 'decline', 'cancelled');
            this.hooks.onOffer?.(null);
            this.hooks.onStatus?.('Your friend cancelled the transfer.');
            return;
        }
        if (!state.accepted) return;
        if (data.type === 'chunk') {
            // MeshClient relays deliver binary payloads as typed arrays.
            const bytes = ArrayBuffer.isView(data.bytes)
                ? data.bytes.buffer.slice(
                      data.bytes.byteOffset,
                      data.bytes.byteOffset + data.bytes.byteLength
                  )
                : data.bytes;
            if (
                state.kind !== 'files' ||
                !Number.isInteger(data.index) ||
                data.index < 0 ||
                data.index >= state.files.length ||
                !Number.isInteger(data.sequence) || data.sequence < 0 ||
                !Number.isSafeInteger(data.offset) || data.offset < 0 ||
                data.offset % ParachuteTransfer.CHUNK_BYTES !== 0 ||
                !(bytes instanceof ArrayBuffer) ||
                bytes.byteLength < 1 ||
                bytes.byteLength > ParachuteTransfer.CHUNK_BYTES ||
                bytes.byteLength !== Math.min(ParachuteTransfer.CHUNK_BYTES, state.files[data.index].size - data.offset) ||
                data.sequence !== state.files.slice(0, data.index).reduce((sum, file) => sum + Math.ceil(file.size / ParachuteTransfer.CHUNK_BYTES), 0) + data.offset / ParachuteTransfer.CHUNK_BYTES ||
                data.sequence >= state.sequence + ParachuteTransfer.WINDOW_CHUNKS
            ) {
                this.decline(
                    'Transfer stopped because its file data was invalid.'
                );
                return;
            }
            if (data.sequence >= state.sequence) {
                state.pending.set(data.sequence, { ...data, bytes });
                while (state.pending.has(state.sequence)) {
                    const next = state.pending.get(state.sequence);
                    state.pending.delete(state.sequence);
                    state.parts[next.index].push(next.bytes);
                    state.offsets[next.index] += next.bytes.byteLength;
                    state.received += next.bytes.byteLength;
                    state.sequence++;
                    this.packet('chunk-received', state.id, { sequence: next.sequence });
                }
            } else this.packet('chunk-received', state.id, { sequence: data.sequence });
            this.watchIncoming();
            const total = state.files.reduce((sum, file) => sum + file.size, 0);
            this.hooks.onReceiveProgress?.(total ? state.received / total : 1);
            this.hooks.onStatus?.(
                `Receiving ${Math.round((state.received / total) * 100)}%`,
                state.received / total
            );
        } else if (data.type === 'finish') {
            if (
                state.kind === 'files' &&
                state.files.some((file, i) => file.size !== state.offsets[i])
            ) {
                this.decline('Transfer stopped because a file was incomplete.');
                return;
            }
            const result = {
                title: state.title,
                color: state.color || 'coral',
                sender: state.sender,
                kind: state.kind,
                url: state.url,
                files:
                    state.kind === 'files'
                        ? state.files.map(
                              (file, i) =>
                                  new File(state.parts[i], file.name, {
                                      type: file.mime
                                  })
                          )
                        : []
            };
            clearTimeout(state.timer);
            this.incoming = null;
            this.remember(state.id, 'complete');
            this.hooks.onComplete?.(result);
            this.packet('complete', state.id);
            this.hooks.onStatus?.(
                'Received. Open Received to save files or view the link.',
                1
            );
        }
    }

    close() {
        this.closed = true;
        for (const waiter of this.outgoing?.waiters.values() || []) {
            waiter.reject(
                Error('Connection closed. The transfer was not completed.')
            );
        }
        for (const terminal of this.completed.values()) clearTimeout(terminal.timer);
        this.completed.clear();
        if (this.incoming) clearTimeout(this.incoming.timer);
        this.outgoing = this.incoming = null;
        this.hooks.onOffer?.(null);
    }
}
window.ParachuteTransfer = ParachuteTransfer;
