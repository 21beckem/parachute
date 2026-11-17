const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, flush } = require('./helpers/mesh-app.cjs');

test('an interrupted ten-chunk delivery retries missing data while keeping the first 80 percent', async t => {
    const { client, start, match } = setup(t);
    const a = client(1), b = client(2);
    await start(a); await start(b); match(a, b); await flush();
    const size = a.window.ParachuteTransfer.CHUNK_BYTES;
    const bytes = Uint8Array.from({ length: size * 10 }, (_, i) => i % 251);
    const relay = a.mesh.relay.bind(a.mesh);
    let interrupted = true;
    a.mesh.relay = (to, data, options) => {
        if (interrupted && options.meta.sequence >= 8) return Promise.reject(Error('temporary network interruption'));
        return relay(to, data, options);
    };
    const delivery = a.sharing.send({ files: [new File([bytes], 'resume.bin')] }); await flush();
    b.catchOffer(1); await flush();
    assert.equal(b.sharing.offers.get(1).progress.value, .8);
    assert.equal(b.sharing.transports.get(1).incoming.received, size * 8);
    assert.match(a.element('transfer-status').textContent, /reconnecting/);
    interrupted = false;
    await a.advance(3000); await delivery;
    assert.equal(b.sharing.entries.size, 1);
    const url = [...b.sharing.entries][0].items[0].link.href;
    assert.deepEqual(new Uint8Array(await (await fetch(url)).arrayBuffer()), bytes);
    for (let sequence = 0; sequence < 8; sequence++) {
        assert.equal(a.mesh.calls.filter(call => call.type === 'binary' && call.options.meta.sequence === sequence).length, 1);
    }
});

test('lost chunk and completion acknowledgments never duplicate bytes or Received packages', async t => {
    const { client, start, match } = setup(t);
    const a = client(1), b = client(2);
    await start(a); await start(b); match(a, b); await flush();
    const relay = b.mesh.relayMessage.bind(b.mesh);
    let loseChunkAck = true, loseComplete = true;
    b.mesh.relayMessage = (to, msg) => {
        if (msg.type === 'chunk-received' && msg.sequence === 2 && loseChunkAck) return Promise.resolve();
        if (msg.type === 'complete' && loseComplete) return Promise.resolve();
        return relay(to, msg);
    };
    const bytes = new Uint8Array(a.window.ParachuteTransfer.CHUNK_BYTES * 3).fill(42);
    const delivery = a.sharing.send({ files: [new File([bytes], 'ack.bin')] }); await flush();
    b.catchOffer(1); await flush();
    assert.equal(b.sharing.transports.get(1).incoming.received, bytes.length);
    loseChunkAck = false; await a.advance(3000);
    assert.equal(b.sharing.entries.size, 1);
    assert.equal(a.sharing.busy, true, 'the sender still waits for completion confirmation');
    loseComplete = false; await a.advance(3000); await delivery;
    assert.equal(b.sharing.entries.size, 1);
    const url = [...b.sharing.entries][0].items[0].link.href;
    assert.deepEqual(new Uint8Array(await (await fetch(url)).arrayBuffer()), bytes);
});

test('a bounded window of eight chunks tolerates reversed relay arrival order', async t => {
    const { client, start, match } = setup(t);
    const a = client(1), b = client(2);
    await start(a); await start(b); match(a, b); await flush();
    const relay = a.mesh.relay.bind(a.mesh);
    const held = [];
    a.mesh.relay = (to, data, options) => {
        if (options.meta.sequence >= 8) return relay(to, data, options);
        return new Promise((resolve, reject) => {
            held.push({ to, data, options, resolve, reject });
            if (held.length === 8) for (const packet of [...held].reverse())
                relay(packet.to, packet.data, packet.options).then(packet.resolve, packet.reject);
        });
    };
    const size = a.window.ParachuteTransfer.CHUNK_BYTES;
    const bytes = Uint8Array.from({ length: size * 9 + 5 }, (_, i) => i % 239);
    const delivery = a.sharing.send({ files: [new File([bytes], 'ordered.bin')] }); await flush();
    b.catchOffer(1); await delivery;
    assert.equal(held.length, 8, 'eight chunks start before the first app acknowledgment');
    const url = [...b.sharing.entries][0].items[0].link.href;
    assert.deepEqual(new Uint8Array(await (await fetch(url)).arrayBuffer()), bytes);
});

test('a lost acceptance reply retries the same offer without a second catch or file read', async t => {
    const { client, start, match } = setup(t);
    const a = client(1), b = client(2);
    await start(a); await start(b); match(a, b); await flush();
    const relay = b.mesh.relayMessage.bind(b.mesh);
    let loseAccept = true;
    b.mesh.relayMessage = (to, msg) => msg.type === 'accept' && loseAccept ? Promise.resolve() : relay(to, msg);
    const delivery = a.sharing.send({ files: [new File(['after approval'], 'consent.txt')] }); await flush();
    b.catchOffer(1); await flush();
    assert.equal(a.mesh.calls.some(call => call.type === 'binary'), false);
    loseAccept = false; await a.advance(3000); await delivery;
    assert.equal(b.sharing.entries.size, 1);
    assert.equal(b.deliveries.size, 0);
});

test('a lost decline reply cannot revive a missed offer on retry', async t => {
    const { client, start, match } = setup(t);
    const a = client(1), b = client(2);
    await start(a); await start(b); match(a, b); await flush();
    const relay = b.mesh.relayMessage.bind(b.mesh);
    let loseDecline = true;
    b.mesh.relayMessage = (to, msg) => msg.type === 'decline' && loseDecline ? Promise.resolve() : relay(to, msg);
    const delivery = a.sharing.send({ url: 'https://example.com' }); await flush();
    b.missOffer(1); await flush();
    loseDecline = false; await a.advance(3000); await delivery;
    assert.equal(b.sharing.offers.size, 0);
    assert.equal(b.sharing.entries.size, 0);
    assert.match(a.element('transfer-status').textContent, /expired/);
});

test('acceptance can be retried after discovery expires without rejecting the existing offer', async t => {
    const { client, start, match, unmatch } = setup(t);
    const a = client(1), b = client(2);
    await start(a); await start(b); match(a, b); await flush();
    const relay = b.mesh.relayMessage.bind(b.mesh);
    let loseAccept = true;
    b.mesh.relayMessage = (to, msg) => msg.type === 'accept' && loseAccept ? Promise.resolve() : relay(to, msg);
    const delivery = a.sharing.send({ files: [new File(['retained offer'], 'late-accept.txt')] }); await flush();
    unmatch(a, b);
    await a.advance(30000); await b.advance(30000);
    b.catchOffer(1); await flush();
    loseAccept = false;
    await a.advance(3000); await delivery;
    assert.equal(b.sharing.entries.size, 1);
});
