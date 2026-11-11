const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, deferred, flush } = require('./helpers/mesh-app.cjs');

test('both permissions must succeed before the five-second window; each sensor is requested once', async t => {
    const { client } = setup(t);
    const audio = deferred(), geo = deferred();
    const a = client(1, { audio, geo });
    await a.c.loading;
    const pending = a.c.begin('A');
    audio.resolve({ getTracks: () => [{ stop() {} }] });
    await a.advance(10000);
    assert.equal(a.events.some(event => event.type === 'discovery-warmup-start'), false);
    geo.resolve({ coords: {} }); await flush();
    assert.equal(a.events.some(event => event.type === 'discovery-scanner-ready'), true);
    assert.equal(a.events.find(event => event.type === 'discovery-warmup-start').at, 10000);
    await a.advance(4999); assert.equal(a.c.active, false);
    await a.advance(1); assert.equal(await pending, true);
    assert.equal(a.permissionCalls.audio, 1);
    assert.equal(a.permissionCalls.location, 1);
});

test('a slow analyzer keeps sharing locked beyond five seconds', async t => {
    const { client } = setup(t);
    const beginResult = deferred();
    const a = client(1, { beginResult });
    await a.c.loading;
    const pending = a.c.begin('A'); await flush();
    assert.equal(a.events.some(event => event.type === 'discovery-scanner-ready'), false);
    await a.advance(8000); assert.equal(a.c.active, false);
    beginResult.resolve({ success: true }); await flush(); await a.advance(0);
    assert.equal(await pending, true);
});

test('location failure restores browser APIs, stops the microphone, and explains the error', async t => {
    const { client } = setup(t);
    const geo = deferred();
    const a = client(1, { geo });
    const audioAPI = a.browserAPIs.mediaDevices.getUserMedia;
    const locationAPI = a.browserAPIs.geolocation.getCurrentPosition;
    const messages = [];
    const pending = a.c.begin('A', message => messages.push(message)); await flush();
    assert.equal(a.permissionCalls.locationOptions.timeout, 30000);
    assert.equal(a.permissionCalls.locationOptions.maximumAge, 60000);
    geo.reject({ code: 3, message: 'Timeout' });
    assert.equal(await pending, false);
    assert.match(messages.at(-1), /Finding your location timed out/);
    assert.equal(a.stopped, 1);
    assert.equal(a.browserAPIs.mediaDevices.getUserMedia, audioAPI);
    assert.equal(a.browserAPIs.geolocation.getCurrentPosition, locationAPI);
});

test('nearby identities are text and sending needs no recipient selection', async t => {
    const { client, start, match } = setup(t);
    const a = client(1), b = client(2);
    await start(a, 'A'); await start(b, '<b>B</b>'); match(a, b); await flush();
    assert.equal(a.c.send.disabled, false);
    assert.equal(a.element('nearby-devices').children[0].children[0].textContent, '<b>B</b>');
    assert.equal(a.c.channels.size, 0);
    a.c.receiveMessage({ from: 99, msg: { version: 2, type: 'offer', id: 'unknown' } });
    assert.equal(a.c.channels.size, 0);
});

test('an active file offer survives a sound-match loss without inventing nearby peers', async t => {
    const { client, start, match, unmatch } = setup(t);
    const a = client(1), b = client(2);
    await start(a, 'A'); await start(b, 'B'); match(a, b); await flush();
    const bytes = Uint8Array.from({ length: 150000 }, (_, i) => i % 251);
    const flight = a.sharing.send({ files: [new File([bytes], 'room-change.bin')] }); await flush();
    unmatch(a, b); await flush();
    assert.equal(a.mesh.peers.length, 0);
    assert.equal(a.c.channels.get(2).open, true);
    assert.equal(b.c.channels.get(1).open, true);
    b.catchOffer(1); await flight;
    const receivedURL = [...b.sharing.entries][0].items[0].link.href;
    assert.deepEqual(new Uint8Array(await (await fetch(receivedURL)).arrayBuffer()), bytes);
    match(a, b); await flush();
    const link = b.sharing.send({ url: 'https://example.com/return' }); await flush();
    a.catchOffer(2); await link;
    assert.equal([...a.sharing.entries][0].items[0].link.href, 'https://example.com/return');
});

test('a genuine relay failure closes only that peer and leaves other recipients working', async t => {
    const { client, start, match } = setup(t);
    const a = client(1), b = client(2), c = client(3);
    await start(a, 'A'); await start(b, 'B'); await start(c, 'C');
    match(a, b); match(a, c); await flush();
    b.mesh.connected = false;
    const flight = a.sharing.send({ url: 'https://example.com/' }); await flush();
    assert.equal(a.c.channels.has(2), false);
    assert.equal(a.c.channels.get(3).open, true);
    c.catchOffer(1); await flight;
    assert.equal(c.sharing.entries.size, 1);
    assert.match(a.element('transfer-status').textContent, /1 received.*1 unavailable/);
});

test('server disconnect during startup never enables sharing', async t => {
    const { client } = setup(t);
    const a = client(1);
    await a.c.loading;
    const pending = a.c.begin('A'); await flush();
    a.mesh.connected = false; a.mesh.emit('disconnected'); await a.advance(5000);
    assert.equal(await pending, false);
    assert.equal(a.c.send.disabled, true);
    a.c.stopDiscovery(); assert.equal(a.reloads, 1);
});
