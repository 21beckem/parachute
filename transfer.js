// File transport over an already-open PeerJS data connection.
// Each chunk waits for acknowledgment, keeping the network queue bounded.
class ParachuteTransfer {
    static MAX_BYTES = 100 * 1024 * 1024;
    static CHUNK_BYTES = 64 * 1024;
    static MAX_FILES = 20;

    constructor(channel, hooks = {}) {
        this.channel = channel;
        this.hooks = hooks;
        this.outgoing = null;
        this.incoming = null;
        this.closed = false;
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

    packet(type, id, fields = {}) {
        if (this.closed || !this.channel.open)
            throw Error('The connection closed. Reconnect and send again.');
        this.channel.send({ version: 2, type, id, ...fields });
    }

    request(state, type, fields, expected, sequence, timeout = 30000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                state.waiter = null;
                reject(
                    Error(
                        expected === 'accept'
                            ? 'Your friend did not accept in time.'
                            : 'Transfer timed out. Reconnect and try again.'
                    )
                );
            }, timeout);
            state.waiter = { expected, sequence, resolve, reject, timer };
            try {
                this.packet(type, state.id, fields);
            } catch (error) {
                clearTimeout(timer);
                state.waiter = null;
                reject(error);
            }
        });
    }

    async send(
        { files = [], url, sender = 'Your friend' },
        launch = async () => true
    ) {
        if (this.outgoing || this.closed || !this.channel.open)
            throw Error('Connect to someone before sending.');
        const manifest = {
            kind: url ? 'link' : 'files',
            sender: sender.trim().slice(0, 40) || 'Your friend'
        };
        if (url) manifest.url = ParachuteTransfer.website(url);
        else
            manifest.files = files.map((file) => ({
                name: file.name,
                size: file.size,
                mime: file.type || ''
            }));
        if (!ParachuteTransfer.validateOffer(manifest))
            throw Error('Choose up to 20 files, totaling no more than 100 MB.');
        const state = { id: crypto.randomUUID(), waiter: null };
        this.outgoing = state;
        const current = () =>
            !this.closed && this.channel.open && this.outgoing === state;
        try {
            this.hooks.onStatus?.('Waiting for your friend to accept…', 0);
            await this.request(
                state,
                'offer',
                manifest,
                'accept',
                undefined,
                60000
            );
            if (!current() || !(await launch()) || !current())
                throw Error('Transfer cancelled.');
            let sent = 0,
                sequence = 0;
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
                        await this.request(
                            state,
                            'chunk',
                            { index, offset, sequence, bytes },
                            'chunk-received',
                            sequence
                        );
                        sent += bytes.byteLength;
                        sequence++;
                        this.hooks.onStatus?.(
                            `Sending ${Math.round((sent / total) * 100)}%`,
                            total ? sent / total : 1
                        );
                    }
                }
            await this.request(state, 'finish', {}, 'complete');
            this.hooks.onStatus?.(
                'Delivered. Your friend received the complete transfer.',
                1
            );
        } catch (error) {
            if (current()) this.packet('cancel', state.id);
            throw error;
        } finally {
            if (state.waiter) {
                clearTimeout(state.waiter.timer);
                state.waiter = null;
            }
            if (this.outgoing === state) this.outgoing = null;
        }
    }

    watchIncoming() {
        const state = this.incoming;
        clearTimeout(state.timer);
        state.timer = setTimeout(
            () => this.decline('Incoming transfer timed out.'),
            state.accepted ? 45000 : 60000
        );
    }

    accept() {
        const state = this.incoming;
        if (!state || state.accepted) return;
        state.accepted = true;
        this.watchIncoming();
        this.packet('accept', state.id);
        this.hooks.onOffer?.(null);
        this.hooks.onStatus?.('Receiving your friend’s transfer…', 0);
    }

    decline(message = 'Incoming transfer declined.') {
        const state = this.incoming;
        if (!state) return;
        clearTimeout(state.timer);
        this.incoming = null;
        this.packet('decline', state.id);
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
            const waiter = outgoing.waiter;
            if (['decline', 'cancel'].includes(data.type)) {
                if (waiter) {
                    clearTimeout(waiter.timer);
                    outgoing.waiter = null;
                    waiter.reject(
                        Error('Your friend declined or cancelled the transfer.')
                    );
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
                clearTimeout(waiter.timer);
                outgoing.waiter = null;
                waiter.resolve();
                return;
            }
        }
        if (data.type === 'offer') {
            if (this.incoming || !ParachuteTransfer.validateOffer(data)) {
                this.packet('decline', data.id);
                return;
            }
            this.incoming = {
                ...data,
                accepted: false,
                sequence: 0,
                received: 0,
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
            this.hooks.onOffer?.(null);
            this.hooks.onStatus?.('Your friend cancelled the transfer.');
            return;
        }
        if (!state.accepted) return;
        if (data.type === 'chunk') {
            // BinaryPack versions may decode binary fields as a typed array.
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
                data.sequence !== state.sequence ||
                data.offset !== state.offsets[data.index] ||
                !(bytes instanceof ArrayBuffer) ||
                bytes.byteLength < 1 ||
                bytes.byteLength > ParachuteTransfer.CHUNK_BYTES ||
                data.offset + bytes.byteLength > state.files[data.index].size
            ) {
                this.decline(
                    'Transfer stopped because its file data was invalid.'
                );
                return;
            }
            state.parts[data.index].push(bytes);
            state.offsets[data.index] += bytes.byteLength;
            state.received += bytes.byteLength;
            state.sequence++;
            this.watchIncoming();
            this.packet('chunk-received', state.id, {
                sequence: data.sequence
            });
            const total = state.files.reduce((sum, file) => sum + file.size, 0);
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
        if (this.outgoing?.waiter) {
            const waiter = this.outgoing.waiter;
            clearTimeout(waiter.timer);
            waiter.reject(
                Error('Connection closed. The transfer was not completed.')
            );
        }
        if (this.incoming) clearTimeout(this.incoming.timer);
        this.outgoing = this.incoming = null;
        this.hooks.onOffer?.(null);
    }
}
window.ParachuteTransfer = ParachuteTransfer;
