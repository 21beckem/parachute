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
* [x] Peer.js

## Software Features

* [ ] File share
* [x] Peer 2 peer (parachute animation messages)
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

## Connect two computers

Serve this folder with a static web server, or publish it to an HTTPS static
host. Open the site on both computers with internet access. Each page gets a
unique session ID in the connection panel (refreshing creates a new ID).

1. Copy the ID on one computer and share it with the other person.
2. Paste it into **Connect to a friend** on the other computer and click **Connect**.
3. Once both pages say **Connected**, click **Drop parachute ↑** on either page.
   The rocket launches on the sender's page and a parachute arrives on the
   other page. Drag it into the receiving box as before.
4. Use **Disconnect** to end the connection, or **Cancel** while connecting.

Only one friend connects at a time. Keep both pages open. File selection is
removed from the interface; the only network message is
`{ type: 'parachute', version: 1 }`. Receiving that message invokes the existing
animation with an empty payload. Other message types and extra fields are ignored.

PeerJS 1.5.5 is bundled in `vendor/` with its MIT license. Its default public
PeerServer Cloud brokers connections; WebRTC carries the animation command
between browsers. No application backend or build step is needed. Some
firewalls/NAT configurations can block direct connections; the panel provides
timeouts and retry. A production deployment may need its own signaling and
TURN service for those networks. See the [PeerJS documentation](https://peerjs.com/client/getting-started).

Run checks with `node --test tests/*.test.cjs`.

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
