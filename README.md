# Parachute

## Team Members

Michael Becker

Sam Pickett

Spencer Ehardt

Conner Madsen

## Software Description

A Peer-to-peer file sharing application over the web with robust interactive visuals.

## Architecture

* [x] HTML, CSS, and JavaScript
* [x] PeerJS / WebRTC with individual page IDs

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

## Welcome screen

Enter a display name and click **Connect** to pan from the higher sky down to
the sharing scene. The title moves into the top-left corner during the descent.
The name is kept for this tab's session and displayed beside the connection badge;
it is separate from the PeerJS page ID. Your display name accompanies each file or link offer.

The explanation beneath the form previews location and quiet audio signals for
future nearby discovery. The welcome Connect button does not request either
permission.
Reduced-motion preferences skip the pan and keep clouds still.

## Connect two computers

Run `npm start` (Node.js 20+) and open `http://localhost:3000`.
For computers on different networks, serve this folder on a public HTTPS site
and open it on both computers. Static hosting works too: PeerJS Cloud provides
signaling, and packages use a reliable WebRTC data channel. Each computer can
also run its own local server; they do not need to share a Node server.

1. Open the connection badge at the top right on computer A.
2. Copy **Your page ID** and share the complete ID with B.
3. On B, open the badge, paste A's ID under **Your friend's page ID**, and
   click **Connect**. Only one person needs to initiate the connection.
4. Both badges show **Connected** once the actual data channel opens. Each page
   keeps its own ID, and the other person's ID appears in the friend's ID field.
5. Click **Drop parachute**, choose files or enter a full website URL, then click
   **Send files** or **Send link**. The recipient sees your name and the contents
   and chooses **Accept** or **Decline**. After acceptance, the rocket launches.
6. Open **Received** on the other computer to save each file or open the link.
   A matching parachute also arrives; catching it in the box opens Received.
   Missing the parachute does not lose the transfer.
7. **Disconnect** unpairs the pages and keeps their IDs available for reconnecting.
   **Retry** restarts PeerJS after a service failure and generates a new ID.

The connection core matches `peerjs-test.html`: `new Peer({ debug: 2 })`,
`peer.on('open', id => ...)`, `peer.connect(otherId)`, and
`peer.on('connection', conn => ...)`. There are no rooms or connection codes,
and no custom metadata is required to connect. The simple test page and the
main page can establish a data connection with each other; only the main app
understands rocket/parachute packages.

IDs identify a browser page session, not a physical computer or hardware ID.
Refreshing creates a new ID. Copy the full ID exactly, including capitalization
and hyphens. Keep both pages open. Only one friend connects at a time; another
incoming connection cannot replace an existing friend. Clicking outside the
dropdown or pressing Escape closes it.

## How file and link sharing works

`connection.js` establishes the PeerJS/WebRTC data channel. `sharing.js` handles
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
   delivered. WebRTC provides transport integrity; byte counts catch incomplete
   app-level transfers, rather than replacing transport integrity checks.
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

Files travel over the peer data channel, rather than being uploaded to this
Node server. PeerJS signaling introduces the peers; a configured TURN service
may relay encrypted WebRTC traffic when a direct connection is unavailable.
See the [PeerJS DataConnection documentation](https://peerjs.com/client/api/data-connection).

The app uses the same default PeerJS network settings as `peerjs-test.html`.
PeerJS Cloud handles signaling; the Node server only serves static files.

Direct connections can be blocked by school Wi-Fi, NAT, or a firewall.
Restrictive networks may need a working TURN relay.

Run `npm test` for connection, animation, file transfer, and static server checks.
For a real two-browser test, install Playwright (`npm install --no-save playwright`)
and Microsoft Edge, then run `node tests/peerjs-browser.cjs`. This verifies
page-ID connections, files and links in both directions,
disconnecting without changing IDs, reconnecting, and compatibility with the
unmodified simple test page. It uses separate browser contexts on one machine;
two physical computers still need a test on the intended network.

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
