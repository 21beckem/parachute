class ParachuteSharing {
    constructor(connection) {
        this.connection = connection;
        this.transports = new Map();
        this.offers = new Map();
        this.entries = new Set();
        this.receivedNames = new Map();
        this.busy = false;
        for (const [key, id] of Object.entries({
            shareDialog: 'share-dialog', receivedDialog: 'received-dialog',
            shareFiles: 'share-files', shareLink: 'share-link',
            shareFeedback: 'share-feedback', transferStatus: 'transfer-status',
            sendFiles: 'send-files', sendLink: 'send-link',
            cancelTransfer: 'cancel-transfer', showReceived: 'show-received',
            receivedItems: 'received-items', receivedEmpty: 'received-empty'
        })) this[key] = document.getElementById(id);
        document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => {
            document.getElementById(button.dataset.close).close();
        }));
        document.getElementById('share-files-form').addEventListener('submit', event => {
            event.preventDefault();
            const files = Array.from(this.shareFiles.files);
            if (!files.length) return this.status('Choose at least one file.');
            void this.send({ files });
        });
        document.getElementById('share-link-form').addEventListener('submit', event => {
            event.preventDefault();
            void this.send({ url: this.shareLink.value.trim() });
        });
        this.showReceived.addEventListener('click', () => this.receivedDialog.showModal());
        const box = document.querySelector('.drop-box');
        box.setAttribute('role', 'button');
        box.setAttribute('tabindex', '0');
        box.addEventListener('click', () => this.receivedDialog.showModal());
        box.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            this.receivedDialog.showModal();
        });
        this.cancelTransfer.addEventListener('click', () => this.cancel());
        window.addEventListener('pagehide', () => {
            this.reset();
            for (const entry of this.entries) this.remove(entry);
        });
        this.sync();
        this.updateCount();
    }

    static size(bytes) {
        return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024
            ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }

    status(message) {
        this.shareFeedback.textContent = message;
        this.transferStatus.textContent = message;
        this.transferStatus.hidden = false;
    }

    sync() {
        const nearby = this.connection.active ? this.connection.mesh?.peers.length || 0 : 0;
        const enabled = nearby > 0 && !this.busy;
        this.connection.send.disabled = !enabled;
        this.sendFiles.disabled = this.sendLink.disabled = !enabled;
        this.shareFiles.disabled = this.shareLink.disabled = this.busy;
        this.cancelTransfer.hidden = !this.busy;
    }

    open() {
        if (this.busy || !this.connection.active || !this.connection.mesh?.peers.length) return;
        this.shareFeedback.textContent = 'Everyone currently nearby gets a parachute. Their transfer starts when it enters their box.';
        this.shareDialog.showModal();
    }

    transportFor(uid) {
        if (this.transports.has(uid)) return this.transports.get(uid);
        const channel = this.connection.channelFor(uid);
        if (!channel) return null;
        const transport = new window.ParachuteTransfer(channel, {
            onStatus: message => { if (!this.batch) this.status(message); },
            onOffer: offer => this.offer(uid, offer),
            onComplete: result => {
                const pending = this.offers.get(uid);
                if (!pending?.accepted) return;
                this.clearOffer(uid);
                this.delivered(result);
            }
        });
        this.transports.set(uid, transport);
        return transport;
    }

    hasActiveTransfer(uid) {
        const transport = this.transports.get(uid);
        return !!(transport?.outgoing || transport?.incoming);
    }

    hasCapacity(bytes) {
        const used = [...this.entries].reduce((sum, entry) => sum + entry.bytes, 0);
        const accepted = [...this.offers.values()].filter(item => item.accepted);
        const reserved = accepted.reduce((sum, item) => sum + item.bytes, 0);
        return used + reserved + bytes <= window.ParachuteTransfer.MAX_BYTES
            && this.entries.size + accepted.length < 100;
    }

    offer(uid, offer) {
        const transport = this.transports.get(uid);
        if (!offer) {
            const item = this.offers.get(uid);
            if (item?.accepted && transport?.incoming?.id === item.offer.id) return;
            this.clearOffer(uid);
            return;
        }
        const bytes = offer.kind === 'files' ? offer.files.reduce((sum, file) => sum + file.size, 0) : 0;
        if (this.offers.size >= 20 || !this.hasCapacity(bytes) || window.ParachuteAnimation.deliveries.size >= 20) {
            transport.decline('Received is full. Save and remove some items before receiving more.', 'full');
            return;
        }
        const item = { uid, offer, bytes, accepted: false, transport };
        this.offers.set(uid, item);
        const preview = offer.kind === 'link' ? [] : offer.files.map(file => ({ name: file.name, type: file.mime }));
        const type = offer.kind === 'link' ? 'link' : window.ParachuteAnimation.typeOf(preview);
        const title = offer.kind === 'link' ? 'Website link' : offer.files.length === 1
            ? offer.files[0].name : `${offer.files.length} files`;
        item.delivery = window.animation.dropParachute(preview, type, {
            onCatch: () => this.catchOffer(uid, item),
            onExpire: () => this.expireOffer(uid, item)
        });
        const element = item.delivery.element;
        element.dataset.offerId = offer.id;
        element.dataset.sender = String(uid);
        element.classList.add('is-offer');
        element.setAttribute('aria-label', `Parachute from ${offer.sender}: ${title}. Put it in the box to receive. Missed offers expire.`);
        const label = document.createElement('span');
        label.className = 'delivery-offer-label';
        label.textContent = `${offer.sender}: ${title}`;
        element.append(label);
        item.timer = setTimeout(() => this.expireOffer(uid, item), window.ParachuteTransfer.OFFER_TIMEOUT_MS);
        if (!this.batch) this.status(`${offer.sender} sent a parachute. Put it in your box to receive it; missed offers expire.`);
    }

    catchOffer(uid, item) {
        if (this.offers.get(uid) !== item || item.accepted || item.transport.incoming?.id !== item.offer.id) return;
        if (!this.hasCapacity(item.bytes)) {
            item.transport.decline('Received is full. Save and remove some items before receiving more.', 'full');
            return;
        }
        item.accepted = true;
        clearTimeout(item.timer);
        // Called only after the entry animation finishes inside the box.
        item.transport.accept();
    }

    expireOffer(uid, item) {
        if (this.offers.get(uid) !== item || item.accepted) return;
        item.transport.decline('The parachute offer expired.', 'expired');
    }

    clearOffer(uid) {
        const item = this.offers.get(uid);
        if (!item) return;
        this.offers.delete(uid);
        clearTimeout(item.timer);
        item.delivery?.cancel();
    }

    batchStatus(batch) {
        const counts = {};
        for (const record of batch.records.values()) counts[record.state] = (counts[record.state] || 0) + 1;
        const labels = { waiting: 'waiting for a catch', sending: 'receiving', delivered: 'received', expired: 'expired', failed: 'unavailable', cancelled: 'cancelled' };
        const summary = Object.entries(labels).filter(([state]) => counts[state]).map(([state, label]) => `${counts[state]} ${label}`).join(', ');
        this.status(`${batch.records.size} nearby device${batch.records.size === 1 ? '' : 's'}: ${summary}.`);
    }

    async send(content) {
        if (this.busy || !this.connection.active) return;
        const targets = [...this.connection.mesh.peers];
        if (!targets.length) return this.status('No nearby devices right now. Try again when someone appears.');
        const sender = window.parachuteProfile?.displayName || 'Someone nearby';
        try { window.ParachuteTransfer.offerFor({ ...content, sender }); }
        catch (error) { this.status(error.message); return; }
        const batch = { records: new Map(targets.map(uid => [uid, { state: 'waiting' }])), cancelled: false };
        this.batch = batch;
        this.busy = true;
        this.sync();
        this.shareDialog.close();
        this.batchStatus(batch);
        const tasks = targets.map(async uid => {
            const record = batch.records.get(uid);
            try {
                const transport = this.transportFor(uid);
                if (!transport) throw Error('Device is no longer nearby.');
                await transport.send({ ...content, sender }, () => {
                    if (batch.cancelled) return false;
                    record.state = 'sending';
                    this.batchStatus(batch);
                    return true;
                });
                record.state = 'delivered';
            } catch (error) {
                record.state = batch.cancelled ? 'cancelled' : error.code === 'offer-expired' ? 'expired' : 'failed';
            }
            if (this.batch === batch) this.batchStatus(batch);
        });
        void window.animation.launchRocket().catch(() => {});
        await Promise.allSettled(tasks);
        if (this.batch !== batch) return;
        this.batchStatus(batch);
        this.batch = null;
        this.busy = false;
        this.shareFiles.value = this.shareLink.value = '';
        this.sync();
    }

    cancel() {
        if (!this.batch) return;
        this.batch.cancelled = true;
        for (const uid of this.batch.records.keys()) {
            const transport = this.transports.get(uid);
            if (!transport?.outgoing) continue;
            const id = transport.outgoing.id;
            try { transport.packet('cancel', id); } catch { /* The relay may already be closed. */ }
            transport.receive({ version: 2, type: 'cancel', id });
        }
    }

    delivered(result) {
        const entry = { bytes: result.files.reduce((sum, file) => sum + file.size, 0), urls: [], items: [], node: document.createElement('article') };
        entry.node.className = 'received-entry';
        const header = document.createElement('div');
        header.className = 'received-heading';
        const sender = document.createElement('h3');
        sender.textContent = `From ${result.sender}`;
        const time = document.createElement('time');
        const now = new Date();
        time.dateTime = now.toISOString();
        time.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        time.title = now.toLocaleString();
        header.append(sender, time);
        entry.node.append(header);
        let contents = entry.node;
        if (result.files.length > 1) {
            const packageDetails = document.createElement('details');
            packageDetails.className = 'received-package';
            const summary = document.createElement('summary');
            summary.append(this.artwork('other'));
            const label = document.createElement('span');
            label.textContent = `${result.files.length} files · ${ParachuteSharing.size(entry.bytes)}`;
            const hint = document.createElement('small');
            hint.textContent = 'View files';
            summary.append(label, hint);
            contents = document.createElement('div');
            contents.className = 'received-package-items';
            packageDetails.append(summary, contents);
            entry.node.append(packageDetails);
        }
        for (const item of result.kind === 'link' ? [result.url] : result.files) {
            const link = document.createElement('a');
            link.className = 'received-item';
            const isLink = typeof item === 'string';
            const name = isLink ? item : item.name;
            const type = isLink ? 'link' : window.ParachuteAnimation.typeOf(item);
            const art = this.artwork(type);
            link.append(art);
            if (typeof item === 'string') {
                link.href = window.ParachuteTransfer.website(item);
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
            } else {
                link.href = URL.createObjectURL(item);
                entry.urls.push(link.href);
                link.download = item.name;
                if (type === 'picture') {
                    const thumbnail = document.createElement('img');
                    thumbnail.className = 'received-thumbnail';
                    thumbnail.alt = `Preview of ${item.name}`;
                    thumbnail.loading = 'lazy';
                    thumbnail.decoding = 'async';
                    thumbnail.addEventListener('load', () => { art.setAttribute('hidden', ''); });
                    thumbnail.addEventListener('error', () => { thumbnail.hidden = true; art.removeAttribute('hidden'); });
                    thumbnail.src = link.href;
                    link.append(thumbnail);
                }
            }
            const text = document.createElement('span');
            text.className = 'received-item-text';
            const title = document.createElement('strong');
            const meta = document.createElement('small');
            meta.textContent = isLink ? `${new URL(item).hostname} · Open link ↗`
                : `${ParachuteSharing.size(item.size)} · Download ↓`;
            text.append(title, meta);
            link.append(text);
            let group = this.receivedNames.get(name);
            if (!group) this.receivedNames.set(name, group = { next: 1, numbered: false, items: new Set() });
            const record = { name, group, number: group.next++, title, link, sender: result.sender, isLink };
            group.items.add(record);
            if (group.items.size > 1) group.numbered = true;
            for (const other of group.items) {
                const label = `${other.name}${group.numbered ? ` #${other.number}` : ''}`;
                other.title.textContent = label;
                other.link.setAttribute('aria-label', `${other.isLink ? 'Open' : 'Download'} ${label}, from ${other.sender}`);
            }
            entry.items.push(record);
            contents.append(link);
        }
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = 'Remove';
        remove.addEventListener('click', () => this.remove(entry));
        entry.node.append(remove);
        this.entries.add(entry);
        this.receivedItems.prepend(entry.node);
        this.updateCount();
    }

    remove(entry) {
        for (const url of entry.urls) URL.revokeObjectURL(url);
        for (const item of entry.items) {
            item.group.items.delete(item);
            if (!item.group.items.size) this.receivedNames.delete(item.name);
        }
        entry.node.remove();
        this.entries.delete(entry);
        this.updateCount();
    }

    artwork(type) {
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('class', 'received-art');
        svg.setAttribute('viewBox', '40 140 120 90');
        svg.setAttribute('aria-hidden', 'true');
        const use = document.createElementNS(ns, 'use');
        use.setAttribute('href', `#payload-${type}`);
        use.setAttribute('width', '200');
        use.setAttribute('height', '230');
        svg.append(use);
        return svg;
    }

    updateCount() {
        this.showReceived.textContent = `Received (${this.entries.size})`;
        this.receivedEmpty.hidden = this.entries.size > 0;
        document.querySelector('.drop-box').setAttribute('aria-label', `Receiving box. Open received items (${this.entries.size}).`);
    }

    closePeer(uid) {
        const transport = this.transports.get(uid);
        this.transports.delete(uid);
        transport?.close();
        this.clearOffer(uid);
        this.sync();
    }

    reset() {
        for (const uid of [...this.transports.keys()]) this.closePeer(uid);
        this.batch = null;
        this.busy = false;
        this.sync();
    }
}
window.parachuteSharing = new ParachuteSharing(window.parachuteConnection);
