// Exercise the REAL hosted MeshClient/WASM/audio pipeline using synthetic
// audio and location. No real microphone or device location is accessed.
// This sends generated audio features and coordinates 0,0 to the default server.
// Run: node tests/detector-preview.cjs, then open http://localhost:3002.
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { createParachuteServer } = require('../server.cjs');
const sensors = `
const testContexts = new Set();
navigator.mediaDevices.getUserMedia = async () => {
    const context = new AudioContext({ sampleRate: 16000 });
    testContexts.add(context);
    await context.resume();
    const oscillator = context.createOscillator();
    oscillator.frequency.value = 440;
    const destination = context.createMediaStreamDestination();
    oscillator.connect(destination);
    oscillator.start();
    for (const track of destination.stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => {
            stop();
            oscillator.stop();
            void context.close();
            testContexts.delete(context);
        };
    }
    return destination.stream;
};
navigator.geolocation.getCurrentPosition = (success, failure, options) => {
    setTimeout(() => {
        if (new URLSearchParams(location.search).has('location-timeout')) {
            failure({ code: 3, message: 'Synthetic location timeout' });
        } else success({ coords: { latitude: 0, longitude: 0, accuracy: 10 }, timestamp: Date.now() });
    }, 20);
};
window.addEventListener('pagehide', () => { for (const context of testContexts) void context.close(); });
`;
const server = createParachuteServer();
const serve = server.listeners('request')[0];
server.removeAllListeners('request');
server.on('request', (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') {
        res.setHeader('Content-Type', 'text/html');
        return res.end(readFileSync(path.join(__dirname, '../index.html'), 'utf8')
            .replace('<title>Parachute</title>', '<title>Parachute · real detector test</title><script src="/synthetic-sensors.js"></script>')
            .replace('<body>', '<body><p style="position:fixed;bottom:0;right:0;z-index:20;background:white;color:black;margin:0;padding:4px;font-size:12px">Test: real detector, synthetic audio and location</p>'));
    }
    if (url.pathname === '/synthetic-sensors.js') {
        res.setHeader('Content-Type', 'text/javascript');
        return res.end(sensors);
    }
    return serve(req, res);
});
server.listen(3002, '127.0.0.1', () => console.log('Real detector with synthetic sensors: http://localhost:3002'));
