const { chromium } = require('playwright');
const { createParachuteServer } = require('../server.cjs');
(async () => {
 const server = createParachuteServer(); await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser = await chromium.launch({channel:'msedge', headless:true});
 try {
  const ca = await browser.newContext({reducedMotion:'reduce'}), cb = await browser.newContext({reducedMotion:'reduce'});
  if (process.env.PARACHUTE_TEST_RELAY === '1') {
   for (const context of [ca, cb]) await context.addInitScript(() => {
    window.PARACHUTE_PEER_OPTIONS = { config: {
     iceTransportPolicy: 'relay', iceServers: [{
      urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'],
      username: 'peerjs', credential: 'peerjsp'
     }]
    } };
   });
  }
  const a = await ca.newPage(), b = await cb.newPage();
  for(const p of [a,b]) p.on('pageerror',e=>console.log('PAGE ERROR',e.message));
  const url = 'http://localhost:'+server.address().port;
  await Promise.all([a.goto(url),b.goto(url)]);
  await Promise.all([a.waitForFunction(()=>window.parachuteConnection?.ready,{},{timeout:30000}),b.waitForFunction(()=>window.parachuteConnection?.ready,{},{timeout:30000})]);
  const code = await a.locator('#local-peer-id').inputValue();
  await b.locator('summary.status').click(); await b.locator('#remote-peer-id').fill(code); await b.locator('#connect-peer').click();
  await Promise.all([a.waitForFunction(()=>window.parachuteConnection?.channel?.open,{},{timeout:30000}),b.waitForFunction(()=>window.parachuteConnection?.channel?.open,{},{timeout:30000})]);
  console.log('REAL PEERJS CONNECTED',code);
  for (const [sender,receiver,kind] of [[a,b,'picture'],[b,a,'music']]) {
   await sender.evaluate(kind=>document.getElementById('package-kind').value=kind,kind);
   await sender.locator('#send-parachute').click();
   await receiver.waitForFunction(kind=>Array.from(window.ParachuteAnimation.deliveries).some(d=>d.type===kind),kind);
   await sender.waitForFunction(()=>document.getElementById('connection-message').textContent.includes('confirmed receipt'));
   console.log('ACKNOWLEDGED',kind,'actual RTC', await sender.evaluate(()=>window.parachuteConnection.channel.peerConnection.connectionState));
  }
  await a.locator('summary.status').click(); await a.locator('#disconnect-peer').click();
  await b.waitForFunction(()=>!window.parachuteConnection.ready);
  console.log('REMOTE DISCONNECT VERIFIED');
 } catch(e) { console.error(e.message); for(const c of browser.contexts()) for(const p of c.pages()) console.log(await p.locator('#connection-message').textContent()); process.exitCode=1; }
 finally {await browser.close();server.shutdown();}
})();
