// Website assets and a live, same-origin bridge to the hosted MeshClient assets.
const http = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { networkInterfaces } = require('node:os');

const assets = new Map([
    ['/', ['index.html', 'text/html']],
    ['/index.html', ['index.html', 'text/html']],
    ['/about.html', ['about.html', 'text/html']],
    ['/style.css', ['style.css', 'text/css']],
    ['/background.css', ['background.css', 'text/css']],
    ['/about.css', ['about.css', 'text/css']],
    ['/parachute.js', ['parachute.js', 'text/javascript']],
    ['/connection.js', ['connection.js', 'text/javascript']],
    ['/mesh-loader.js', ['mesh-loader.js', 'text/javascript']],
    ['/welcome.js', ['welcome.js', 'text/javascript']],
    ['/transfer.js', ['transfer.js', 'text/javascript']],
    ['/sharing.js', ['sharing.js', 'text/javascript']],
    ['/peerjs-test.html', ['peerjs-test.html', 'text/html']],
    ['/vendor/peerjs.min.js', ['vendor/peerjs.min.js', 'text/javascript']]
]);

const meshOrigin = 'https://21beckem.github.io/same-room-detector/';
const meshEntry = 'durable-object-server/mesh/mesh-client.js';
const meshPaths = /^(?:durable-object-server\/(?:mesh|src\/protocol)\/[^/]+\.js|exports\/compare\/[^/]+\.js|model_output\/model\.json|web-calibration\/wasm_parity\/wasm\/same_room\.wasm)$/;

function createParachuteServer({ fetchMesh = fetch } = {}) {
    const cache = new Map();
    const server = http.createServer(async (req, res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer');
        try {
            const pathname = new URL(req.url, 'http://localhost').pathname;
            if (pathname.startsWith('/mesh-runtime/') && ['GET', 'HEAD'].includes(req.method)) {
                const resource = pathname.slice('/mesh-runtime/'.length);
                if (!meshPaths.test(resource)) {
                    res.writeHead(404);
                    return res.end('Not found.');
                }
                try {
                    let asset = cache.get(resource);
                    if (!asset || asset.expires < Date.now()) {
                        const upstream = await fetchMesh(new URL(resource, meshOrigin), {
                            signal: AbortSignal.timeout(20000)
                        });
                        if (!upstream.ok) throw Error(`Mesh asset returned ${upstream.status}`);
                        let data = Buffer.from(await upstream.arrayBuffer());
                        if (resource === meshEntry) {
                            // Keep the upstream default server URL, even on localhost.
                            // No detection logic or endpoint is copied into this website.
                            const source = data.toString('utf8');
                            const setting = /^const isHostedLocally = .+;$/m;
                            if (!setting.test(source)) throw Error('MeshClient local-host setting changed; update the asset bridge.');
                            data = Buffer.from(source.replace(setting, 'const isHostedLocally = false;'));
                        }
                        asset = { data, expires: Date.now() + 60000 };
                        cache.set(resource, asset);
                    }
                    const type = resource.endsWith('.wasm') ? 'application/wasm'
                        : resource.endsWith('.json') ? 'application/json' : 'text/javascript';
                    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
                    return res.end(req.method === 'HEAD' ? undefined : asset.data);
                } catch (error) {
                    console.error('Mesh asset unavailable:', error.message);
                    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
                    return res.end('The nearby discovery service could not load. Please retry.');
                }
            }
            const asset = assets.get(
                pathname
            );
            if (!asset || !['GET', 'HEAD'].includes(req.method)) {
                res.writeHead(404, {
                    'Content-Type': 'text/plain; charset=utf-8'
                });
                return res.end('Not found.');
            }
            const [file, mime] = asset;
            const data = await readFile(path.join(__dirname, file));
            res.writeHead(200, {
                'Content-Type': `${mime}; charset=utf-8`,
                'Cache-Control': 'no-cache'
            });
            res.end(req.method === 'HEAD' ? undefined : data);
        } catch {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Unable to serve this file.');
        }
    });
    server.shutdown = () => {
        server.close();
        server.closeAllConnections();
    };
    return server;
}

if (require.main === module) {
    const port = Number(process.env.PORT || 3000);
    const server = createParachuteServer();
    server.listen(port, '0.0.0.0', () => {
        console.log(`Parachute: http://localhost:${port}`);
        for (const entries of Object.values(networkInterfaces())) {
            for (const entry of entries || []) {
                if (entry.family === 'IPv4' && !entry.internal)
                    console.log(`Same Wi-Fi: http://${entry.address}:${port}`);
            }
        }
        console.log(
            'Open the website on both devices and click Connect to find nearby people.'
        );
    });
}
module.exports = { createParachuteServer };
