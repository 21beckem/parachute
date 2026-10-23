# Parachute

## Team Members

Michael Becker

Sam Pickett

Spencer Ehardt

Conner Madsen

## Software Description

A Peer-to-peer file sharing application over the web with robust interactive visuals.

## Architecture

* [ ] Web tech(html/css/js)
* [x] PeerJS / WebRTC with individual page IDs

## Software Features

* [ ] File share
* [x] Two-way rocket packages and parachutes with receipt confirmations
* [ ] Keep going ....

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

## Reflections

# AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIIIIIIIEEEEEEE
(temp text)

## Microphone

Click the microphone button in the bottom-right corner and allow microphone
access when your browser prompts you. Click it again to release the microphone.
This currently enables local access only; audio is not recorded or transmitted.
Microphone access requires HTTPS or `http://localhost:3000`. A plain HTTP
Same Wi-Fi address can still connect parachutes, but cannot access the microphone;
use an HTTPS deployment for microphone access on both computers.

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
5. Choose **Package artwork** and click **Drop parachute ↑** on either computer.
   Its rocket launches, and a matching parachute appears on the other computer.
   Receipt is automatic; **delivered** means the other browser acknowledged it.
6. **Disconnect** unpairs the pages and keeps their IDs available for reconnecting.
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

This milestone sends the app's rocket launch action and parachute artwork type,
with an empty payload array. The folder option selects existing folder artwork;
no file bytes, directory contents, links, or actual folders are transferred.
Example packet (the real ID is a random UUID):

```json
{
  "type": "package",
  "version": 1,
  "id": "unique-package-id",
  "rocket": { "action": "launch" },
  "parachute": { "kind": "picture", "payload": [] }
}
```

Receipts contain only `{ "type": "receipt", "version": 1, "id": "unique-package-id" }`.
Malformed packages and nonempty payloads are rejected. Duplicate package IDs
are acknowledged without creating another parachute. Sending waits for receipt,
with a ten-second timeout that reports delivery as unconfirmed. Up to 20
parachutes can be on screen at once; a full sky does not acknowledge another
package. A disconnect during rocket launch cancels that transfer.

The app uses the same default PeerJS network settings as `peerjs-test.html`.
PeerJS Cloud handles signaling; the Node server only serves static files.
The old HTTP relay and its `/api/*` connection endpoints have been removed.

Direct connections can be blocked by school Wi-Fi, NAT, or a firewall. Our
previous diagnostics found that the bundled default TURN hosts were not
resolving. This change does not add a working TURN service or bypass network
restrictions. For reliable use on restrictive networks, working TURN
configuration is a separate requirement.

Run `npm test` for controller, animation, microphone, and static server checks.
For a real two-browser test, install Playwright (`npm install --no-save playwright`)
and Microsoft Edge, then run `node tests/peerjs-browser.cjs`. This verifies
page-ID connections, packages and acknowledgments in both directions,
disconnecting without changing IDs, reconnecting, and compatibility with the
unmodified simple test page. It uses separate browser contexts on one machine;
two physical computers still need a test on the intended network.

## Animation API

Load `parachute.js` with `defer` after the page markup. Once loaded, the shared
`window.animation` API can be called from any script, module, or event handler.
Each drop creates an independent parachute; repeated calls do not replace active
ones. Methods are bound, so passing `animation.dropMusic` directly as a callback
also works. `initialize()` is safe to repeat and never starts an extra demo.

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
await animation.launchRocketWithFile(file); // Preview preparation, launch, then matching drop

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
original payload array in `event.detail.files`. The rocket emits `file-launched`
with the same shape. These animations do not transmit files or open links.
Existing `Animation.dropParachute(...)` calls remain supported; new code should
use `window.animation`. `window.ParachuteAnimation` exposes the controller class.

Drag and release to throw a delivery left or right; gentle drag reduces its
momentum as it falls. Both side walls bounce thrown deliveries back into view,
including their rotated canopy. Missed deliveries pass behind the table, leave below the viewport,
and remove their DOM nodes, event listeners, and animation frames. Space pauses
or resumes, arrow keys move the focused delivery, and Enter receives it when its
payload is over the main box. While dragging, the parachute appears in front of
the box and table; releasing restores its usual layer. Pointer drops use the
mouse/touch position rather than the trailing artwork. The box closes on receipt
and reopens three seconds after the latest receipt. Saving will be added later.

The drop button stays on the pad throughout both rocket animations. The peer
controller uses the independent connection hooks so preparation continues until
the connection succeeds or is cancelled. `launchRocketWithFile` remains a legacy
local preview helper for pages that provide an upload input; it is inactive on
the main page and does not transmit files.
`launchRocket()` alone does not create a file delivery or emit `file-launched`.

Run controller and physics checks with `node --test tests/animation.test.cjs`.
