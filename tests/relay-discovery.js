// TEST ONLY. Replace discovery notices, never the hosted relay implementation.
// This script is served only by tests/relay-preview.cjs.
(() => {
    const loadHostedMesh = window.loadParachuteMesh;
    let toggle;
    for (const dialog of document.querySelectorAll('dialog')) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Hide test room match';
        button.addEventListener('click', () => toggle?.());
        dialog.append(button);
    }
    window.loadParachuteMesh = async () => {
        const { MeshClient: real } = await loadHostedMesh();
        const bus = new BroadcastChannel('parachute-real-relay-test');
        const events = new EventTarget();
        const contacts = new Set();
        let active = false, visible = true, timer;
        const emit = (name, ...args) => events.dispatchEvent(new CustomEvent(name, { detail: args }));
        for (const name of ['initialized', 'initError', 'startError', 'relay', 'relayMessage', 'disconnected'])
            real.on(name, (...args) => emit(name, ...args));
        function showMatches(show) {
            if (visible === show) return;
            visible = show;
            for (const uid of contacts) emit(show ? 'peerAdded' : 'peerRemoved', { uid, score: show ? 1 : 0.4 });
            emit('peersUpdated');
        }
        const announce = () => bus.postMessage({ type: 'hello', uid: real.uid });
        bus.onmessage = ({ data }) => {
            if (data.type === 'matches') { showMatches(data.visible); return; }
            if (!active || data.uid === real.uid) return;
            if (data.type === 'hello' && !contacts.has(data.uid)) {
                contacts.add(data.uid);
                if (visible) { emit('peerAdded', { uid: data.uid, score: 1 }); emit('peersUpdated'); }
                announce();
            }
        };
        toggle = () => {
            showMatches(false);
            bus.postMessage({ type: 'matches', visible: false });
        };
        return { MeshClient: {
            get uid() { return real.uid; },
            get peers() { return visible ? [...contacts] : []; },
            get connected() { return real.connected; },
            get ready() { return real.ready; },
            on(name, callback) {
                const listener = (event) => callback(...event.detail);
                events.addEventListener(name, listener);
                return () => events.removeEventListener(name, listener);
            },
            init: () => real.init(),
            async begin() {
                const result = await real.begin();
                active = true;
                announce();
                timer = setInterval(announce, 1000);
                return result;
            },
            async relay(...args) {
                const delay = Math.min(3000, Math.max(0, Number(new URLSearchParams(location.search).get('relay-delay')) || 0));
                if (delay) await new Promise(resolve => setTimeout(resolve, delay));
                return real.relay(...args);
            },
            relayMessage: (...args) => real.relayMessage(...args),
            disconnect() { clearInterval(timer); bus.close(); real.disconnect(); }
        } };
    };
})();
