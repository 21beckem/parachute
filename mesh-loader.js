// Both GitHub Pages repositories share an origin, including the audio worker.
// Import the hosted client directly there; its relative dependencies load from
// the detector repository automatically. Other hosts use our Node asset bridge.
window.loadParachuteMesh = function () {
    const hostedClient = 'https://21beckem.github.io/same-room-detector/durable-object-server/mesh/mesh-client.js';
    const clientUrl = location.origin === new URL(hostedClient).origin
        ? hostedClient
        : new URL('./mesh-runtime/durable-object-server/mesh/mesh-client.js', document.baseURI).href;
    return import(clientUrl);
};
