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
5. Choose a named device, then click **Drop parachute** to send files or a link.
   The recipient must accept before file bytes are sent.
6. Use **Received** to save files or open links. The rocket and parachute
   delivery animations still work.

The list can show several nearby devices; sharing targets one person at a time.
Incoming offers from another matched device select that sender when you are idle.
Other offers are declined while a transfer is pending or active. A lost match or
server disconnection cancels the selected session. **Clear selection** leaves
nearby discovery running. **Stop discovery** reloads the page to release the
microphone, because the upstream singleton does not expose microphone cleanup or
reconnection. Save received files before stopping or reloading.

## Hosted MeshClient

`connection.js` imports only
`/mesh-runtime/durable-object-server/mesh/mesh-client.js`. Its dependencies load
automatically. `server.cjs` streams the modules, audio worker/worklet, model JSON,
and WASM from the repository's live GitHub Pages site. No detection code or model
is copied into this checkout, and no detection server is deployed. Assets have a
60-second memory cache; reload after upstream changes. NoSleep is loaded from the
same CDN used by the upstream demo.

The asset bridge is required because browser workers must be created from this
website's origin. It changes only the upstream `isHostedLocally` flag to `false`
so localhost uses the default hosted WebSocket server defined by MeshClient,
rather than expecting a separate detector on port 8787. The server address stays
in the upstream module. Other detection and protocol code is served unchanged.
If that module's local-host setting changes shape, the bridge returns an error
instead of silently connecting to a wrong endpoint.

Run this Node server in production as well: plain static hosting does not provide
`/mesh-runtime/`. Microphone and location access require HTTPS (localhost is the
local-development exception). An internet connection and the upstream hosted
service are required.

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

`connection.js` adapts the selected MeshClient peer to the transfer protocol. `sharing.js` handles
file selection, incoming approval, progress, and download links. `transfer.js`
handles the content protocol independently of the animations.

1. **Offer:** send the display name and file names, sizes, and MIME types, or the
   website URL. No file bytes are sent until the other person accepts.
2. **Accept:** the recipient approves; the sender launches the rocket.
3. **Chunks:** read files in 64 KiB slices with `File.slice().arrayBuffer()`.
   Send one binary slice at a time and wait for a `chunk-received` reply before
   reading the next. This keeps queued data bounded and supplies progress.
4. **Finish:** the receiver checks every file's byte count, rebuilds each `File`,
   adds it to Received, and sends `complete`. Only then does the sender report
   delivered. Byte counts catch incomplete app-level transfers; the relay carries binary
   data over the service connection.
5. **Save:** `URL.createObjectURL(file)` creates a local download address for an
   anchor with the `download` attribute. The receiver clicks it to save. Links
   allow only HTTP/HTTPS and open only when clicked. Remote text uses
   `textContent`, never HTML insertion. File names cannot contain path separators.

The version-2 messages are `offer`, `accept`, `decline`, `chunk`,
`chunk-received`, `finish`, `complete`, and `cancel`. A random transfer ID ties
replies to the correct send. Each chunk includes file index, byte offset, sequence
number, and binary bytes.

Limits: 20 files, 100 MiB (shown as 100 MB in the UI) per transfer; 100 MiB total
retained in Received and 100 retained transfers per tab. Zip ordinary folders
first. The browser retains received content in memory until Remove, page exit,
or refresh; save it first. Remove revokes download URLs and cancels that entry's
remaining animation. Transfers are not resumable. Disconnects, cancellation,
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
original payload array in `event.detail.files`. The sharing controller listens
for this event to open Received. The animations themselves do not transmit data.
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
animation; `sharing.js` starts it after the recipient accepts.

Run controller and physics checks with `node --test tests/animation.test.cjs`.
