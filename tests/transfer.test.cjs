const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { webcrypto } = require('node:crypto');
const vm = require('node:vm');
const source = readFileSync(
    require('node:path').join(__dirname, '../transfer.js'),
    'utf8'
);
const window = {};
vm.runInNewContext(source, {
    window,
    URL,
    File,
    Blob,
    ArrayBuffer,
    crypto: webcrypto,
    setTimeout,
    clearTimeout
});
const Transfer = window.ParachuteTransfer;
const tick = () => new Promise((resolve) => setImmediate(resolve));

function pair(t, autoAccept = true) {
    const resultsA = [],
        resultsB = [],
        packetsA = [],
        packetsB = [];
    let a, b;
    const ca = {
        open: true,
        send: (data) => {
            packetsA.push(data);
            setImmediate(() => b.receive(structuredClone(data)));
        }
    };
    const cb = {
        open: true,
        send: (data) => {
            packetsB.push(data);
            setImmediate(() => a.receive(structuredClone(data)));
        }
    };
    a = new Transfer(ca, {
        onOffer: (offer) => {
            if (offer && autoAccept) a.accept();
        },
        onComplete: (result) => resultsA.push(result)
    });
    b = new Transfer(cb, {
        onOffer: (offer) => {
            if (offer && autoAccept) b.accept();
        },
        onComplete: (result) => resultsB.push(result)
    });
    t.after(() => {
        a.close();
        b.close();
    });
    return { a, b, resultsA, resultsB, packetsA, packetsB };
}

test('multiple binary files and an empty file arrive byte for byte after consent', async (t) => {
    const { a, resultsB, packetsA } = pair(t);
    const bytes = Uint8Array.from(
        { length: Transfer.CHUNK_BYTES * 2 + 31 },
        (_, i) => i % 256
    );
    const files = [
        new File([bytes], 'video.mp4', { type: 'video/mp4' }),
        new File(['hello'], 'notes.txt'),
        new File([], 'empty.zip')
    ];
    let launches = 0;
    await a.send({ files, sender: 'Spencer' }, async () => {
        launches++;
        return true;
    });
    assert.equal(launches, 1);
    assert.equal(resultsB.length, 1);
    assert.equal(resultsB[0].sender, 'Spencer');
    assert.equal(resultsB[0].files[0].type, 'video/mp4');
    for (let i = 0; i < files.length; i++) {
        assert.equal(resultsB[0].files[i].name, files[i].name);
        assert.deepEqual(
            await resultsB[0].files[i].arrayBuffer(),
            await files[i].arrayBuffer()
        );
    }
    assert.equal(
        packetsA.filter((packet) => packet.type === 'chunk').length,
        4
    );
    assert.equal(a.outgoing, null);
});

test('links travel both ways and unsafe URL schemes and credentials are rejected', async (t) => {
    const { a, b, resultsA, resultsB } = pair(t);
    await Promise.all([
        a.send({ url: 'https://example.com/path?q=hello', sender: 'A' }),
        b.send({ url: 'https://example.org/', sender: 'B' })
    ]);
    assert.equal(resultsB[0].url, 'https://example.com/path?q=hello');
    assert.equal(resultsA[0].url, 'https://example.org/');
    for (const url of [
        'javascript:alert(1)',
        'data:text/html,hi',
        'file:///secret',
        'https://user:password@example.com/'
    ]) {
        await assert.rejects(a.send({ url }), /http|address/);
    }
});

test('no file bytes or rocket launch occur before acceptance; decline permits retry', async (t) => {
    const { a, b, packetsA, resultsB } = pair(t, false);
    let launched = false;
    const flight = a.send(
        { files: [new File(['secret'], 'notes.txt')] },
        async () => {
            launched = true;
            return true;
        }
    );
    const failure = assert.rejects(flight, /declined/);
    await tick();
    assert.equal(launched, false);
    assert.deepEqual(
        packetsA.map((packet) => packet.type),
        ['offer']
    );
    b.decline();
    await failure;
    assert.equal(resultsB.length, 0);
    b.hooks.onOffer = (offer) => {
        if (offer) b.accept();
    };
    await a.send({ url: 'https://example.com' });
    assert.equal(resultsB.length, 1);
});

