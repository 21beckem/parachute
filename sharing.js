class ParachuteSharing {
    constructor(connection) {
        this.connection = connection;
        this.transports = new Map();
        this.offers = new Map();
        this.entries = new Set();
        this.receivedNames = new Map();
        this.arrivals = new Set();
        this.busy = false;
        this.selectedFiles = [];
        this.selectedURLs = [];
        this.parachuteColor = 'coral';
        for (const [key, id] of Object.entries({
            shareDialog: 'share-dialog', receivedDialog: 'received-dialog',
            shareFiles: 'share-files', shareLink: 'share-link',
            shareFeedback: 'share-feedback', transferStatus: 'transfer-status',
            sendFiles: 'send-files', sendLink: 'send-link',
            cancelTransfer: 'cancel-transfer', showReceived: 'show-received',
            receivedItems: 'received-items', receivedEmpty: 'received-empty',
            parachuteTitle: 'parachute-title', selectedList: 'selected-files',
            previewDialog: 'preview-dialog', previewContent: 'preview-content',
            deliveryProgress: 'delivery-progress', deliveryPeople: 'delivery-people'
        })) this[key] = document.getElementById(id);
        document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => {
            document.getElementById(button.dataset.close).close();
        }));
        for (const dialog of [this.shareDialog, this.receivedDialog, this.previewDialog]) {
            let startedOutside = false;
            const outside = event => {
                if (event.target !== dialog) return false;
                const rect = dialog.getBoundingClientRect();
                return event.clientX < rect.left || event.clientX > rect.right
                    || event.clientY < rect.top || event.clientY > rect.bottom;
            };
            dialog.addEventListener('pointerdown', event => {
                startedOutside = event.button === 0 && outside(event);
            });
            dialog.addEventListener('pointercancel', () => { startedOutside = false; });
            dialog.addEventListener('click', event => {
                if (startedOutside && outside(event)) dialog.close();
                startedOutside = false;
            });
        }
        document.addEventListener('click', event => {
            if (!this.deliveryProgress.contains(event.target)) this.deliveryProgress.open = false;
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') this.deliveryProgress.open = false;
        });
        document.getElementById('share-files-form').addEventListener('submit', event => {
            event.preventDefault();
            const files = this.selectedFiles;
            if (!files.length) return this.status('Choose at least one file.');
            void this.send({ files, title: this.parachuteTitle.value.trim(), color: this.parachuteColor });
        });
        document.getElementById('share-link-form').addEventListener('submit', event => {
            event.preventDefault();
            void this.send({ url: this.shareLink.value.trim(), title: this.parachuteTitle.value.trim(), color: this.parachuteColor });
        });
        for (const color of window.ParachuteTransfer.COLORS) {
            const radio = document.getElementById(`color-${color}`);
            radio.addEventListener('change', () => {
                if (radio.checked && !this.busy) this.parachuteColor = color;
            });
        }
        this.shareFiles.addEventListener('change', () => {
            this.addFiles(Array.from(this.shareFiles.files));
            this.shareFiles.value = '';
        });
        const zone = document.getElementById('file-drop-zone');
        for (const type of ['dragenter', 'dragover']) zone.addEventListener(type, event => {
            event.preventDefault();
            if (!this.busy) zone.classList.add('drag-over');
        });
        zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
        zone.addEventListener('drop', event => {
            event.preventDefault();
            zone.classList.remove('drag-over');
            if (!this.busy) this.addFiles(Array.from(event.dataTransfer.files));
        });
        for (const kind of ['files', 'link']) {
            const tab = document.getElementById(`${kind}-tab`);
            tab.addEventListener('click', () => this.selectTab(kind));
            tab.addEventListener('keydown', event => {
                if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                    event.preventDefault();
                    const next = event.key === 'Home' ? 'files' : event.key === 'End' ? 'link' : kind === 'files' ? 'link' : 'files';
                    this.selectTab(next);
                    document.getElementById(`${next}-tab`).focus();
                }
            });
        }
        this.previewDialog.addEventListener('close', () => this.clearPreview());
        this.receivedDialog.addEventListener('close', () => {
            for (const entry of this.entries) entry.badge.hidden = true;
        });
        const box = document.querySelector('.drop-box');
        box.setAttribute('role', 'button');
        box.setAttribute('tabindex', '0');
        box.addEventListener('click', event => {
            // A caught delivery can still be inside the box during its entry animation.
            if (event.defaultPrevented || event.target.closest('.falling-parachute')) return;
            this.receivedDialog.showModal();
        });
        box.addEventListener('keydown', event => {
            if (event.target !== box) return;
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            this.receivedDialog.showModal();
        });
        this.cancelTransfer.addEventListener('click', () => this.cancel());
        window.addEventListener('pagehide', () => {
            this.clearSelectedURLs();
            this.clearPreview();
            this.reset();
            for (const entry of this.entries) this.remove(entry);
        });
        this.sync();
        this.updateCount();
    }

    selectTab(kind) {
        for (const value of ['files', 'link']) {
            const active = value === kind;
            const tab = document.getElementById(`${value}-tab`);
            tab.setAttribute('aria-selected', String(active));
            tab.tabIndex = active ? 0 : -1;
            document.getElementById(`share-${value === 'files' ? 'files' : 'link'}-form`).hidden = !active;
        }
    }

    addFiles(files) {
        if (this.busy) return;
        const next = [...this.selectedFiles, ...files];
        try { window.ParachuteTransfer.offerFor({ files: next }); }
        catch (error) { this.status(error.message); return; }
        this.selectedFiles = next;
        this.renderSelectedFiles();
        this.shareFeedback.textContent = 'Ready when you are.';
    }

    clearSelectedURLs() {
        for (const url of this.selectedURLs) URL.revokeObjectURL(url);
        this.selectedURLs = [];
    }

    renderSelectedFiles() {
        this.clearSelectedURLs();
        this.selectedList.replaceChildren();
        this.selectedFiles.forEach((file, index) => {
            const row = document.createElement('div');
            row.className = 'selected-file';
            const kind = window.ParachuteAnimation.typeOf(file);
            if (/^image\/(png|jpeg|gif|webp|avif|bmp)$/i.test(file.type)) {
                const image = document.createElement('img');
                image.alt = '';
                image.src = URL.createObjectURL(file);
                this.selectedURLs.push(image.src);
                row.append(image);
            } else row.append(this.artwork(kind));
            const text = document.createElement('span');
            const name = document.createElement('strong');
            name.textContent = file.name;
            const size = document.createElement('small');
            size.textContent = ParachuteSharing.size(file.size);
            text.append(name, size);
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.textContent = '×';
            remove.setAttribute('aria-label', `Remove ${file.name}`);
            remove.addEventListener('click', () => {
                if (this.busy) return;
                this.selectedFiles.splice(index, 1);
                this.renderSelectedFiles();
                if (this.selectedFiles.length) this.selectedList.querySelector('button')?.focus();
                else this.shareFiles.focus();
            });
            row.append(text, remove);
            this.selectedList.append(row);
        });
    }

    static deliveryTitle(content) {
        const title = typeof content.title === 'string' ? content.title.trim() : '';
        if (title) return title;
        if (content.kind === 'link' || content.url) return 'Link';
        const files = content.files || [];
        if (files.length > 1) return 'Package';
        const file = files[0] || {};
        const type = window.ParachuteAnimation.typeOf({name: file.name, type: file.type || file.mime || ''});
        return {file:'File', folder:'Folder', music:'Music', picture:'Picture', video:'Video', link:'Link', other:'Package'}[type] || 'File';
    }

    clearPreview() {
        this.previewToken = null;
        for (const media of this.previewContent.querySelectorAll?.('video, audio') || []) {
            media.pause();
            media.removeAttribute('src');
            media.load();
        }
        this.previewContent.replaceChildren();
        this.previewEntry = null;
        const download = document.getElementById('preview-download');
        download.removeAttribute('href');
        download.removeAttribute('download');
    }

    async preview(file, url, entry) {
        this.clearPreview();
        const token = this.previewToken = {};
        this.previewEntry = entry;
        document.getElementById('preview-title').textContent = file.name;
        document.getElementById('preview-sender').textContent = `${entry.title} · From ${entry.sender}`;
        const download = document.getElementById('preview-download');
        download.href = url;
        download.download = file.name;
        this.previewDialog.showModal();
        const fallback = () => {
            if (this.previewToken !== token) return;
            const note = document.createElement('p');
            note.className = 'preview-unavailable';
            note.textContent = 'Preview unavailable for this file in your browser. You can still download it.';
            this.previewContent.replaceChildren(note);
        };
        const mime = file.type.toLowerCase();
        // Only passive image/media formats are embedded. HTML and SVG never run here.
        let tag;
        if (/^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(mime)) tag = 'img';
        else if (mime.startsWith('video/')) tag = 'video';
        else if (mime.startsWith('audio/')) tag = 'audio';
        else if (mime === 'application/pdf') tag = 'object';
        if (tag) {
            const media = document.createElement(tag);
            if (tag === 'object') {
                media.type = 'application/pdf';
                media.data = url;
                media.setAttribute('aria-label', `PDF preview: ${file.name}`);
                const note = document.createElement('p');
                note.textContent = 'If the PDF does not display here, use Download to open it.';
                media.append(note);
            } else {
                media.src = url;
                if (tag === 'img') media.alt = file.name;
                else { media.controls = true; media.preload = 'metadata'; }
            }
            media.addEventListener('error', fallback);
            this.previewContent.append(media);
        } else if (/^text\/(plain|csv)$/.test(mime) || (!mime && /\.(txt|csv|log|md)$/i.test(file.name))) {
            if (file.size > 1024 * 1024) { fallback(); return; }
            try {
                const text = await file.text();
                if (this.previewToken !== token) return;
                const pre = document.createElement('pre');
                pre.textContent = text;
                this.previewContent.append(pre);
            } catch { fallback(); }
        } else fallback();
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
        const nearby = this.connection.nearbyPeers().length;
        const enabled = nearby > 0 && !this.busy;
        this.connection.send.disabled = !enabled;
        this.sendFiles.disabled = this.sendLink.disabled = !enabled;
        this.shareFiles.disabled = this.shareLink.disabled = this.parachuteTitle.disabled = this.busy;
        this.cancelTransfer.hidden = !this.busy;
        for (const color of window.ParachuteTransfer.COLORS) document.getElementById(`color-${color}`).disabled = this.busy;
    }

    open() {
        if (this.busy || !this.connection.active || !this.connection.nearbyPeers().length) return;
        this.shareFeedback.textContent = 'Ready when you are.';
        this.shareDialog.showModal();
    }

    transportFor(uid) {
        if (this.transports.has(uid)) return this.transports.get(uid);
        const channel = this.connection.channelFor(uid);
        if (!channel) return null;
        const transport = new window.ParachuteTransfer(channel, {
            onStatus: message => { if (!this.batch) this.status(message); },
            onSendProgress: progress => {
                const record = this.batch?.records.get(uid);
                if (record && ['sending', 'reconnecting'].includes(record.state) && Number.isFinite(progress)) {
                    record.progress = progress;
                    this.batchStatus(this.batch);
                }
            },
            onConnectionStatus: interrupted => this.connectionStatus(uid, interrupted),
            onOffer: offer => this.offer(uid, offer),
            onReceiveProgress: progress => {
                const pending = this.offers.get(uid);
                if (!pending?.loading) return;
                pending.progress.value = progress;
                pending.caption.textContent = `Receiving from ${pending.offer.sender} · ${Math.round(progress * 100)}%`;
            },
            onComplete: result => {
                const pending = this.offers.get(uid);
                if (!pending?.accepted) return;
                this.clearOffer(uid);
                this.delivered(result);
                this.animateArrival(result);
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
        const type = offer.kind === 'link' ? 'link' : offer.files.length > 1 ? 'other' : window.ParachuteAnimation.typeOf(preview);
        item.type = type;
        const title = ParachuteSharing.deliveryTitle(offer);
        item.delivery = window.animation.dropParachute(preview, type, {
            onCatch: () => this.catchOffer(uid, item),
            onExpire: () => this.expireOffer(uid, item)
        });
        const element = item.delivery.element;
        element.dataset.parachuteColor = window.ParachuteTransfer.COLORS.includes(offer.color) ? offer.color : 'coral';
        element.dataset.offerId = offer.id;
        element.dataset.sender = String(uid);
        element.classList.add('is-offer');
        element.setAttribute('aria-label', `Parachute from ${offer.sender}: ${title}. Put it in the box to receive. Missed offers expire.`);
        const label = document.createElement('span');
        label.className = 'delivery-offer-label';
        label.title = `${title} · From ${offer.sender}`;
        const name = document.createElement('strong');
        name.className = 'delivery-tag-title';
        name.textContent = title;
        const sender = document.createElement('span');
        sender.className = 'delivery-tag-sender';
        sender.textContent = `From ${offer.sender}`;
        const detail = document.createElement('span');
        detail.className = 'delivery-tag-detail';
        detail.textContent = offer.kind === 'link' ? 'Website link'
            : `${offer.files.length} file${offer.files.length === 1 ? '' : 's'} · ${ParachuteSharing.size(bytes)}`;
        label.append(name, sender, detail);
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
        this.showReceiving(item);
        window.ParachuteAnimation.announce?.('Parachute caught. Requesting your delivery…');
        // Called only after the entry animation finishes inside the box.
        item.transport.accept();
    }

    expireOffer(uid, item) {
        if (this.offers.get(uid) !== item || item.accepted) return;
        item.transport.decline('The parachute offer expired.', 'expired');
    }

    clearOffer(uid, reason = 'cancelled') {
        const item = this.offers.get(uid);
        if (!item) return;
        this.offers.delete(uid);
        clearTimeout(item.timer);
        if (reason === 'disconnected') item.delivery?.disconnect();
        else item.delivery?.cancel();
        item.loading?.remove();
    }

    showReceiving(item) {
        const loading = document.createElement('div');
        loading.className = 'incoming-transfer';
        loading.setAttribute('role', 'status');
        const art = this.artwork('other');
        art.classList.add('transfer-mascot');
        const caption = document.createElement('strong');
        caption.textContent = `Requesting from ${item.offer.sender}…`;
        const progress = document.createElement('progress');
        progress.max = 1;
        progress.value = 0;
        progress.setAttribute('aria-label', `Transfer from ${item.offer.sender}`);
        loading.append(art, caption, progress);
        document.getElementById('incoming-transfers').append(loading);
        Object.assign(item, { loading, caption, progress });
    }

    animateArrival(result) {
        const icon = document.createElement('div');
        icon.className = 'received-arrival';
        icon.setAttribute('aria-hidden', 'true');
        const type = result.kind === 'link' ? 'link' : result.files.length > 1
            ? 'other' : window.ParachuteAnimation.typeOf(result.files);
        icon.append(this.artwork(type));
        document.getElementById('delivery-effects').append(icon);
        const box = document.querySelector('.drop-box').getBoundingClientRect();
        const dx = (box.left + box.right) / 2 - innerWidth / 2;
        const dy = (box.top + box.bottom) / 2 - innerHeight * .4;
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const flight = icon.animate(reduced ? [{ opacity: 1 }, { opacity: 0 }] : [
            { transform: 'translate(-50%, -50%) scale(.7)', opacity: 0, offset: 0 },
            { transform: 'translate(-50%, -50%) scale(1.08)', opacity: 1, offset: .16 },
            { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: .32 },
            { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.12)`, opacity: 0, offset: 1 }
        ], { duration: reduced ? 150 : 1100, easing: 'ease-in-out', fill: 'forwards' });
        const arrival = { icon, flight };
        this.arrivals.add(arrival);
        void flight.finished.then(() => {
            if (!this.arrivals.has(arrival)) return;
            window.animation.receiveFileInBox(result.files);
            this.updateCount();
        }, () => {}).finally(() => {
            icon.remove();
            this.arrivals.delete(arrival);
        });
    }

    connectionStatus(uid, interrupted) {
        const pending = this.offers.get(uid);
        if (pending?.loading) pending.caption.textContent = interrupted
            ? 'Reconnecting… keeping your progress.'
            : `Receiving from ${pending.offer.sender} · ${Math.round(pending.progress.value * 100)}%`;
        const record = this.batch?.records.get(uid);
        if (record && ['waiting', 'sending', 'reconnecting'].includes(record.state)) {
            let changed = false;
            if (interrupted && record.state !== 'reconnecting') {
                record.previousState = record.state;
                record.state = 'reconnecting';
                changed = true;
            } else if (!interrupted && record.state === 'reconnecting') {
                record.state = record.previousState || 'sending';
                changed = true;
            }
            if (changed) this.batchStatus(this.batch);
        } else if (interrupted) this.status('Reconnecting… keeping your progress for up to 30 seconds.');
    }

    batchStatus(batch) {
        const counts = {};
        for (const record of batch.records.values()) counts[record.state] = (counts[record.state] || 0) + 1;
        const labels = { reconnecting: 'reconnecting', delivered: 'delivered', expired: 'expired', failed: 'unavailable', cancelled: 'cancelled' };
        const summary = Object.entries(labels).filter(([state]) => counts[state]).map(([state, label]) => `${counts[state]} ${label}`).join(', ');
        this.status(summary ? `Sent · ${summary}` : 'Sent');
        document.getElementById('delivery-title').textContent = batch.title;
        this.deliveryPeople.replaceChildren();
        let visible = 0;
        for (const record of batch.records.values()) {
            if (!['sending', 'delivered', 'reconnecting'].includes(record.state) || (record.state === 'reconnecting' && record.previousState === 'waiting')) continue;
            const row = document.createElement('div');
            row.className = 'delivery-person';
            const name = document.createElement('strong');
            name.textContent = record.name;
            const state = document.createElement('span');
            state.textContent = record.state === 'delivered' ? 'Delivered ✓'
                : record.state === 'reconnecting' ? 'Reconnecting…'
                : `Receiving · ${Math.round((record.progress || 0) * 100)}%`;
            row.append(name, state);
            if (record.state !== 'delivered') {
                const progress = document.createElement('progress');
                progress.max = 1;
                progress.value = record.progress || 0;
                progress.setAttribute('aria-label', `${record.name}: receiving`);
                row.append(progress);
            }
            this.deliveryPeople.append(row);
            visible++;
        }
        this.deliveryProgress.hidden = visible === 0;
        if (!batch.revealed && visible) {
            this.deliveryProgress.open = !window.matchMedia('(max-width: 600px)').matches;
            batch.revealed = true;
        }
    }

    async send(content) {
        if (this.busy || !this.connection.active) return;
        const targets = this.connection.nearbyPeers();
        if (!targets.length) return this.status('No nearby devices right now. Try again when someone appears.');
        const sender = window.parachuteProfile?.displayName || 'Someone nearby';
        try { window.ParachuteTransfer.offerFor({ ...content, sender }); }
        catch (error) { this.status(error.message); return; }
        const batch = { title: ParachuteSharing.deliveryTitle(content), records: new Map(targets.map(uid => [uid, { state: 'waiting', name: this.connection.devices?.get(uid)?.name || 'Nearby person', progress: 0 }])), cancelled: false };
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
        this.shareFiles.value = this.shareLink.value = this.parachuteTitle.value = '';
        this.selectedFiles = [];
        this.renderSelectedFiles();
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
        const entry = { title: ParachuteSharing.deliveryTitle(result), sender: result.sender, bytes: result.files.reduce((sum, file) => sum + file.size, 0), urls: [], items: [], node: document.createElement('article') };
        entry.node.className = 'received-entry';
        entry.node.dataset.parachuteColor = result.color || 'coral';
        const header = document.createElement('div');
        header.className = 'received-heading';
        const sender = document.createElement('h3');
        sender.textContent = entry.title;
        const byline = document.createElement('p');
        byline.className = 'delivery-byline';
        byline.textContent = `From ${result.sender}`;
        const heading = document.createElement('div');
        heading.append(sender, byline);
        const badge = document.createElement('span');
        badge.className = 'new-delivery';
        badge.textContent = 'New';
        entry.badge = badge;
        const time = document.createElement('time');
        const now = new Date();
        time.dateTime = now.toISOString();
        time.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        time.title = now.toLocaleString();
        header.append(heading, badge, time);
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
            const row = document.createElement('div');
            row.className = 'received-item';
            const link = document.createElement('a');
            link.className = 'download-action';
            const isLink = typeof item === 'string';
            const name = isLink ? item : item.name;
            const type = isLink ? 'link' : window.ParachuteAnimation.typeOf(item);
            const art = this.artwork(type);
            row.append(art);
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
                    row.append(thumbnail);
                }
            }
            const text = document.createElement('span');
            text.className = 'received-item-text';
            const title = document.createElement('strong');
            const meta = document.createElement('small');
            meta.textContent = isLink ? new URL(item).hostname : ParachuteSharing.size(item.size);
            text.append(title, meta);
            row.append(text);
            const actions = document.createElement('div');
            actions.className = 'file-actions';
            if (!isLink) {
                const preview = document.createElement('button');
                preview.type = 'button';
                preview.className = 'preview-action';
                preview.textContent = 'Preview';
                preview.setAttribute('aria-label', `Preview ${name}`);
                preview.addEventListener('click', () => { entry.badge.hidden = true; void this.preview(item, link.href, entry); });
                actions.append(preview);
            }
            link.textContent = isLink ? 'Open link ↗' : 'Download';
            link.addEventListener('click', () => { entry.badge.hidden = true; });
            actions.append(link);
            row.append(actions);
            let group = this.receivedNames.get(name);
            if (!group) this.receivedNames.set(name, group = { next: 1, numbered: false, items: new Set() });
            const record = { name, group, number: group.next++, title, link, row, sender: result.sender, isLink };
            group.items.add(record);
            if (group.items.size > 1) group.numbered = true;
            for (const other of group.items) {
                const label = `${other.name}${group.numbered ? ` #${other.number}` : ''}`;
                other.title.textContent = label;
                other.link.setAttribute('aria-label', `${other.isLink ? 'Open' : 'Download'} ${label}, from ${other.sender}`);
            }
            entry.items.push(record);
            contents.append(row);
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
        if (this.previewEntry === entry) { this.previewDialog.close(); this.clearPreview(); }
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
        const hadIncoming = this.offers.has(uid);
        const transport = this.transports.get(uid);
        this.transports.delete(uid);
        // Withdraw the offer first; transport.close() also invokes onOffer(null).
        // Its remaining DOM is only a disabled falling visual, never a catchable offer.
        this.clearOffer(uid, 'disconnected');
        transport?.close();
        if (hadIncoming && !this.batch) {
            this.status('The sender is no longer available. Its unfinished delivery was removed.');
            window.ParachuteAnimation.announce?.('The sender disconnected. Delivery removed.');
        }
        this.sync();
    }

    reset() {
        for (const arrival of this.arrivals) {
            arrival.flight.cancel();
            arrival.icon.remove();
        }
        this.arrivals.clear();
        for (const uid of [...this.transports.keys()]) this.closePeer(uid);
        this.batch = null;
        this.busy = false;
        this.sync();
    }
}
window.parachuteSharing = new ParachuteSharing(window.parachuteConnection);
