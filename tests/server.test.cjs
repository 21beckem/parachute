const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createParachuteServer } = require('../server.cjs');

async function setup(t) {
    const server = createParachuteServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => server.shutdown());
    return `http://127.0.0.1:${server.address().port}`;
}

test('serves the PeerJS page-ID app and its local assets', async (t) => {
    const url = await setup(t);
    const html = await (await fetch(url)).text();
    assert.match(html, /Your page ID/);
    assert.doesNotMatch(
        html,
        /room code|Join room|8-character|maxlength="12"/i
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
