# Parachute

## Team Members

Michael Becker

Sam Pickett

Spencer Ehardt

Conner Madsen

## Software Description

A nearby file-sharing website with interactive rockets and parachutes.

## Architecture

* [x] HTML, CSS, and JavaScript
* [x] MeshClient nearby discovery and server-relayed sharing

## Software Features

* [x] File and website-link sharing
* [x] Two-way rocket packages and parachutes with receipt confirmations

## Team Communication

* Text/SMS
* GitHub

## Team Responsibility

|Responsibility                      |Team Member(s)              |
|------------------------------------|----------------------------|
|Conducting Meetings                 |Sam                         |
|Maintaining Team Assignment List    |Conner                      |
|Ensuring GitHub is Working          |Michael                     |
|Maintaining Documentation           |Michael                     |
|Create & Display Presentations      |Spencer                     |
|Submit Team Assignments             |Spencer                     |

## Connect and find nearby devices

Run `node server.cjs` (Node.js 20+, or use `npm start`) and open `http://localhost:3000`.
For two physical devices, serve the Node app over HTTPS. An ordinary HTTP LAN
address cannot request microphone and location access in most browsers.

1. Enter a display name and click **Connect**.
2. Allow **both microphone and location**. Neither is requested on page load.
3. Wait at least **five seconds after both permissions succeed**. The scanner
   also waits for MeshClient's first audio feature packet and server readiness.
   There is no new scanning animation.
4. The nearby-device list opens. Open Parachute on another device, follow the
   same steps, and wait for the room match and name exchange.
5. Click **Drop parachute** to offer files or a link to everyone currently nearby.
   Each recipient gets their own parachute. File transfer starts only after
   their parachute finishes entering their box. Missed offers expire.
6. Use **Received** to save files or open links. The rocket and parachute
   delivery animations still work.

Each recipient has an independent transfer. One missed or disconnected recipient
does not stop the others. Devices discovered after sending do not receive that offer.
If a room match disappears during an offer or transfer, Parachute keeps that sharing
connection and checks whether the relay can still reach the recipient. Its row
is marked "room signal changed"; detector results themselves are not changed.
Actual relay failures, server disconnection, and transfer timeouts still stop
the transfer. New devices must still be discovered before they can send offers.
**Cancel send** withdraws outstanding outgoing offers. **Stop discovery** reloads the page to release the
microphone, because the upstream singleton does not expose microphone cleanup or
reconnection. Save received files before stopping or reloading.

## Hosted MeshClient

`mesh-loader.js` imports the live `mesh-client.js` from the detector's GitHub
Pages repository when Parachute is opened on `https://21beckem.github.io`.
The detector's GitHub URL redirects to its custom domain. A small local worker
bootstrap imports the hosted audio worker so the browser's worker-origin rule
is satisfied. The real analyzer modules, model JSON, WASM, and microphone
worklet continue loading from the detector host; none are copied here.
GitHub Pages needs no Node server and no `/mesh-runtime/` route. The default hosted
WebSocket server remains the source of truth. NoSleep uses the upstream demo's CDN.

For local development and other Node hosts, the loader uses the existing
`server.cjs` asset bridge. That bridge changes only the upstream
`isHostedLocally` flag to `false` so localhost uses the default hosted detector
rather than port 8787. Assets have a 60-second memory cache. Other static hosts
need the same origin as the detector or an equivalent asset bridge.

Microphone and location access require HTTPS (localhost is the development
exception). An internet connection and the upstream hosted service are required.
The welcome screen shows when the scanner is ready or could not load. A startup
failure restores the Connect button and offers a reload, rather than leaving
it disabled. Camera descent still follows successful discovery startup and the
five-second window after both permissions succeed.

MeshClient makes the microphone and location requests itself; Parachute observes
those same requests to time the five-second window. It does not request either
sensor a second time. Location gets up to 30 seconds and can use a position from
the last 60 seconds. A failed lookup distinguishes blocked access, unavailable
location, and timeout. Failed startup releases the captured microphone tracks.

Discovery compares ambient room sound, not emitted tones. Audio features are
prepared locally and sent to the detector for matching. Display names are
exchanged with matched devices through `relayMessage()`. JSON transfer messages
use `relayMessage()` and binary file chunks use `relay()`. Files pass through the
hosted server rather than a PeerJS/WebRTC data channel.

