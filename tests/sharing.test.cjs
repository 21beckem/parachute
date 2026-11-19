const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, deferred, flush } = require('./helpers/mesh-app.cjs');

test('metadata reaches every peer before reads; a caught slow file shows progress then flies into the box', async t => {
    const { client, start, match } = setup(t);
    const arrival = deferred(), lastChunk = deferred();
    const a = client(1), b = client(2, { arrival }), c = client(3);
    for (const app of [a, b, c]) await start(app);
    match(a, b); match(a, c); await flush();
    let reads = 0;
    const file = { name: 'large.bin', type: 'application/octet-stream', size: 131072,
        slice(start, end) { return { async arrayBuffer() {
            reads++;
            if (start) await lastChunk.promise;
            return new Uint8Array(end - start).buffer;
        } }; }
    };
    const send = a.sharing.send({ files: [file] }); await flush();
    assert.equal(reads, 0);
    assert.equal(b.deliveries.size, 1); assert.equal(c.deliveries.size, 1);
    b.catchOffer(1); await flush();
    const pending = b.sharing.offers.get(1);
    assert.equal(pending.progress.value, .5);
    assert.equal(a.sharing.deliveryPeople.children[0].children[1].textContent, 'Receiving · 50%');
    assert.match(pending.caption.textContent, /50%/);
    assert.equal(b.sharing.entries.size, 0);
    assert.equal(c.sharing.offers.get(1).accepted, false);
    c.missOffer(1); lastChunk.resolve(); await send; await flush();
    assert.equal(pending.loading.removed, true);
    assert.equal(b.sharing.entries.size, 1);
    assert.equal(b.sharing.arrivals.size, 1, 'the big completed icon is animating');
    assert.equal(b.receipts.length, 0, 'box receipt waits for the completed-icon flight');
    arrival.resolve(); await flush();
    assert.equal(b.sharing.arrivals.size, 0);
    assert.equal(b.receipts.length, 1);
    assert.equal(a.mesh.calls.some(call => call.type === 'binary' && call.to === 3), false);
});

test('sender departure removes all uncaught parachutes without waiting for offer expiry', async t => {
    const { client, start, match } = setup(t);
    const a = client(1), b = client(2), c = client(3);
    for (const app of [a, b, c]) await start(app);
    match(a, b); match(a, c); await flush();
    const send = a.sharing.send({ files: [new File(['bytes'], 'file.txt')] }); await flush();
    a.c.stopDiscovery();
    a.c.destroy(); // A subsequent pagehide must not interrupt the departure notices.
    await flush(); await send;
    assert.equal(a.reloads, 1);
    assert.equal(a.mesh.calls.filter(call => call.msg?.type === 'parachute:leaving:v1').length, 2);
    for (const app of [b, c]) {
        assert.equal(app.sharing.offers.size, 0);
        assert.equal([...app.deliveries].every(delivery => delivery.unavailable), true, 'only disabled falling visuals remain');
        assert.equal(app.sharing.entries.size, 0);
    }
});

test('silent sender loss is detected even while the nearby list is stale', async t => {
    const { client, start, match } = setup(t);
    const a = client(1), b = client(2);
    await start(a); await start(b); match(a, b); await flush();
    const send = a.sharing.send({ url: 'https://example.com' }); await flush();
    const delivery = b.sharing.offers.get(1).delivery;
    a.mesh.connected = false;
    await b.advance(2000);
    assert.equal(b.mesh.peers.includes(1), true, 'no detector peerRemoved event was needed');
    assert.equal(b.sharing.offers.size, 1, 'brief outages retain the offer');
    await b.advance(30000);
    assert.equal(b.sharing.offers.size, 0);
    assert.equal(delivery.unavailable, true);
    delivery.options.onCatch();
    assert.equal(b.sharing.entries.size, 0);
    a.sharing.cancel(); await send;
});

