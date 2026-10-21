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
* [x] PeerJS / WebRTC with shared room codes

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
2. Copy its **Shared room code**, such as `ABCD-2345`, and share it with B.
3. On B, open the badge, enter A's code under **Join a friend's room**, and
   click **Join room**. Both pages now show the same room code and **Connected**.
   Only B enters the code; A keeps its page open as the room creator.
4. Choose **Package artwork** and click **Drop parachute ↑** on either computer.
   Its rocket launches, and a matching parachute appears on the other computer.
5. Packages are received automatically. The recipient shows a receipt message;
   the sender shows **delivered** only after the recipient acknowledges it.
   Dragging the parachute into the box is an optional animation after receipt.
6. **Disconnect** creates a fresh room. **Retry** recovers from a connection
   failure with a fresh room code. Share the new code to reconnect.

Rooms hold two computers. A third visitor cannot replace the connected friend.
Room codes are temporary; keep both pages open. The dropdown closes when clicking
outside it or pressing Escape.

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

PeerJS uses its bundled default STUN/TURN services, including TURN relays for
networks that block direct peer connections. Public signaling and relay
availability are external dependencies. For deployment-specific signaling or
TURN credentials, set `window.PARACHUTE_PEER_OPTIONS` in a script before
`connection.js` loads. Supply PeerJS options, including `config.iceServers`;
obtain short-lived TURN credentials from your own service for a production app.
A restrictive network may still block these services; the interface reports
connection failures instead of claiming success.

Verification: separate Edge browser contexts connected through PeerJS Cloud,
exchanged picture and music packages in both directions, confirmed receipt,
and detected disconnects. Forcing PeerJS's bundled public TURN servers timed
out in the test environment. Cross-network connectivity through a relay is
therefore unverified and needs a working TURN service before it can be relied
on for restrictive networks.

The older `/api/*` HTTP relay remains available for compatibility, but the app's
connection controller does not use it.

Run `npm test` for controller, animation, microphone, and HTTP server checks.
For a real two-browser test, install Playwright (`npm install --no-save playwright`)
and Microsoft Edge, then run `node tests/peerjs-browser.cjs`. Set
`PARACHUTE_TEST_RELAY=1` to force TURN and test the relay path. This checks separate
browser contexts on one machine; physical computers on different networks
should also be tested using the steps above.

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