Future scanning animations can listen for `discovery-warmup-start` (with
`durationMs` and `startedAt`), `discovery-warmup-end`, and
`discovery-warmup-error` events on `window`. The end event means both the minimum
five-second window and MeshClient readiness have completed; it does not mean a
nearby match has already been found.

## How file and link sharing works

`connection.js` adapts each nearby MeshClient peer to the transfer protocol. `sharing.js` handles
file selection, box catches, per-recipient progress, and download links. `transfer.js`
handles the content protocol independently of the animations.

1. **Offer:** send the display name and file names, sizes, and MIME types, or the
   website URL. The rocket launches once, and each nearby device gets an offer.
   No file bytes are read or sent before that recipient catches it.
2. **Catch:** drag the parachute into the box. Only when its entry animation
   finishes does the recipient send approval. There is no separate Accept dialog.
   Falling offscreen or waiting 60 seconds expires the offer.
3. **Chunks:** read files in 64 KiB slices with `File.slice().arrayBuffer()`.
   Send one binary slice at a time and wait for a `chunk-received` reply before
   reading the next. This keeps queued data bounded and supplies progress.
   The recipient sees a bobbing parcel and a real percentage while the file
   arrives. Each incoming transfer has its own indicator.
4. **Finish:** the receiver checks every file's byte count, rebuilds each `File`,
   adds it to Received, and sends `complete`. Only then does the sender report
   delivered. Byte counts catch incomplete app-level transfers; the relay carries binary
   data over the service connection. A large icon of the completed delivery
   appears and immediately zooms into the box; only then does the box play its
   receipt effect. Catching the initial metadata parachute is not a file receipt.
5. **Save:** `URL.createObjectURL(file)` creates a local download address for an
   anchor with the `download` attribute. The receiver clicks it to save. Links
   allow only HTTP/HTTPS and open only when clicked. Remote text uses
   `textContent`, never HTML insertion. File names cannot contain path separators.

Received uses the existing payload artwork on cards with the sender, receipt
time, file size, and action. Multi-file transfers appear as an expandable box
package, with a separate card for each file inside. Click an item once to download
it or open its link. Photos use a small local thumbnail; unsupported images fall
back to the picture artwork. Duplicate file names or URLs receive #1, #2, etc.
labels while preserving original download names. Removing an earlier duplicate
does not renumber the remaining items. Preview and download share one object URL,
which is released when the entry is removed or the page exits.

While an offer or transfer is active, each peer is checked every two seconds
with a three-second reachability timeout. A lost room-sound match alone does
not withdraw an available file. A confirmed relay failure or departure notice
removes that sender's parachute and any incomplete loading indicator immediately.
Normal exits send a best-effort departure notice before disconnecting; sudden
network loss can take about five seconds to detect (longer if the browser
throttles background timers). Completed Received items stay available locally.

For a sensor-free Received design preview, run `node tests/received-preview.cjs`
and open `http://localhost:3004`. It uses sample files and the project's mockup image.
Add `?arrival-preview` to pause the large icon for inspection, then use
**Finish arrival preview** to watch it zoom into the box. This pause control
exists only in the local fixture.

The version-2 messages are `offer`, `accept`, `decline`, `chunk`,
`chunk-received`, `finish`, `complete`, and `cancel`. A random transfer ID ties
replies to the correct send. Each chunk includes file index, byte offset, sequence
number, and binary bytes.

Limits: 20 files, 100 MiB (shown as 100 MB in the UI) per transfer; 100 MiB total
retained or reserved for accepted incoming transfers, and 100 retained transfers per tab.
At most 20 pending parachutes are shown. Zip ordinary folders
first. The browser retains received content in memory until Remove, page exit,
or refresh; save it first. Remove revokes download URLs. Transfers are not resumable. Disconnects, cancellation,
invalid chunks, or inactivity abort incomplete transfers. There is a 60-second
acceptance timeout and a 30-second wait for each acknowledgment. A sender using
an old page that does not support this protocol will time out; refresh both pages.

Run `npm test` for nearby discovery, permission timing, consent, binary relay
adaptation, file transfer, animation, and asset-server checks. Connection tests
use a simulated mesh to test the app independently of live microphone hardware.
The historical `peerjs-test.html` and `tests/peerjs-browser.cjs` remain as reference
examples only; the main app no longer loads or uses PeerJS. Real same-room
matching still needs a two-device check against the hosted service.