test('malformed chunks, oversized manifests and incomplete files never become downloads', (t) => {
    const { b, resultsB } = pair(t, false);
    const offer = {
        version: 2,
        type: 'offer',
        id: 'test',
        sender: 'A',
        kind: 'files',
        files: [{ name: 'a.txt', mime: '', size: 4 }]
    };
    for (const files of [
        [{ name: '../a.txt', mime: '', size: 4 }],
        [{ name: 'big', mime: '', size: Transfer.MAX_BYTES + 1 }],
        Array(21).fill(offer.files[0]),
        [{ name: 'negative', mime: '', size: -1 }]
    ]) {
        b.receive({ ...offer, files });
        assert.equal(b.incoming, null);
    }
    b.receive(offer);
    b.accept();
    b.receive({
        version: 2,
        type: 'chunk',
        id: 'test',
        index: 0,
        offset: 0,
        sequence: 0,
        bytes: new ArrayBuffer(5)
    });
    assert.equal(b.incoming, null);
    b.receive(offer);
    b.accept();
    b.receive({ version: 2, type: 'finish', id: 'test' });
    assert.equal(b.incoming, null);
    assert.equal(resultsB.length, 0);
});

test('disconnect while waiting for consent rejects and releases pending state', async (t) => {
    const { a, b } = pair(t, false);
    const flight = a.send({ url: 'https://example.com/' });
    const failure = assert.rejects(flight, /Connection closed/);
    await tick();
    a.close();
    b.close();
    await failure;
    assert.equal(a.outgoing, null);
    assert.equal(b.incoming, null);
});

test('BinaryPack typed-array chunks respect their byte offset and length', (t) => {
    const { b, resultsB } = pair(t, false);
    b.receive({
        version: 2,
        type: 'offer',
        id: 'typed',
        sender: 'A',
        kind: 'files',
        files: [{ name: 'a.bin', mime: '', size: 3 }]
    });
    b.accept();
    const buffer = new Uint8Array([99, 1, 2, 3, 99]);
    b.receive({
        version: 2,
        type: 'chunk',
        id: 'typed',
        index: 0,
        offset: 0,
        sequence: 0,
        bytes: buffer.subarray(1, 4)
    });
    b.receive({ version: 2, type: 'finish', id: 'typed' });
    assert.equal(resultsB.length, 1);
    return resultsB[0].files[0]
        .arrayBuffer()
        .then((bytes) =>
            assert.deepEqual([...new Uint8Array(bytes)], [1, 2, 3])
        );
});

test('disconnect during file read cannot send stale chunks', async (t) => {
    const { a, b, packetsA } = pair(t);
    let finishRead;
    const file = {
        name: 'test.bin',
        type: '',
        size: 10,
        slice: () => ({
            arrayBuffer: () =>
                new Promise((resolve) => {
                    finishRead = resolve;
                })
        })
    };
    const flight = a.send({ files: [file] });
    const failure = assert.rejects(flight, /cancelled/);
    while (!finishRead) await tick();
    a.close();
    b.close();
    finishRead(new ArrayBuffer(10));
    await failure;
    assert.equal(
        packetsA.some((packet) => packet.type === 'chunk'),
        false
    );
});

test('remote cancellation during launch sends no data and allows another transfer', async (t) => {
    const { a, b, packetsA } = pair(t);
    let finishLaunch;
    const flight = a.send(
        { files: [new File(['test'], 'test.txt')] },
        () =>
            new Promise((resolve) => {
                finishLaunch = resolve;
            })
    );
    const failure = assert.rejects(flight, /cancelled/);
    while (!finishLaunch) await tick();
    b.decline();
    await tick();
    finishLaunch(true);
    await failure;
    assert.equal(
        packetsA.some((packet) => packet.type === 'chunk'),
        false
    );
    await a.send({ url: 'https://example.com/' });
});
