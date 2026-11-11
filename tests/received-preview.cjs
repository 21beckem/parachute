// Received-card fixture only. No sensors, discovery service, or real transfers.
// Run node tests/received-preview.cjs, then open http://localhost:3004.
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { createParachuteServer } = require('../server.cjs');
const init = `window.parachuteConnection = { active: false, send: document.getElementById('send-parachute') };`;
const demo = `
document.body.classList.add('has-entered');
document.querySelector('.welcome').hidden = true;
const sharing = window.parachuteSharing;
const picture = new File([Uint8Array.from(atob(PHOTO), c => c.charCodeAt(0))], 'team-photo.png', { type: 'image/png' });
sharing.delivered({ sender: 'Sam', kind: 'files', files: [picture, new File(['Trip notes'], 'notes.txt', { type: 'text/plain' }), new File(['test'], 'theme.mp3', { type: 'audio/mpeg' })] });
sharing.delivered({ sender: 'Spencer', kind: 'files', files: [new File(['Other notes'], 'notes.txt', { type: 'text/plain' })] });
sharing.delivered({ sender: 'Michael', kind: 'link', files: [], url: 'https://example.com/project' });
sharing.receivedDialog.showModal();
if (new URLSearchParams(location.search).has('arrival-preview')) {
    sharing.receivedDialog.close();
    sharing.animateArrival({ sender: 'Sam', kind: 'files', files: [picture] });
    const { flight } = [...sharing.arrivals][0];
    setTimeout(() => flight.pause(), 300);
    const finish = document.createElement('button');
    finish.textContent = 'Finish arrival preview';
    finish.style.cssText = 'position:fixed;top:110px;left:20px;z-index:8;padding:12px';
    finish.addEventListener('click', () => { flight.play(); finish.remove(); });
    document.body.append(finish);
}
if (new URLSearchParams(location.search).has('disconnect-preview')) {
    sharing.receivedDialog.close();
    const offer = { id: 'preview-offer', sender: 'Preview sender', kind: 'files', files: [{ name: 'unavailable.txt', size: 10, mime: 'text/plain' }] };
    sharing.transports.set(999, { incoming: offer, close() { sharing.offer(999, null); } });
    sharing.offer(999, offer);
    const delivery = sharing.offers.get(999).delivery;
    delivery.paused = true;
    const leave = () => sharing.closePeer(999);
    delivery.element.addEventListener('pointerdown', () => setTimeout(leave, 100), { once: true });
    const disconnect = document.createElement('button');
    disconnect.textContent = 'Disconnect preview sender';
    disconnect.style.cssText = 'position:fixed;top:110px;left:20px;z-index:8;padding:12px';
    disconnect.addEventListener('click', leave);
    document.body.append(disconnect);
}
`;
const photo = readFileSync(path.join(__dirname, '../mockups/chatgpt-mockup-sep-21.png')).toString('base64');
const server = createParachuteServer();
const serve = server.listeners('request')[0];
server.removeAllListeners('request');
server.on('request', (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') {
        res.setHeader('Content-Type', 'text/html');
        return res.end(readFileSync(path.join(__dirname, '../index.html'), 'utf8')
            .replace(/<script src="(?:mesh-loader|connection|welcome)\.js[^>]*><\/script>/g, '')
            .replace('<script src="sharing.js', '<script src="/received-init.js" defer></script><script src="sharing.js')
            .replace('</head>', '<script src="/received-demo.js" defer></script></head>'));
    }
    if (url.pathname === '/received-init.js' || url.pathname === '/received-demo.js') {
        res.setHeader('Content-Type', 'text/javascript');
        return res.end(url.pathname === '/received-init.js' ? init : `const PHOTO = ${JSON.stringify(photo)};\n${demo}`);
    }
    return serve(req, res);
});
server.listen(3004, '127.0.0.1', () => console.log('Received cards fixture: http://localhost:3004'));