test('lost reachability during a partial file clears its loading indicator and never saves incomplete bytes', async t => {
    const { client, start, match } = setup(t);
    const a = client(1), b = client(2), hold = deferred();
    await start(a); await start(b); match(a, b); await flush();
    const send = a.sharing.send({ files: [{ name: 'partial.bin', type: '', size: 131072,
        slice(start, end) { return { async arrayBuffer() { if (start) await hold.promise; return new Uint8Array(end - start).buffer; } }; }
    }] }); await flush();
    b.catchOffer(1); await flush();
    const loading = b.sharing.offers.get(1).loading;
    const relay = b.mesh.relayMessage.bind(b.mesh);
    b.mesh.relayMessage = (to, msg) => msg.type === 'parachute:transfer-check:v1' ? new Promise(() => {}) : relay(to, msg);
    await b.advance(2000); await b.advance(3000);
    assert.notEqual(loading.removed, true, 'a missed check keeps partial bytes');
    await b.advance(30000); await b.advance(3000);
    assert.equal(loading.removed, true);
    assert.equal(b.sharing.offers.size, 0);
    assert.equal(b.sharing.entries.size, 0);
    assert.equal(b.sharing.arrivals.size, 0);
    a.sharing.cancel(); hold.resolve(); await send;
});

test('received packages use box artwork and duplicate names keep distinct labels and original downloads', t => {
    const { client } = setup(t);
    const app = client(1);
    app.sharing.delivered({ sender: 'Sam', kind: 'files', files: [new File(['a'], 'notes.txt'), new File(['b'], 'other.txt')] });
    app.sharing.delivered({ sender: 'Spencer', kind: 'files', files: [new File(['c'], 'notes.txt')] });
    const [first, second] = [...app.sharing.entries];
    const packageNode = first.node.children[1];
    assert.equal(packageNode.className, 'received-package');
    assert.equal(packageNode.children[0].children[0].children[0].href, '#payload-other');
    assert.equal(packageNode.children[1].children.length, 2);
    assert.equal(first.items[0].title.textContent, 'notes.txt #1');
    assert.equal(second.items[0].title.textContent, 'notes.txt #2');
    assert.equal(second.items[0].link.download, 'notes.txt');
    assert.match(second.items[0].link['aria-label'], /from Spencer/);
    app.sharing.remove(first);
    assert.equal(second.items[0].title.textContent, 'notes.txt #2', 'removing an earlier copy does not renumber remaining files');
    app.sharing.remove(second);
    assert.equal(app.sharing.receivedNames.size, 0);
});

test('photo previews share the download URL and fall back to artwork when an image cannot load', t => {
    const { client } = setup(t);
    const app = client(1);
    app.window.ParachuteAnimation.typeOf = () => 'picture';
    app.sharing.delivered({ sender: 'Sam', kind: 'files', files: [new File(['image bytes'], 'photo.heic', { type: 'image/heic' })] });
    const entry = [...app.sharing.entries][0];
    const link = entry.items[0].link;
    const [art, thumbnail] = entry.items[0].row.children;
    assert.equal(thumbnail.src, link.href);
    assert.equal(link.download, 'photo.heic');
    thumbnail.listeners.load();
    assert.equal(art.hidden, '');
    thumbnail.listeners.error();
    assert.equal(art.hidden, undefined);
    assert.equal(thumbnail.hidden, true);
    assert.equal(entry.urls.length, 1, 'preview and download share a single revocable URL');
});