For a browser-only UI check, run `node tests/mesh-preview.cjs` and open
`http://localhost:3001` in two tabs. This fixture uses fake permissions and a
simulated mesh, so it does not access the microphone or location or test the
real detector. The normal website at port 3000 always uses the hosted module.

To exercise the real hosted detector and audio/WASM pipeline, run
`node tests/detector-preview.cjs` and open `http://localhost:3002`. It uses generated
sound and a test position at 0,0, which are sent to the hosted detector; it does
not access real sensors. Add `?location-timeout=1` to test the location-error UI.

## Animation API

Load `parachute.js` with `defer` after the page markup. Once loaded, the shared
`window.animation` API can be called from any script, module, or event handler.
Each drop creates an independent parachute; repeated calls do not replace active
ones. Methods are bound, so passing `animation.dropMusic` directly as a callback
also works. `initialize()` is safe to repeat.

```js
animation.dropFile();       // Paper document
animation.dropFolder();     // Zipped folder
animation.dropMusic();      // Music tile
animation.dropLink();       // Chain link
animation.dropPicture();    // Framed landscape
animation.dropVideo();      // Film and play button
animation.dropOther();      // Parcel for other content

// Optional payloads are kept locally and returned when the box receives them.
const delivery = animation.dropMusic(audioFile);
animation.dropLink('https://example.com');
animation.dropParachute(file); // Infer artwork from MIME type or extension
animation.dropParachute(files); // Multiple files use the folder artwork

// Independent hooks used by the connection lifecycle (no file required).
animation.startConnecting(); // Loop glow, engine flicker, and smoke on the pad
await animation.launchRocket(); // Call when connected; stop preparation and fly
animation.stopConnecting(); // Call on cancellation/failure to return to idle

// Optional: remove a specific drop without affecting any others.
delivery.cancel();
```

Releasing the pointer anywhere on the main box lifts that same delivery above
the rim, then lowers it in front of the dark interior and behind the front panel.
The flaps close only after the delivery is completely inside. The sequence
then emits `file-received` on `.drop-box`, with the
original payload array in `event.detail.files`. Offer deliveries also use
`onCatch` after entry and `onExpire` on cancellation or a miss. Sharing uses
these callbacks to approve or expire the offer. Received stays closed until
the user opens it, so another incoming parachute can still be caught.
The animations themselves do not transmit data.
`window.animation` provides the public methods. `window.ParachuteAnimation`
exposes the controller class.

Drag and release to throw a delivery left or right; gentle drag reduces its
momentum as it falls. Both side walls bounce thrown deliveries back into view,
including their rotated canopy. Missed deliveries pass behind the table, leave below the viewport,
and remove their DOM nodes, event listeners, and animation frames. Space pauses
or resumes, arrow keys move the focused delivery, and Enter receives it when its
payload is over the main box. While dragging, the parachute appears in front of
the box and table; releasing restores its usual layer. Pointer drops use the
mouse/touch position rather than the trailing artwork. The box closes on receipt
and reopens three seconds after the latest receipt.

The drop button stays on the pad throughout both rocket animations. The peer
controller uses the independent connection hooks so preparation continues until
the connection succeeds or is cancelled. `launchRocket()` only plays the launch
animation; `sharing.js` starts it when broadcasting the offer.

Run controller and physics checks with `node --test tests/animation.test.cjs`.


## Real relay regression check

Run `node tests/relay-preview.cjs` and open `http://localhost:3003` in three tabs.
This uses the real hosted MeshClient and JSON/binary relays, with generated audio,
a test position, and controlled discovery notices. No real sensors are accessed.
Offer a file without selecting a recipient. Catch it in one receiver's box and
let the other miss. Check that only the catcher receives the intact file and
the sender reports one received and one expired. Send a link back and catch it.
The **Hide test room match** control in fixture dialogs can also test an active
transfer surviving a temporary discovery change.
The matching controls exist only in this local test harness.
Open the sender with `?relay-delay=1500` to delay each binary chunk by 1.5 seconds
and inspect the loading progress. Uncaught offers still appear without that delay.
Send another offer, then stop discovery on the sender: outstanding parachutes
should disappear on both recipients, and completed downloads should remain.
