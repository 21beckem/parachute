// Import only the live MeshClient. Its GitHub URL can redirect to a custom host.
window.loadParachuteMesh = async function () {
    const hostedClient = 'https://21beckem.github.io/same-room-detector/durable-object-server/mesh/mesh-client.js';
    const clientUrl = location.origin === new URL(hostedClient).origin
        ? hostedClient
        : new URL('./mesh-runtime/durable-object-server/mesh/mesh-client.js', document.baseURI).href;
    const NativeWorker = window.Worker;
    class MeshWorker extends NativeWorker {
        constructor(url, options) {
            const target = new URL(url, document.baseURI);
            if (options?.type !== 'module' || target.origin === location.origin) {
                super(url, options);
                return;
            }
            // The worker entry must belong to this page's origin. This tiny
            // bootstrap imports the actual hosted worker, preserving all its
            // relative imports, model URLs, and WASM URLs on the detector host.
            const bootstrap = URL.createObjectURL(new Blob([
                `import ${JSON.stringify(target.href)};`
            ], { type: 'text/javascript' }));
            try { super(bootstrap, options); }
            catch (error) { URL.revokeObjectURL(bootstrap); throw error; }
            const release = () => URL.revokeObjectURL(bootstrap);
            this.addEventListener('message', release, { once: true });
            this.addEventListener('error', release, { once: true });
        }
    }
    // MeshClient constructs its worker during module evaluation. Restore the
    // native browser API after that evaluation succeeds or fails.
    window.Worker = MeshWorker;
    try { return await import(clientUrl); }
    finally { window.Worker = NativeWorker; }
};
