const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../mesh-loader.js'), 'utf8')
    .replace('import(clientUrl)', 'window.importMesh(clientUrl)');

function loader(baseURI, importMesh) {
    const window = { importMesh, Worker: class { addEventListener() {} } };
    vm.runInNewContext(source, { window, location: new URL(baseURI), document: { baseURI }, URL });
    return window.loadParachuteMesh;
}

test('GitHub Pages imports the hosted detector directly without a Node route', async () => {
    const module = { MeshClient: {} };
    const load = loader('https://21beckem.github.io/parachute/', async (url) => {
        assert.equal(url, 'https://21beckem.github.io/same-room-detector/durable-object-server/mesh/mesh-client.js');
        return module;
    });
    assert.equal(await load(), module);
});

test('a redirected cross-origin audio worker uses a same-origin bootstrap and restores Worker', async () => {
    const blobs = new Map(), revoked = [], workers = [];
    class TestURL extends URL {
        static createObjectURL(blob) { const key = `blob:https://21beckem.github.io/${blobs.size}`; blobs.set(key, blob); return key; }
        static revokeObjectURL(key) { revoked.push(key); }
    }
    class NativeWorker {
        constructor(url, options) { this.url = url; this.options = options; this.listeners = {}; workers.push(this); }
        addEventListener(event, callback) { this.listeners[event] = callback; }
    }
    const window = { Worker: NativeWorker };
    const module = { MeshClient: {} };
    window.importMesh = async () => {
        const worker = new window.Worker('https://field.beckersuite.com/exports/compare/compare-worker.js', { type: 'module' });
        assert.match(worker.url, /^blob:https:\/\/21beckem.github.io\//);
        assert.equal(await blobs.get(worker.url).text(), 'import "https://field.beckersuite.com/exports/compare/compare-worker.js";');
        worker.listeners.message();
        const local = new window.Worker('/own-worker.js', { type: 'module' });
        assert.equal(local.url, '/own-worker.js');
        return module;
    };
    vm.runInNewContext(source, {
        window, location: new URL('https://21beckem.github.io/parachute/'),
        document: { baseURI: 'https://21beckem.github.io/parachute/' }, URL: TestURL, Blob
    });
    assert.equal(await window.loadParachuteMesh(), module);
    assert.equal(window.Worker, NativeWorker);
    assert.deepEqual(revoked, [workers[0].url]);
});

test('localhost keeps the bridge that selects the default hosted detection server', async () => {
    const load = loader('http://localhost:3000/', async (url) => {
        assert.equal(url, 'http://localhost:3000/mesh-runtime/durable-object-server/mesh/mesh-client.js');
        return { MeshClient: {} };
    });
    await load();
});

test('other Node hosts resolve the asset bridge relative to the website base path', async () => {
    const load = loader('https://parachute.example/app/', async (url) => {
        assert.equal(url, 'https://parachute.example/app/mesh-runtime/durable-object-server/mesh/mesh-client.js');
        return {};
    });
    await load();
});

test('a failed hosted import rejects so startup can show an error and restore Connect', async () => {
    const load = loader('https://21beckem.github.io/parachute/', async () => { throw Error('offline'); });
    await assert.rejects(load(), /offline/);
});
