const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../mesh-loader.js'), 'utf8')
    .replace('import(clientUrl)', 'window.importMesh(clientUrl)');

function loader(baseURI, importMesh) {
    const window = { importMesh };
    vm.runInNewContext(source, { window, location: new URL(baseURI), document: { baseURI }, URL });
    return window.loadParachuteMesh;
}

test('GitHub Pages imports the hosted detector directly without a Node route', async () => {
    const module = { MeshClient: {} };
    const load = loader('https://21beckem.github.io/parachute/', async (url) => {
        assert.equal(url, 'https://21beckem.github.io/same-room-detector/durable-object-server/mesh/mesh-client.js');
        assert.equal(new URL(url).origin, 'https://21beckem.github.io', 'the analyzer worker shares the page origin');
        return module;
    });
    assert.equal(await load(), module);
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
