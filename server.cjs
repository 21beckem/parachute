// Static files only. PeerJS handles signaling; WebRTC carries packages.
const http = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { networkInterfaces } = require('node:os');

const assets = new Map([
    ['/', ['index.html', 'text/html']],
    ['/index.html', ['index.html', 'text/html']],
    ['/style.css', ['style.css', 'text/css']],
    ['/background.css', ['background.css', 'text/css']],
    ['/parachute.js', ['parachute.js', 'text/javascript']],
    ['/connection.js', ['connection.js', 'text/javascript']],
    ['/welcome.js', ['welcome.js', 'text/javascript']],
    ['/transfer.js', ['transfer.js', 'text/javascript']],
    ['/sharing.js', ['sharing.js', 'text/javascript']],
    ['/peerjs-test.html', ['peerjs-test.html', 'text/html']],
    ['/vendor/peerjs.min.js', ['vendor/peerjs.min.js', 'text/javascript']]
]);

function createParachuteServer() {
    const server = http.createServer(async (req, res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer');
        try {
            const asset = assets.get(
                new URL(req.url, 'http://localhost').pathname
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
            'Open the website on both computers, then share a PeerJS page ID.'
        );
    });
}
module.exports = { createParachuteServer };