test('one send offers to all current nearby peers; catches and expirations are independent', async t => {
    const { client, start, match } = setup(t);
    const a = client(1), b = client(2), c = client(3), later = client(4);
    for (const [app, name] of [[a, 'A'], [b, 'B'], [c, 'C'], [later, 'Later']]) await start(app, name);
    match(a, b); match(a, c); await flush();
    let reads = 0;
    const bytes = Uint8Array.from({ length: 140001 }, (_, i) => i % 251);
    const file = { name: 'broadcast.bin', size: bytes.length, type: 'application/octet-stream',
        slice(start, end) { return { async arrayBuffer() { reads++; return bytes.slice(start, end).buffer; } }; } };
    const flight = a.sharing.send({ files: [file] }); await flush();
    match(a, later); await flush();
    assert.equal(b.sharing.offers.size, 1);
    assert.equal(c.sharing.offers.size, 1);
    assert.equal(later.sharing.offers.size, 0, 'a later arrival is outside the send snapshot');
    assert.equal(reads, 0, 'no file is read until a box catch');
    assert.equal(a.mesh.calls.filter(call => call.type === 'binary').length, 0);
    assert.equal(b.sharing.entries.size, 0);
    assert.equal(b.nodes.has('incoming-dialog'), false, 'there is no Accept popup');
    assert.equal(a.launches, 1, 'one send animation for the whole offer');
    const expiredDelivery = c.sharing.offers.get(1).delivery;
    c.missOffer(1);
    b.catchOffer(1);
    await flight;
    assert.equal(c.sharing.entries.size, 0);
    assert.equal(c.sharing.offers.size, 0);
    assert.equal(b.sharing.entries.size, 1);
    assert.equal(b.deliveries.size, 0, 'there is no second parachute to catch after downloading');
    assert.equal(b.element('received-dialog').open, false, 'completion does not block other falling offers with a modal');
    const href = [...b.sharing.entries][0].items[0].link.href;
    assert.deepEqual(new Uint8Array(await (await fetch(href)).arrayBuffer()), bytes);
    assert.match(a.element('transfer-status').textContent, /Sent · 1 delivered, 1 expired/);
    assert.equal(a.mesh.calls.some(call => call.type === 'binary' && call.to === 3), false);
    expiredDelivery.options.onCatch(); await flush();
    assert.equal(c.sharing.entries.size, 0, 'a late catch cannot revive an expired offer');
});

test('an ignored or paused offer expires after 60 seconds without transferring bytes', async t => {
    const { client, start, match } = setup(t);
    const a = client(1), b = client(2);
    await start(a, 'A'); await start(b, 'B'); match(a, b); await flush();
    const flight = a.sharing.send({ files: [new File(['private bytes'], 'notes.txt')] }); await flush();
    const oldDelivery = b.sharing.offers.get(1).delivery;
    await b.advance(60000); await flight;
    assert.equal(oldDelivery.disposed, true);
    assert.equal(b.sharing.entries.size, 0);
    assert.equal(a.mesh.calls.some(call => call.type === 'binary'), false);
    assert.equal(a.sharing.busy, false);
    assert.match(a.element('transfer-status').textContent, /1 expired/);
});

test('simultaneous file and link sends in opposite directions wait for their own box catches', async t => {
    const { client, start, match } = setup(t);
    const a = client(1), b = client(2);
    await start(a, 'A'); await start(b, 'B'); match(a, b); await flush();
    const files = a.sharing.send({ files: [new File(['contents'], 'a.txt')] });
    const link = b.sharing.send({ url: 'https://example.com/box-link' }); await flush();
    assert.equal(a.sharing.entries.size, 0); assert.equal(b.sharing.entries.size, 0);
    a.catchOffer(2); await link;
    assert.equal([...a.sharing.entries][0].items[0].link.href, 'https://example.com/box-link');
    assert.equal(b.sharing.entries.size, 0);
    b.catchOffer(1); await files;
    assert.equal(b.sharing.entries.size, 1);
});

test('multiple incoming offers reserve memory independently when caught', async t => {
    const { client, start, match } = setup(t);
    const a = client(1), b = client(2), c = client(3);
    await start(a, 'A'); await start(b, 'B'); await start(c, 'C');
    match(a, b); match(a, c); await flush();
    const read = deferred();
    const file = { name: 'large.bin', size: 60 * 1024 * 1024, type: '', slice: () => ({ arrayBuffer: () => read.promise }) };
    const first = b.sharing.send({ files: [file] });
    const second = c.sharing.send({ files: [file] }); await flush();
    assert.equal(a.sharing.offers.size, 2);
    a.catchOffer(2); a.catchOffer(3); await flush();
    assert.equal(a.sharing.offers.get(2).accepted, true);
    assert.equal(a.sharing.offers.has(3), false, 'two 60 MB catches must not exceed the 100 MB retained budget');
    await second;
    b.sharing.cancel(); read.resolve(new ArrayBuffer(1)); await first; await flush();
    assert.equal(a.sharing.entries.size, 0);
    assert.equal(a.sharing.offers.size, 0);
});

