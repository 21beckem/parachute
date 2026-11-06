const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, deferred, flush } = require('./helpers/mesh-app.cjs');

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
    const [art, thumbnail] = link.children;
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
    assert.match(a.element('transfer-status').textContent, /2 nearby devices: 1 received, 1 expired/);
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
