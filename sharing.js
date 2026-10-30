class ParachuteSharing {
    constructor(connection) {
        this.connection = connection;
        this.transport = null;
        this.busy = false;
        this.entries = new Set();
        const controls = {
            shareDialog: 'share-dialog',
            incomingDialog: 'incoming-dialog',
            receivedDialog: 'received-dialog',
            shareFiles: 'share-files',
            shareLink: 'share-link',
            shareFeedback: 'share-feedback',
            transferStatus: 'transfer-status',
            sendFiles: 'send-files',
            sendLink: 'send-link',
            cancelTransfer: 'cancel-transfer',
            showReceived: 'show-received',
            incomingDescription: 'incoming-description',
            incomingItems: 'incoming-items',
            receivedItems: 'received-items',
            receivedEmpty: 'received-empty'
        };
        for (const [name, id] of Object.entries(controls)) {
            this[name] = document.getElementById(id);
        }
        document.querySelectorAll('[data-close]').forEach((button) =>
            button.addEventListener('click', () => {
                document.getElementById(button.dataset.close).close();
            })
        );
        document
            .getElementById('share-files-form')
            .addEventListener('submit', (event) => {
                event.preventDefault();
                const files = Array.from(this.shareFiles.files);
                if (!files.length)
                    return this.status('Choose at least one file.');
                this.send({ files });
            });
        document
            .getElementById('share-link-form')
            .addEventListener('submit', (event) => {
                event.preventDefault();
                this.send({ url: this.shareLink.value.trim() });
            });
        this.showReceived.addEventListener('click', () =>
            this.receivedDialog.showModal()
        );
        document
            .getElementById('accept-transfer')
            .addEventListener('click', () => this.transport?.accept());
        document
            .getElementById('decline-transfer')
            .addEventListener('click', () => this.transport?.decline());
        this.incomingDialog.addEventListener('cancel', (event) => {
            event.preventDefault();
            this.transport?.decline();
        });
        this.cancelTransfer.addEventListener('click', () => this.cancel());
        window.addEventListener('pagehide', () => {
            this.reset();
            for (const entry of this.entries) this.remove(entry);
        });
        // Putting a real delivery in the box opens the saved content list.
        document
            .querySelector('.drop-box')
            .addEventListener('file-received', (event) => {
                if (
                    event.detail.files.length &&
                    !this.receivedDialog.open &&
                    !this.incomingDialog.open &&
                    !this.shareDialog.open
                )
                    this.receivedDialog.showModal();
            });
        if (connection.channel?.open) this.connected(connection.channel);
        this.sync();
    }

    static size(bytes) {
        return bytes < 1024
            ? `${bytes} B`
            : bytes < 1024 * 1024
              ? `${(bytes / 1024).toFixed(1)} KB`
              : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }

    status(message) {
        this.shareFeedback.textContent = message;
        this.transferStatus.textContent = message;
        this.transferStatus.hidden = false;
    }

    sync() {
        const enabled = !!this.connection.channel?.open && !this.busy;
        this.connection.send.disabled = !enabled;
        this.sendFiles.disabled = this.sendLink.disabled = !enabled;
        this.shareFiles.disabled = this.shareLink.disabled = this.busy;
        this.cancelTransfer.hidden = !this.busy;
    }

    open() {
        if (!this.connection.channel?.open || this.busy) return;
        this.shareFeedback.textContent =
            'Your friend will be asked to accept before the transfer starts.';
        this.shareDialog.showModal();
    }

    connected(channel) {
        this.reset();
        this.transport = new window.ParachuteTransfer(channel, {
            onStatus: (message) => this.status(message),
            onOffer: (offer) => this.offer(offer),
            onComplete: (result) => this.delivered(result)
        });
        this.sync();
    }

    offer(offer) {
        if (!offer) {
            if (this.incomingDialog.open) this.incomingDialog.close();
            return;
        }
        const retained = [...this.entries].reduce(
            (sum, entry) => sum + entry.bytes,
            0
        );
        const bytes =
            offer.kind === 'files'
                ? offer.files.reduce((sum, file) => sum + file.size, 0)
                : 0;
        if (
            retained + bytes > window.ParachuteTransfer.MAX_BYTES ||
            this.entries.size >= 100
        ) {
            this.transport.decline(
                'Received is full. Save and remove some items before accepting more.'
            );
            return;
        }
        this.incomingDescription.textContent = `${offer.sender} wants to send ${offer.kind === 'link' ? 'a website link' : `${offer.files.length} file${offer.files.length === 1 ? '' : 's'} (${ParachuteSharing.size(bytes)})`}.`;
        this.incomingItems.replaceChildren();
        const labels =
            offer.kind === 'link'
                ? [offer.url]
                : offer.files.map(
                      (file) =>
                          `${file.name} · ${ParachuteSharing.size(file.size)}`
                  );
        for (const label of labels) {
            const item = document.createElement('li');
            item.textContent = label;
            this.incomingItems.append(item);
        }
        if (!this.incomingDialog.open) this.incomingDialog.showModal();
    }

    async send(content) {
        if (!this.transport || this.busy || !this.connection.channel?.open)
            return;
        this.busy = true;
        const transport = this.transport;
        this.sync();
        try {
            await transport.send(
                {
                    ...content,
                    sender:
                        window.parachuteProfile?.displayName || 'Your friend'
                },
                () => window.animation.launchRocket()
            );
            this.shareFiles.value = this.shareLink.value = '';
        } catch (error) {
            if (this.transport === transport)
                this.status(
                    error.message || 'The transfer could not be completed.'
                );
        } finally {
            if (this.transport === transport) {
                this.busy = false;
                this.sync();
            }
        }
    }

    cancel() {
        const transport = this.transport;
        if (!transport) return;
        if (transport.outgoing) {
            transport.packet('cancel', transport.outgoing.id);
            transport.receive({
                version: 2,
                type: 'cancel',
                id: transport.outgoing.id
            });
        }
        this.status('Transfer cancelled.');
    }

    delivered(result) {
        const entry = {
            bytes: result.files.reduce((sum, file) => sum + file.size, 0),
            urls: [],
            node: document.createElement('article')
        };
        entry.node.className = 'received-entry';
        const heading = document.createElement('h3');
        heading.textContent = `From ${result.sender}`;
        entry.node.append(heading);
        const payload = result.kind === 'link' ? [result.url] : result.files;
        for (const item of payload) {
            const row = document.createElement('p');
            const link = document.createElement('a');
            if (typeof item === 'string') {
                link.href = window.ParachuteTransfer.website(item);
                link.textContent = item;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
            } else {
                const url = URL.createObjectURL(item);
                entry.urls.push(url);
                link.href = url;
                link.download = item.name;
                link.textContent = `Save ${item.name} (${ParachuteSharing.size(item.size)})`;
            }
            row.append(link);
            entry.node.append(row);
        }
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = 'Remove';
        remove.addEventListener('click', () => this.remove(entry));
        entry.node.append(remove);
        this.entries.add(entry);
        this.receivedItems.prepend(entry.node);
        if (window.ParachuteAnimation.deliveries.size < 20)
            entry.delivery = window.animation.dropParachute(payload);
        this.updateCount();
    }

    remove(entry) {
        entry.delivery?.cancel();
        for (const url of entry.urls) URL.revokeObjectURL(url);
        entry.node.remove();
        this.entries.delete(entry);
        this.updateCount();
    }

    updateCount() {
        this.showReceived.textContent = `Received (${this.entries.size})`;
        this.receivedEmpty.hidden = this.entries.size > 0;
    }

    reset() {
        const active = this.busy || this.transport?.incoming;
        this.transport?.close();
        this.transport = null;
        if (active)
            this.status('Connection closed. The transfer was not completed.');
        this.busy = false;
        this.sync();
    }
}
window.parachuteSharing = new ParachuteSharing(window.parachuteConnection);
