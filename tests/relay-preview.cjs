// UI regression harness: controlled discovery, real hosted MeshClient relays.
// The inherited fixture uses synthetic sound/location, never real sensors.
const { createDetectorPreview } = require('./detector-preview.cjs');
createDetectorPreview({ relayTest: true }).listen(3003, '127.0.0.1', () => {
    console.log('Real relay test with controlled room matches: http://localhost:3003');
});