test('cancel send expires all outstanding parachutes without cancelling unrelated incoming work', async t => {
    const { client, start, match } = setup(t);
    const a = client(1), b = client(2), c = client(3);
    await start(a, 'A'); await start(b, 'B'); await start(c, 'C');
    match(a, b); match(a, c); await flush();
    const flight = a.sharing.send({ files: [new File(['test'], 'cancel.txt')] }); await flush();
    const incoming = b.sharing.send({ url: 'https://example.com/independent-incoming' }); await flush();
    a.sharing.cancel(); await flight; await flush();
    assert.equal(b.sharing.offers.size, 0); assert.equal(c.sharing.offers.size, 0);
    assert.equal(a.mesh.calls.some(call => call.type === 'binary'), false);
    assert.match(a.element('transfer-status').textContent, /2 cancelled/);
    assert.equal(a.sharing.offers.has(2), true);
    a.catchOffer(2); await incoming;
    assert.equal(a.sharing.entries.size, 1);
});

test('invalid content does not broadcast or close the send form', async t => {
    const { client, start, match } = setup(t);
    const a = client(1), b = client(2);
    await start(a, 'A'); await start(b, 'B'); match(a, b); await flush();
    a.sharing.open();
    await a.sharing.send({ url: 'javascript:alert(1)' });
    assert.equal(a.element('share-dialog').open, true);
    assert.equal(a.sharing.busy, false);
    assert.equal(b.sharing.offers.size, 0);
});


test('custom delivery titles survive the relay without renaming original files', async t => {
    const { client, start, match } = setup(t);
    const a = client(1), b = client(2);
    await start(a, 'Spencer'); await start(b, 'Emma'); match(a, b); await flush();
    const flight = a.sharing.send({ title: 'Weekend memories', files: [new File(['photo'], 'IMG_1234.jpg')] });
    await flush();
    assert.equal(b.sharing.offers.get(1).offer.title, 'Weekend memories');
    assert.match(b.sharing.offers.get(1).delivery.element.children[0].title, /Weekend memories.*From Spencer/);
    assert.equal(a.sharing.deliveryPeople.children.length, 0, 'waiting recipients stay out of the progress list');
    b.catchOffer(1); await flight;
    const entry = [...b.sharing.entries][0];
    assert.equal(entry.title, 'Weekend memories');
    assert.equal(entry.sender, 'Spencer');
    assert.equal(entry.items[0].link.download, 'IMG_1234.jpg');
    const row = a.sharing.deliveryPeople.children[0];
    assert.equal(row.children[0].textContent, 'Emma');
    assert.equal(row.children[1].textContent, 'Delivered ✓');
});

