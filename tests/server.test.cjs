const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createParachuteServer } = require('../server.cjs');

async function setup(t, options) {
    const server = createParachuteServer(options);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => server.shutdown());
    return `http://127.0.0.1:${server.address().port}`;
}

test('serves nearby discovery and sharing without loading PeerJS in the app', async (t) => {
    const url = await setup(t);
    const html = await (await fetch(url)).text();
    assert.match(html, /Nearby devices/);
    assert.match(html, /welcome-status/);
    assert.doesNotMatch(
        html,
        /Your page ID|remote-peer-id|vendor\/peerjs/i
    );
    for (const file of [
        'style.css',
        'background.css',
        'parachute.js',
        'connection.js',
        'welcome.js',
        'transfer.js',
        'sharing.js',
        'vendor/peerjs.min.js',
        'peerjs-test.html'
    ]) {
        const response = await fetch(`${url}/${file}`);
        assert.equal(response.status, 200, file);
        if (file.endsWith('.js'))
            assert.match(response.headers.get('content-type'), /javascript/);
    }
    const head = await fetch(url, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
});

test('hosted modules load live with relative imports and use the upstream default server', async (t) => {
    let requests = 0;
    const url = await setup(t, { fetchMesh: async (upstream) => {
        requests++;
        assert.equal(upstream.origin, 'https://21beckem.github.io');
        return new Response("import './geo.js';\nconst isHostedLocally = /localhost/.test(window.location.hostname);\nconst url = isHostedLocally ? 'ws://localhost:8787' : 'wss://upstream.example';");
    } });
    const endpoint = `${url}/mesh-runtime/durable-object-server/mesh/mesh-client.js`;
    const response = await fetch(endpoint);
    const module = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /javascript/);
    assert.match(module, /import '\.\/geo.js'/);
    assert.match(module, /const isHostedLocally = false;/);
    assert.match(module, /wss:\/\/upstream.example/);
    await fetch(endpoint);
    assert.equal(requests, 1, 'short memory cache avoids repeatedly loading the same resource');
    const wasm = await fetch(`${url}/mesh-runtime/web-calibration/wasm_parity/wasm/same_room.wasm`);
    assert.equal(wasm.headers.get('content-type'), 'application/wasm');
    assert.equal((await fetch(`${url}/mesh-runtime/.git/config`)).status, 404);
    assert.equal((await fetch(endpoint, { method: 'POST' })).status, 404);
});

test('unavailable hosted assets report a gateway error instead of serving broken JavaScript', async (t) => {
    const url = await setup(t, { fetchMesh: async () => new Response('offline', { status: 503 }) });
    assert.equal((await fetch(`${url}/mesh-runtime/exports/compare/compare.js`)).status, 502);
});

test('old relay endpoints and non-public source files are unavailable', async (t) => {
    const url = await setup(t);
    for (const file of [
        'server.cjs',
        'package.json',
        '.git/config',
        'api/session',
        'api/events'
    ]) {
        assert.equal((await fetch(`${url}/${file}`)).status, 404, file);
    }
    for (const endpoint of [
        'session',
        'connect',
        'send',
        'leave',
        'disconnect'
    ]) {
        assert.equal(
            (await fetch(`${url}/api/${endpoint}`, { method: 'POST' })).status,
            404
        );
    }
});
