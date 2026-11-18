// Received-card fixture only. No sensors, discovery service, or real transfers.
// Run node tests/received-preview.cjs, then open http://localhost:3004.
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { createParachuteServer } = require('../server.cjs');
const init = `window.parachuteConnection = { active: true, nearbyPeers: () => [2, 3], devices: new Map([[2, {name: 'Emma'}], [3, {name: 'Jacob'}]]), send: document.getElementById('send-parachute') };`;
const demo = `
document.body.classList.add('has-entered');
document.querySelector('.welcome').hidden = true;
const sharing = window.parachuteSharing;
const picture = new File([Uint8Array.from(atob(PHOTO), c => c.charCodeAt(0))], 'team-photo.png', { type: 'image/png' });
sharing.delivered({ title: 'Weekend memories', sender: 'Sam', kind: 'files', files: [picture, new File(['Trip notes'], 'notes.txt', { type: 'text/plain' }), new File(['test'], 'theme.mp3', { type: 'audio/mpeg' })] });
sharing.delivered({ sender: 'Spencer', kind: 'files', files: [new File(['Other notes'], 'notes.txt', { type: 'text/plain' })] });
sharing.delivered({ sender: 'Michael', kind: 'link', files: [], url: 'https://example.com/project' });
sharing.receivedDialog.showModal();
if (new URLSearchParams(location.search).has('send-preview')) {
    sharing.receivedDialog.close();
    sharing.open();
    sharing.parachuteTitle.value = 'Weekend memories';
    sharing.addFiles([picture, new File(['Trip notes'], 'notes.txt', { type: 'text/plain' })]);
}
if (new URLSearchParams(location.search).has('progress-preview')) {
    sharing.receivedDialog.close();
    sharing.batchStatus({ title: 'Weekend memories', records: new Map([
        [2, {name: 'Emma', state: 'sending', progress: .64}],
        [3, {name: 'Jacob', state: 'delivered', progress: 1}],
        ...Array.from({length: 12}, (_, i) => [i + 4, {name: 'Friend ' + (i + 1), state: 'sending', progress: .28}])
    ]) });
}
if (new URLSearchParams(location.search).has('parachute-preview') || new URLSearchParams(location.search).has('payload-preview') || new URLSearchParams(location.search).has('flight-preview')) {
    sharing.receivedDialog.close();
    const flightPreview = new URLSearchParams(location.search).has('flight-preview');
    const colors = flightPreview ? ['coral', 'sky', 'sage'] : innerWidth < 640 ? ['sky', 'lavender'] : window.ParachuteTransfer.COLORS;
    const names = ['Weekend memories', 'Study notes', 'A song for you', 'Class project', 'Summer plans', 'Favorite website'];
    const showParachutes = () => {
    colors.forEach((color, index) => {
        const uid = 900 + index;
        sharing.clearOffer(uid);
        const offer = { id: 'color-preview-' + color, sender: index % 2 ? 'Emma' : 'Spencer', title: names[index], color, kind: 'files', files: [{name: 'notes.txt', mime: 'text/plain', size: 2400}] };
        if (new URLSearchParams(location.search).has('payload-preview') || flightPreview) {
            const samples = [['Package', 'archive.bin', 'application/octet-stream'], ['ZIP folder', 'project.zip', 'application/zip'], ['Website link'], ['Music', 'song.mp3', 'audio/mpeg'], ['Picture', 'photo.png', 'image/png'], ['Video', 'movie.mp4', 'video/mp4']];
            const flightSamples = [['File', 'notes.txt', 'text/plain'], ['Website link'], ['Package', 'archive.bin', 'application/octet-stream']];
            const [title, name, mime] = (flightPreview ? flightSamples : samples)[index];
            offer.title = title;
            if (flightPreview) delete offer.title;
            if (name) offer.files = [{name, mime, size: 2400}];
            else { offer.kind = 'link'; offer.url = 'https://example.com'; offer.files = []; }
        }
        sharing.transports.set(uid, { incoming: offer, decline() {}, close() {}, accept() { sharing.clearOffer(uid); window.ParachuteAnimation.announce('Preview parachute caught.'); } });
        sharing.offer(uid, offer);
        const delivery = sharing.offers.get(uid).delivery;
        const columns = innerWidth < 640 ? 2 : 3;
        const row = Math.floor(index / columns), col = index % columns;
        delivery.paused = !flightPreview;
        if (!flightPreview) {
            delivery.x = innerWidth * ((col + .5) / columns) - delivery.element.offsetWidth / 2;
            delivery.y = 120 + row * 255;
        }
        delivery.render();
        if (flightPreview) {
            // Hold only altitude in this fixture so wind and edge rebounds remain visible.
            const hold = setInterval(() => {
                if (delivery.disposed) { clearInterval(hold); return; }
                if (delivery.pointer === null && !delivery.receiving && delivery.y >= 120) {
                    delivery.y = 120;
                    delivery.vy = 0;
                }
            }, 40);
        }
    });
    document.getElementById('transfer-status').hidden = true;
    };
    showParachutes();
    if (flightPreview) {
        const replay = document.createElement('button');
        replay.textContent = 'Replay parachutes';
        replay.style.cssText = 'position:fixed;top:88px;left:50%;transform:translateX(-50%);z-index:10;padding:10px 15px;border:2px solid #293d52;border-radius:12px;background:#ffd779;color:#293d52;cursor:pointer;font-weight:bold';
        replay.addEventListener('click', showParachutes);
        document.body.append(replay);
    }
}
if (new URLSearchParams(location.search).has('launch-preview')) {
    sharing.receivedDialog.close();
    const replay = document.createElement('button');
    replay.textContent = 'Replay launch';
    replay.style.cssText = 'position:fixed;top:90px;left:50%;transform:translateX(-50%);z-index:10;border:2px solid #293d52;border-radius:12px;background:#ffd779;padding:10px 16px;color:#293d52;font-weight:bold;cursor:pointer';
    let paused = [];
    replay.addEventListener('click', async () => {
        if (paused.length) { paused.forEach(animation => animation.play()); paused = []; return; }
        replay.disabled = true;
        const flight = window.animation.launchRocket();
        if (new URLSearchParams(location.search).has('inspect-launch')) setTimeout(() => {
            paused = document.getAnimations().filter(animation => animation.effect?.target?.closest('.rocket, .launch-exhaust'));
            paused.forEach(animation => animation.pause());
            replay.textContent = 'Continue launch';
            replay.disabled = false;
        }, 900);
        await flight;
        replay.textContent = 'Replay launch';
        replay.disabled = false;
    });
    document.body.append(replay);
}
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
