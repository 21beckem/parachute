// Live relay regression: synthetic sensors and controlled sound matches.
// Run manually with Playwright available: node tests/relay-browser.cjs
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createDetectorPreview } = require('./detector-preview.cjs');

(async () => {
    const server = createDetectorPreview({ relayTest: true });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ channel: 'msedge', headless: true });
        const context = await browser.newContext({ reducedMotion: 'reduce' });
        const pages = await Promise.all([context.newPage(), context.newPage()]);
        const errors = [];
        for (const page of pages) {
            page.setDefaultTimeout(60000);
            page.on('pageerror', error => errors.push(error.message));
        }
        const [a, b] = pages;
        const url = `http://localhost:${server.address().port}`;
        await Promise.all(pages.map(page => page.goto(url)));
        for (const [page, name] of [[a, 'Sender'], [b, 'Receiver']]) {
            await page.locator('#display-name').fill(name);
            await page.locator('#welcome-connect').click();
            await page.waitForFunction(() => window.parachuteConnection?.active);
        }
        await Promise.all(pages.map(page => page.waitForFunction(() => window.parachuteConnection.nearbyPeers().length === 1)));
        await a.evaluate(() => {
            const bus = new BroadcastChannel('parachute-real-relay-test');
            bus.postMessage({ type: 'matches', visible: false });
            bus.close();
        });
        await Promise.all(pages.map(page => page.waitForFunction(() => window.parachuteConnection.mesh.peers.length === 0)));
        assert.equal(await a.evaluate(() => window.parachuteConnection.nearbyPeers().length), 1);
        assert.match(await a.locator('#nearby-devices').textContent(), /Signal interrupted/);
        await a.evaluate(() => {
            const files = Array.from({ length: 10 }, (_, i) => {
                const bytes = Uint8Array.from({ length: 65536 * 2 + i + 1 }, (_, j) => (j + i) % 251);
                return new File([bytes], i < 3 ? `video-${i}.mp4` : `photo-${i}.jpg`, { type: i < 3 ? 'video/mp4' : 'image/jpeg' });
            });
            // These are deterministic test bytes, not playable media.
            window.testSend = window.parachuteSharing.send({ files });
        });
        await b.waitForFunction(() => window.parachuteSharing.offers.size === 1);
        await b.evaluate(() => {
            const [uid, item] = [...window.parachuteSharing.offers][0];
            item.delivery.cancel('received');
            window.parachuteSharing.catchOffer(uid, item);
        });
        await a.evaluate(() => window.testSend);
        await b.waitForFunction(() => window.parachuteSharing.entries.size === 1);
        const integrity = await b.evaluate(async () => {
            const items = [...window.parachuteSharing.entries][0].items;
            for (let i = 0; i < items.length; i++) {
                const bytes = new Uint8Array(await (await fetch(items[i].link.href)).arrayBuffer());
                if (bytes.length !== 65536 * 2 + i + 1 || bytes.some((byte, j) => byte !== (j + i) % 251)) return false;
            }
            return items.length === 10;
        });
        assert.equal(integrity, true);
        console.log('LIVE RELAY: ten files sent during sound-match grace; every byte matched.');

        // Drop one app acknowledgment and the first completion reply.
        await b.evaluate(() => {
            const mesh = window.parachuteConnection.mesh;
            const relay = mesh.relayMessage.bind(mesh);
            let lostChunk = false, lostComplete = false;
            mesh.relayMessage = (to, packet, options) => {
                if (packet.type === 'chunk-received' && packet.sequence === 2 && !lostChunk) { lostChunk = true; return Promise.resolve(); }
                if (packet.type === 'complete' && !lostComplete) { lostComplete = true; return Promise.resolve(); }
                return relay(to, packet, options);
            };
        });
        // Re-match before a new offer to avoid depending on hosted network speed.
        await a.evaluate(() => {
            const bus = new BroadcastChannel('parachute-real-relay-test');
            bus.postMessage({ type: 'matches', visible: true }); bus.close();
        });
        await Promise.all(pages.map(page => page.waitForFunction(() => window.parachuteConnection.mesh.peers.length === 1)));
        await a.evaluate(() => {
            window.testSend = window.parachuteSharing.send({ files: [new File([new Uint8Array(65536 * 10).fill(73)], 'retry.bin')] });
        });
        await b.waitForFunction(() => window.parachuteSharing.offers.size === 1);
        await b.evaluate(() => {
            const [uid, item] = [...window.parachuteSharing.offers][0];
            item.delivery.cancel('received'); window.parachuteSharing.catchOffer(uid, item);
        });
        await a.evaluate(() => window.testSend);
        assert.equal(await b.evaluate(() => window.parachuteSharing.entries.size), 2);
        assert.equal(await b.evaluate(async () => {
            const bytes = new Uint8Array(await (await fetch([...window.parachuteSharing.entries][1].items[0].link.href)).arrayBuffer());
            return bytes.length === 65536 * 10 && bytes.every(byte => byte === 73);
        }), true);
        assert.deepEqual(errors, []);
        console.log('LIVE RELAY: lost chunk/completion replies recovered without duplicate packages.');
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
