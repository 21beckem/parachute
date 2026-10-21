// Shared relay: ordinary HTTP works across networks without a direct WebRTC link.
const http = require('node:http');
const { randomBytes, randomInt } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { networkInterfaces } = require('node:os');

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const assets = new Map([
    ['/', ['index.html', 'text/html']], ['/index.html', ['index.html', 'text/html']],
    ['/style.css', ['style.css', 'text/css']], ['/background.css', ['background.css', 'text/css']],
    ['/parachute.js', ['parachute.js', 'text/javascript']], ['/connection.js', ['connection.js', 'text/javascript']],
    ['/microphone.js', ['microphone.js', 'text/javascript']],
    ['/vendor/peerjs.min.js', ['vendor/peerjs.min.js', 'text/javascript']]
]);

function createParachuteServer() {
    const sessions = new Map(), codes = new Map();
    function json(res, status, data) {
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(data));
    }
    function emit(session, data) {
        if (session?.stream && !session.stream.destroyed) session.stream.write(`data: ${JSON.stringify(data)}\n\n`);
    }
    function unpair(session) {
        const other = sessions.get(session.partner);
        session.partner = null;
        session.pairId = null;
        if (other?.partner === session.token) {
            other.partner = null;
            other.pairId = null;
            emit(other, { type: 'disconnected' });
        }
        emit(session, { type: 'disconnected' });
    }
    function remove(session) {
        if (!sessions.has(session.token)) return;
        unpair(session);
        sessions.delete(session.token);
        codes.delete(session.code);
        session.stream?.end();
    }
    async function body(req) {
        let text = '';
        for await (const chunk of req) {
            text += chunk;
            if (text.length > 1024) throw new Error('Request too large.');
        }
        return JSON.parse(text || '{}');
    }
    const server = http.createServer(async (req, res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer');
        const url = new URL(req.url, 'http://localhost');
        try {
            if (req.method === 'GET' && assets.has(url.pathname)) {
                const [file, mime] = assets.get(url.pathname);
                const data = await readFile(path.join(__dirname, file));
                res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8`, 'Cache-Control': 'no-cache' });
                return res.end(data);
            }
            // Same website, including when served by an HTTPS reverse proxy.
            if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) {
                return json(res, 403, { error: 'Open the website served by this server.' });
            }
            if (req.method === 'POST' && url.pathname === '/api/session') {
                if (sessions.size >= 1000) return json(res, 503, { error: 'The server is full. Try again later.' });
                let code;
                do { code = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join(''); }
                while (codes.has(code));
                const token = randomBytes(24).toString('hex');
                const session = { token, code, partner: null, stream: null, touched: Date.now(), attempts: [], sent: 0 };
                sessions.set(token, session);
                codes.set(code, session);
                return json(res, 201, { token, code });
            }
            const token = req.method === 'GET' ? url.searchParams.get('token') : req.headers.authorization?.replace(/^Bearer /, '');
            const session = sessions.get(token);
            if (url.pathname.startsWith('/api/') && !session) return json(res, 401, { error: 'Your code expired. Click Retry to get a new one.' });
            if (req.method === 'GET' && url.pathname === '/api/events') {
                session.stream?.end();
                session.stream = res;
                session.touched = Date.now();
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store',
                    'Connection': 'keep-alive', 'X-Accel-Buffering': 'no'
                });
                emit(session, { type: 'ready', code: session.code, partner: sessions.get(session.partner)?.code || null, pairId: session.pairId || null });
                res.on('close', () => {
                    if (session.stream !== res) return;
                    session.stream = null;
                    session.touched = Date.now();
                    unpair(session);
                });
                return;
            }
            if (req.method !== 'POST') return json(res, 404, { error: 'Not found.' });
            if (url.pathname === '/api/leave') {
                remove(session);
                return json(res, 200, {});
            }
            if (!session?.stream) return json(res, 409, { error: 'Connection service lost. Click Retry.' });
            const data = await body(req);
            if (!data || typeof data !== 'object' || Array.isArray(data)) return json(res, 400, { error: 'Invalid request.' });
            // The browser might have closed while the body was arriving.
            if (!sessions.has(token) || !session.stream) return json(res, 409, { error: 'Connection service lost. Click Retry.' });
            if (url.pathname === '/api/connect') {
                const now = Date.now();
                session.attempts = session.attempts.filter(time => now - time < 60000);
                if (session.attempts.length >= 10) return json(res, 429, { error: 'Too many attempts. Wait a minute and try again.' });
                session.attempts.push(now);
                const other = typeof data.code === 'string' ? codes.get(data.code.toUpperCase().replace(/[\s-]/g, '')) : null;
                if (!other?.stream) return json(res, 404, { error: 'That code is unavailable. Check it and keep the other page open.' });
                if (other === session) return json(res, 400, { error: "That's your code. Enter the other computer's code." });
                if (session.partner === other.token && other.partner === token) return json(res, 200, {});
                if (session.partner || other.partner) return json(res, 409, { error: 'One of these computers is already connected. Disconnect first.' });
                session.partner = other.token;
                other.partner = token;
                session.pairId = other.pairId = randomBytes(12).toString('hex');
                emit(session, { type: 'connected', code: other.code, pairId: session.pairId });
                emit(other, { type: 'connected', code: session.code, pairId: session.pairId });
                return json(res, 200, {});
            }
            if (url.pathname === '/api/disconnect') {
                unpair(session);
                return json(res, 200, {});
            }
            if (url.pathname === '/api/send') {
                const other = sessions.get(session.partner);
                if (!other?.stream || other.partner !== token || data.code !== other.code || data.pairId !== session.pairId) return json(res, 409, { error: 'Your friend disconnected. Connect again.' });
                if (Object.keys(data).length !== 4 || data.type !== 'parachute' || data.version !== 1) return json(res, 400, { error: 'Only parachute messages are supported.' });
                if (Date.now() - session.sent < 500) return json(res, 429, { error: 'Wait a moment before sending another parachute.' });
                session.sent = Date.now();
                emit(other, { type: 'parachute', version: 1 });
                return json(res, 200, {});
            }
            json(res, 404, { error: 'Not found.' });
        } catch {
            if (!res.headersSent) json(res, 400, { error: 'Invalid request.' });
            else res.end();
        }
    });
    const heartbeat = setInterval(() => {
        for (const session of sessions.values()) {
            if (session.stream) session.stream.write(': heartbeat\n\n');
            else if (Date.now() - session.touched > 60000) remove(session);
        }
    }, 15000);
    heartbeat.unref();
    server.on('close', () => clearInterval(heartbeat));
    server.shutdown = () => {
        for (const session of [...sessions.values()]) remove(session);
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
                if (entry.family === 'IPv4' && !entry.internal) console.log(`Same Wi-Fi: http://${entry.address}:${port}`);
            }
        }
        console.log('Open the same server URL on both computers, then share a connection code.');
    });
}
module.exports = { createParachuteServer };
