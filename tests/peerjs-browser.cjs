const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createParachuteServer } = require('../server.cjs');

(async () => {
    const server = createParachuteServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ channel: 'msedge', headless: true });
        const contexts = await Promise.all([browser.newContext({ reducedMotion: 'reduce' }), browser.newContext({ reducedMotion: 'reduce' })]);
        for (const context of contexts) context.setDefaultTimeout(30000);
        const [a, b] = await Promise.all(contexts.map(context => context.newPage()));
        const pageErrors = [];
        for (const page of [a, b]) page.on('pageerror', error => pageErrors.push(error.message));
        const url = `http://localhost:${server.address().port}`;
        await Promise.all([a.goto(url), b.goto(url)]);
        await Promise.all([a, b].map(page => page.waitForFunction(() => window.parachuteConnection?.ready, {}, { timeout: 30000 })));
        const aId = await a.locator('#local-peer-id').inputValue();
        const bId = await b.locator('#local-peer-id').inputValue();
        assert.notEqual(aId, bId);
        await b.locator('summary.status').click();
        await b.locator('#remote-peer-id').fill(aId);
        await b.locator('#connect-peer').click();
        await Promise.all([a, b].map(page => page.waitForFunction(() => window.parachuteConnection?.channel?.open, {}, { timeout: 30000 })));
        assert.equal(await a.locator('#remote-peer-id').inputValue(), bId);
        console.log('REAL PEERJS PAGE IDS CONNECTED');

        for (const [sender, receiver, kind] of [[a, b, 'picture'], [b, a, 'music']]) {
            await sender.evaluate(kind => document.getElementById('package-kind').value = kind, kind);
            await sender.locator('#send-parachute').click();
            await receiver.waitForFunction(kind => Array.from(window.ParachuteAnimation.deliveries).some(delivery => delivery.type === kind), kind);
            await sender.waitForFunction(() => document.getElementById('connection-message').textContent.includes('confirmed receipt'));
            console.log('ACKNOWLEDGED', kind);
        }

        await a.locator('summary.status').click();
        await a.locator('#disconnect-peer').click();
        await b.waitForFunction(() => !window.parachuteConnection.channel);
        assert.equal(await a.locator('#local-peer-id').inputValue(), aId);
        assert.equal(await b.locator('#local-peer-id').inputValue(), bId);
        assert.equal(await b.locator('#send-parachute').isDisabled(), true);
        console.log('DISCONNECT PRESERVES BOTH PAGE IDS');

        await a.locator('#remote-peer-id').fill(bId);
        await a.locator('#connect-peer').click();
        await Promise.all([a, b].map(page => page.waitForFunction(() => window.parachuteConnection.channel?.open)));
        console.log('RECONNECTED IN REVERSE DIRECTION');
        await a.locator('#disconnect-peer').click();
        await b.waitForFunction(() => !window.parachuteConnection.channel);

        // The unmodified simple test page must connect with no room metadata or custom protocol label.
        const simple = await contexts[1].newPage();
        const simpleLogs = [];
        simple.on('console', message => simpleLogs.push(message.text()));
        await simple.goto(`${url}/peerjs-test.html`);
        await simple.waitForFunction(() => peer.open);
        await simple.locator('#peer-id').fill(aId);
        await simple.locator('#connect-btn').click();
        await a.waitForFunction(() => window.parachuteConnection.channel?.open);
        await simple.waitForFunction(() => otherPeer?.open);
        assert.ok(simpleLogs.some(message => message.includes('Connected to')));
        console.log('UNMODIFIED PEERJS TEST PAGE CONNECTED TO MAIN APP');
        await simple.evaluate(() => otherPeer.close());
        await a.waitForFunction(() => !window.parachuteConnection.channel);
        await simple.close();
        assert.deepEqual(pageErrors, []);
    } catch (error) {
        console.error(error);
        if (browser) for (const context of browser.contexts()) for (const page of context.pages()) {
            console.error(await page.locator('#connection-message').textContent({ timeout: 1000 }).catch(() => 'No connection status'));
        }
        process.exitCode = 1;
    } finally {
        await browser?.close();
        server.shutdown();
    }
})();
