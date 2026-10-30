const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createParachuteServer } = require('../server.cjs');

(async () => {
    const server = createParachuteServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ channel: 'msedge', headless: true });
        const contexts = await Promise.all([
            browser.newContext({ reducedMotion: 'reduce' }),
            browser.newContext({ reducedMotion: 'reduce' })
        ]);
        for (const context of contexts) context.setDefaultTimeout(30000);
        const [a, b] = await Promise.all(
            contexts.map((context) => context.newPage())
        );
        const pageErrors = [];
        for (const page of [a, b])
            page.on('pageerror', (error) => pageErrors.push(error.message));
        const url = `http://localhost:${server.address().port}`;
        await Promise.all([a.goto(url), b.goto(url)]);
        for (const [page, name] of [
            [a, 'Sender'],
            [b, 'Receiver']
        ]) {
            await page.locator('#display-name').fill(name);
            await page.locator('#welcome-form button').click();
            await page.waitForFunction(
                () => document.querySelector('.welcome').hidden
            );
            assert.equal(
                await page.locator('#sharing-name').textContent(),
                name
            );
        }
        await Promise.all(
            [a, b].map((page) =>
                page.waitForFunction(
                    () => window.parachuteConnection?.ready,
                    {},
                    { timeout: 30000 }
                )
            )
        );
        const aId = await a.locator('#local-peer-id').inputValue();
        const bId = await b.locator('#local-peer-id').inputValue();
        assert.notEqual(aId, bId);
        await b.locator('summary.status').click();
        await b.locator('#remote-peer-id').fill(aId);
        await b.locator('#connect-peer').click();
        await Promise.all(
            [a, b].map((page) =>
                page.waitForFunction(
                    () => window.parachuteConnection?.channel?.open,
                    {},
                    { timeout: 30000 }
                )
            )
        );
        assert.equal(await a.locator('#remote-peer-id').inputValue(), bId);
        console.log('REAL PEERJS PAGE IDS CONNECTED');

        const expected = Buffer.from(
            Array.from({ length: 150003 }, (_, i) => i % 256)
        );
        await a.locator('#send-parachute').click();
        await a.locator('#share-files').setInputFiles([
            {
                name: 'binary.zip',
                mimeType: 'application/zip',
                buffer: expected
            },
            {
                name: 'notes.txt',
                mimeType: 'text/plain',
                buffer: Buffer.from('Hello from Parachute')
            }
        ]);
        await a.locator('#send-files').click();
        await b.locator('#accept-transfer').click();
        await a.waitForFunction(() =>
            document
                .getElementById('share-feedback')
                .textContent.startsWith('Delivered.')
        );
        await a.locator('[data-close="share-dialog"]').click();
        await b.locator('#show-received').click();
        const downloadEvent = b.waitForEvent('download');
        await b.getByRole('link', { name: /Save binary.zip/ }).click();
        const download = await downloadEvent;
        assert.deepEqual(
            require('node:fs').readFileSync(await download.path()),
            expected
        );
        await b.locator('[data-close="received-dialog"]').click();
        console.log('REAL BINARY FILE DOWNLOAD MATCHES SOURCE');

        await b.locator('#send-parachute').click();
        await b.locator('#share-link').fill('https://example.com/parachute');
        await b.locator('#send-link').click();
        await a.locator('#accept-transfer').click();
        await b.waitForFunction(() =>
            document
                .getElementById('share-feedback')
                .textContent.startsWith('Delivered.')
        );
        await b.locator('[data-close="share-dialog"]').click();
        await a.locator('#show-received').click();
        assert.equal(
            await a
                .getByRole('link', {
                    name: 'https://example.com/parachute',
                    exact: true
                })
                .getAttribute('href'),
            'https://example.com/parachute'
        );
        await a.locator('[data-close="received-dialog"]').click();
        console.log('REAL LINK TRANSFERRED IN REVERSE DIRECTION');

        await a.locator('summary.status').click();
        await a.locator('#disconnect-peer').click();
        await b.waitForFunction(() => !window.parachuteConnection.channel);
        assert.equal(await a.locator('#local-peer-id').inputValue(), aId);
        assert.equal(await b.locator('#local-peer-id').inputValue(), bId);
        assert.equal(await b.locator('#send-parachute').isDisabled(), true);
        console.log('DISCONNECT PRESERVES BOTH PAGE IDS');

        await a.locator('#remote-peer-id').fill(bId);
        await a.locator('#connect-peer').click();
        await Promise.all(
            [a, b].map((page) =>
                page.waitForFunction(
                    () => window.parachuteConnection.channel?.open
                )
            )
        );
        console.log('RECONNECTED IN REVERSE DIRECTION');
        await a.locator('#disconnect-peer').click();
        await b.waitForFunction(() => !window.parachuteConnection.channel);

        // The unmodified simple test page must connect with no room metadata or custom protocol label.
        const simple = await contexts[1].newPage();
        const simpleLogs = [];
        simple.on('console', (message) => simpleLogs.push(message.text()));
        await simple.goto(`${url}/peerjs-test.html`);
        await simple.waitForFunction(() => peer.open);
        await simple.locator('#peer-id').fill(aId);
        await simple.locator('#connect-btn').click();
        await a.waitForFunction(() => window.parachuteConnection.channel?.open);
        await simple.waitForFunction(() => otherPeer?.open);
        assert.ok(
            simpleLogs.some((message) => message.includes('Connected to'))
        );
        console.log('UNMODIFIED PEERJS TEST PAGE CONNECTED TO MAIN APP');
        await simple.evaluate(() => otherPeer.close());
        await a.waitForFunction(() => !window.parachuteConnection.channel);
        await simple.close();
        assert.deepEqual(pageErrors, []);
    } catch (error) {
        console.error(error);
        if (browser)
            for (const context of browser.contexts())
                for (const page of context.pages()) {
                    console.error(
                        await page
                            .locator('#connection-message')
                            .textContent({ timeout: 1000 })
                            .catch(() => 'No connection status')
                    );
                }
        process.exitCode = 1;
    } finally {
        await browser?.close();
        server.shutdown();
    }
})();
