const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createParachuteServer } = require('../server.cjs');

async function setup(t) {
    const server = createParachuteServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => server.shutdown());
    const url = `http://127.0.0.1:${server.address().port}`;
    async function post(action, data = {}, session, headers = {}) {
        const res = await fetch(`${url}/api/${action}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json',
                ...(session ? { Authorization: `Bearer ${session.token}` } : {}), ...headers },
            body: JSON.stringify(data)
        });
        return { status: res.status, data: await res.json() };
    }
    async function client() {
        const { data: session } = await post('session');
        const controller = new AbortController();
        t.after(() => controller.abort());
        const res = await fetch(`${url}/api/events?token=${session.token}`, { signal: controller.signal });
        const reader = res.body.getReader();
        let buffer = '';
        const queue = [];
        async function event() {
            if (queue.length) return queue.shift();
            for (;;) {
                const chunk = await reader.read();
                if (chunk.done) throw new Error('Stream closed');
                buffer += new TextDecoder().decode(chunk.value);
                let end;
                while ((end = buffer.indexOf('\n\n')) !== -1) {
                    const frame = buffer.slice(0, end);
                    buffer = buffer.slice(end + 2);
                    if (frame.startsWith('data: ')) queue.push(JSON.parse(frame.slice(6)));
                }
                if (queue.length) return queue.shift();
            }
        }
        assert.equal((await event()).type, 'ready');
        return { ...session, event, close: () => controller.abort() };
    }
    return { url, post, client };
}

test('independent HTTP clients pair by code, relay both ways, disconnect and reconnect', { timeout: 10000 }, async t => {
    const { post, client } = await setup(t);
    const a = await client(), b = await client();
    assert.match(a.code, /^[A-HJ-NP-Z2-9]{8}$/);
    assert.notEqual(a.code, b.code);
    assert.equal((await post('connect', { code: `${b.code.slice(0, 4)}-${b.code.slice(4)}`.toLowerCase() }, a)).status, 200);
    const pair = await a.event();
    assert.equal(pair.code, b.code);
    assert.deepEqual(await b.event(), { type: 'connected', code: a.code, pairId: pair.pairId });
    assert.equal((await post('send', { type: 'parachute', version: 1, code: b.code, pairId: pair.pairId }, a)).status, 200);
    assert.deepEqual(await b.event(), { type: 'parachute', version: 1 });
    assert.equal((await post('send', { type: 'parachute', version: 1, code: a.code, pairId: pair.pairId }, b)).status, 200);
    assert.deepEqual(await a.event(), { type: 'parachute', version: 1 });
    assert.equal((await post('disconnect', {}, a)).status, 200);
    assert.equal((await a.event()).type, 'disconnected');
    assert.equal((await b.event()).type, 'disconnected');
    assert.equal((await post('send', { type: 'parachute', version: 1, code: b.code }, a)).status, 409);
    assert.equal((await post('connect', { code: a.code }, b)).status, 200);
    assert.equal((await a.event()).type, 'connected');
    assert.equal((await b.event()).type, 'connected');
    assert.equal((await post('send', { type: 'parachute', version: 1, code: b.code, pairId: pair.pairId }, a)).status, 409, 'old pair cannot send after reconnection');
    await post('leave', {}, a);
    assert.equal((await b.event()).type, 'disconnected');
    assert.equal((await post('connect', { code: a.code }, b)).status, 404);
});

test('invalid codes, busy friends, unauthorized requests and file payloads are rejected', { timeout: 10000 }, async t => {
    const { url, post, client } = await setup(t);
    const a = await client(), b = await client(), c = await client();
    assert.equal((await post('connect', { code: a.code }, a)).status, 400);
    assert.equal((await post('connect', { code: 'AAAAAAAA' }, a)).status, 404);
    assert.equal((await post('connect', { code: b.code })).status, 401);
    assert.equal((await post('session', {}, null, { Origin: 'https://elsewhere.example' })).status, 403);
    await post('connect', { code: b.code }, a);
    const { pairId } = await a.event();
    assert.equal((await post('connect', { code: b.code }, c)).status, 409);
    assert.equal((await post('send', { type: 'parachute', version: 1, code: b.code, pairId, files: ['secret.txt'] }, a)).status, 400);
    assert.equal((await post('send', { type: 'file', version: 1, code: b.code, pairId }, a)).status, 400);
    assert.equal((await post('send', { type: 'parachute', version: 1, code: c.code }, a)).status, 409);
    assert.equal((await fetch(`${url}/server.cjs`)).status, 404);
    const html = await (await fetch(url)).text();
    assert.match(html, /<details class="connection-panel">/);
    assert.match(html, /vendor\/peerjs.min.js/);
    const peerjs = await fetch(`${url}/vendor/peerjs.min.js`);
    assert.equal(peerjs.status, 200);
    assert.match(peerjs.headers.get('content-type'), /javascript/);
});

test('simultaneous joins keep a single pair and closing a stream releases the friend', { timeout: 10000 }, async t => {
    const { post, client } = await setup(t);
    const a = await client(), b = await client();
    const results = await Promise.all([post('connect', { code: b.code }, a), post('connect', { code: a.code }, b)]);
    assert.deepEqual(results.map(result => result.status), [200, 200]);
    assert.equal((await a.event()).type, 'connected');
    assert.equal((await b.event()).type, 'connected');
    a.close();
    assert.equal((await b.event()).type, 'disconnected');
});