test('preview shows text literally, falls back for documents, and clears on removal', async t => {
    const { client } = setup(t);
    const app = client(1);
    const file = new File(['<script>alert(1)</script>'], 'notes.txt', { type: 'text/plain' });
    app.sharing.delivered({ title: 'Notes', sender: 'Sam', kind: 'files', files: [file] });
    const entry = [...app.sharing.entries][0];
    const url = entry.items[0].link.href;
    await app.sharing.preview(file, url, entry);
    assert.equal(app.element('preview-content').children[0].textContent, '<script>alert(1)</script>');
    assert.equal(app.element('preview-download').download, 'notes.txt');
    const doc = new File(['document'], 'report.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    await app.sharing.preview(doc, url, entry);
    assert.match(app.element('preview-content').children[0].textContent, /Preview unavailable/);
    app.sharing.remove(entry);
    assert.equal(app.element('preview-dialog').open, false);
    assert.equal(app.element('preview-content').children.length, 0);
    assert.equal(app.element('preview-download').href, undefined);
});

test('late text preview cannot replace a newer preview or revive a closed one', async t => {
    const { client } = setup(t);
    const app = client(1), read = deferred();
    const file = { name: 'slow.txt', type: 'text/plain', size: 10, text: () => read.promise };
    const entry = { title: 'Notes', sender: 'Sam' };
    const preview = app.sharing.preview(file, 'blob:slow', entry);
    app.sharing.clearPreview();
    read.resolve('late text'); await preview;
    assert.equal(app.element('preview-content').children.length, 0);
});

test('selection validates the total and removed files are absent from the launch', t => {
    const { client } = setup(t);
    const app = client(1);
    app.sharing.addFiles([new File(['a'], 'a.txt'), new File(['b'], 'b.txt')]);
    assert.equal(app.sharing.selectedFiles.length, 2);
    app.sharing.selectedFiles.splice(0, 1);
    app.sharing.renderSelectedFiles();
    assert.equal(app.sharing.selectedList.children.length, 1);
    app.sharing.addFiles([{ name: 'huge.bin', type: '', size: 101 * 1024 * 1024 }]);
    assert.equal(app.sharing.selectedFiles.length, 1);
    let sent;
    app.sharing.send = content => { sent = content; };
    app.element('parachute-title').value = 'Homework';
    app.element('share-files-form').listeners.submit({preventDefault() {}});
    assert.equal(sent.title, 'Homework');
    assert.equal(sent.files[0].name, 'b.txt');
});


test('selected parachute colors and structured tags reach each recipient', async t => {
    const {client, start, match} = setup(t);
    const a = client(1), b = client(2);
    await start(a, 'Spencer'); await start(b, 'Emma'); match(a,b); await flush();
    a.element('color-sky').checked = true;
    a.element('color-sky').listeners.change();
    a.sharing.addFiles([new File(['notes'], 'notes.txt')]);
    a.element('parachute-title').value = 'Study notes';
    let flight;
    const send = a.sharing.send.bind(a.sharing);
    a.sharing.send = content => flight = send(content);
    a.element('share-files-form').listeners.submit({preventDefault() {}});
    await flush();
    const pending = b.sharing.offers.get(1);
    assert.equal(pending.offer.color, 'sky');
    assert.equal(pending.delivery.element.dataset.parachuteColor, 'sky');
    const tag = pending.delivery.element.children[0];
    assert.equal(tag.children[0].textContent, 'Study notes');
    assert.equal(tag.children[1].textContent, 'From Spencer');
    assert.equal(tag.children[2].textContent, '1 file · 5 B');
    b.catchOffer(1); await flight;
    assert.equal([...b.sharing.entries][0].node.dataset.parachuteColor, 'sky');
    assert.equal(a.sharing.parachuteColor, 'sky', 'next delivery keeps the last chosen color');
});


test('blank delivery names use the payload style across sender, offer and Received', async t => {
    const {client,start,match}=setup(t);
    const a=client(1),b=client(2);
    await start(a,'Spencer');await start(b,'Emma');match(a,b);await flush();
    for(const [content,title] of [
        [{files:[new File(['notes'],'really-long-original-filename.txt')],title:'   '},'File'],
        [{url:'https://example.com'},'Link'],
        [{files:[new File(['a'],'a.txt'),new File(['b'],'b.txt')]},'Package']
    ]) {
        const flight=a.sharing.send(content);await flush();
        const offer=b.sharing.offers.get(1);
        assert.equal(offer.delivery.element.children[0].children[0].textContent,title);
        assert.equal(a.element('delivery-title').textContent,title);
        if(title==='Package') assert.equal(offer.type,'other');
        b.catchOffer(1);await flight;
        assert.equal([...b.sharing.entries].at(-1).title,title);
    }
    const titleOf=a.sharing.constructor.deliveryTitle;
    a.window.ParachuteAnimation.typeOf=({type})=>type==='image/png'?'picture':'file';
    assert.equal(titleOf({kind:'files',files:[{name:'any-name.png',mime:'image/png'}]}),'Picture');
    assert.equal(titleOf({title:'My photos',files:[]}), 'My photos');
});

test('selected file pages preserve every file and remove the correct file on later pages', t => {
    const { client } = setup(t);
    const app = client(1);
    app.sharing.addFiles(['a', 'b', 'c', 'd', 'e'].map(name => new File([name], `${name}.txt`)));
    const list = app.sharing.selectedList;
    list.querySelector = () => null;
    assert.equal(list.children.length, 4, 'three files and page controls');
    list.children.at(-1).children.at(-1).listeners.click();
    assert.equal(app.sharing.selectionPage, 1);
    assert.equal(list.children.length, 3, 'two remaining files and page controls');
    list.children[0].children.at(-1).listeners.click();
    assert.equal(app.sharing.selectedFiles.map(file => file.name).join(','), 'a.txt,b.txt,c.txt,e.txt');
    list.children[0].children.at(-1).listeners.click();
    assert.equal(app.sharing.selectionPage, 0, 'removing the last page returns to the previous page');
    assert.equal(list.children.length, 3);
});
