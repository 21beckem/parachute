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
* [x] Shared Node.js relay with connection codes

## Software Features

* [ ] File share
* [x] Two-computer connections (parachute animation messages)
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

Run `node server.cjs` from this folder with Node.js 20 or later. There are no
dependencies to install. `npm start` also works if npm is installed.
The server serves both the website and the shared connection service.

For two computers on the **same Wi-Fi**, open the **Same Wi-Fi** URL printed
in the terminal on both computers (for example `http://192.168.1.25:3000`).
Keep the server running. If Windows asks, allow Node on your private network.
The other computer must use this network address; its own `localhost` points
to itself. Guest Wi-Fi may isolate devices; use a network that allows them
to reach the computer running the server.

For computers on **different networks**, deploy this folder to a Node-capable
host with start command `node server.cjs`, and open the same public HTTPS URL
on both computers. The server honors the host's `PORT` environment variable.
Use one running server instance; connection codes live in its memory and reset
when it restarts. If using a reverse proxy, preserve the public Host header,
disable buffering for `/api/events`, and allow long-running event streams.
Static-only hosting (including GitHub Pages), opening `index.html` directly,
or running separate servers on each computer does not provide a shared relay.

1. Click the connection badge at the top right to open its dropdown.
2. Copy your code (such as `ABCD-2345`) and share it with the other person.
3. On the other computer, enter that code under **Connect to a friend** and
   click **Connect**. Only one person needs to enter a code.
4. Once both badges say **Connected**, click **Drop parachute ↑** on either
   page. The rocket launches locally and a parachute arrives on the other page.
5. Use **Disconnect** to unpair, or **Retry** after losing the server connection.
   Refreshing or retrying creates a new code. Keep both pages open.

The dropdown starts closed; clicking outside it or pressing Escape closes it.
Only one friend connects at a time. File sharing is not implemented. Only the
animation command `{ type: 'parachute', version: 1 }` reaches the recipient.
The relay rejects file payloads and extra fields, and routes messages only
between the paired sessions. It uses HTTP POST and server-sent events so the
two browsers do not need a direct WebRTC connection or a TURN service.
Anyone you share your code with can connect while it is available.

Run all animation, connection-controller, and real HTTP relay checks with
`node --test tests/*.test.cjs` (or `npm test`). The relay tests open independent
client streams and verify pairing, delivery in both directions, disconnects,
invalid requests, and reconnecting. Two physical computers must still be
checked using the shared URL in your network or deployment.

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
