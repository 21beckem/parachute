const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../welcome.js'), 'utf8');

function setup(begin) {
    const nodes = new Map(), classes = new Set(), timers = [];
    function element(id) {
        if (!nodes.has(id)) nodes.set(id, {
            listeners: {}, value: 'Test user', textContent: '', offsetWidth: 200, offsetLeft: 0, offsetTop: 0,
            offsetParent: { offsetLeft: 0, offsetTop: 0 },
            addEventListener(name, fn) { this.listeners[name] = fn; },
            querySelector: () => ({ focus() {} }), setCustomValidity() {}, reportValidity() {}, blur() {}, removeAttribute() {}
        });
        return nodes.get(id);
    }
    const body = {
        classList: { add: (...names) => names.forEach(name => classes.add(name)), contains: name => classes.has(name) },
        style: { setProperty() {} }
    };
    const window = { addEventListener() {}, parachuteConnection: { begin, stopDiscovery() {} } };
    vm.runInNewContext(source, {
        window, document: { body, getElementById: element, querySelector: element },
        sessionStorage: { getItem: () => '', setItem() {} },
        matchMedia: () => ({ matches: false }), innerWidth: 1000, innerHeight: 800,
        setTimeout: fn => timers.push(fn)
    });
    element('display-name').value = 'Test user';
    return { element, classes, timers, submit: () => element('welcome-form').listeners.submit({ preventDefault() {} }) };
}

test('camera pan waits for discovery readiness, then reveals the sharing scene', async () => {
    let finish;
    const s = setup(() => new Promise(resolve => { finish = resolve; }));
    const pending = s.submit();
    assert.equal(s.classes.has('has-entered'), false);
    assert.equal(s.element('welcome-connect').disabled, true);
    finish(true);
    await pending;
    assert.equal(s.classes.has('has-entered'), true, 'CSS can now pan down the camera');
    assert.equal(s.element('sharing-name').textContent, 'Test user');
    s.timers[0]();
    assert.equal(s.element('.welcome').hidden, true);
    assert.equal(s.element('main').inert, false);
    assert.equal(s.element('.header-tools').inert, false);
});

test('a startup exception restores Connect and shows the error instead of leaving the screen stuck', async () => {
    const s = setup(async () => { throw Error('detector failed to load'); });
    await s.submit();
    assert.equal(s.element('welcome-connect').disabled, false);
    assert.equal(s.element('display-name').disabled, false);
    assert.equal(s.element('welcome-connect').textContent, 'Connect');
    assert.match(s.element('welcome-status').textContent, /detector failed/);
    assert.equal(s.classes.has('has-entered'), false);
});
