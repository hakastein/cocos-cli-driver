import test from 'node:test';
import assert from 'node:assert/strict';

import {
    sceneClasses, sceneClose, sceneDirty, sceneInfo, sceneMissing, sceneOpen, sceneOwners,
    sceneReload, sceneSave, sceneTree
} from '../src/commands/scene.ts';
import { present } from '../src/render/present.ts';
import { MemoryDriver } from '../src/driver/memory.ts';

const treeOutput = async (...args) => present(await sceneTree(...args));

const TWO_NODES = {
    name: 'main',
    nodes: [{ name: 'Canvas', components: [{ type: 'Canvas' }],
        children: [{ name: 'Bg', components: [{ type: 'Sprite' }] }] }]
};

// A head line counting the nodes would only give back the number of lines under it.
test('the tree is built from the dump and gets no count above it', async () => {
    const output = await treeOutput(new MemoryDriver(TWO_NODES), {});
    assert.equal(output.stderr, undefined);
    assert.match(output.stdout, /Canvas {2}\[Canvas\]/);
    assert.match(output.stdout, /Bg {2}\[Sprite\]/);
    assert.doesNotMatch(output.stdout, /nodes: 2/);
});

test('a refusal from the scene script surfaces as an error carrying its own text', async () => {
    await assert.rejects(() => sceneTree(new MemoryDriver(), {}), /no scene is open/);
});

test('a dump with no nodes does not pretend to be a tree', async () => {
    const output = await treeOutput(new MemoryDriver({ nodes: [] }), {});
    assert.equal(output.stderr, undefined);
    assert.match(output.stdout, /empty|no nodes/i);
});

test('info names the scene and its node count on one line', async () => {
    const nodes = Array.from({ length: 42 }, (unused, index) => ({ name: `N${index}` }));
    const text = present(await sceneInfo(new MemoryDriver({ name: 'main', nodes }))).stdout;
    assert.match(text, /main/);
    assert.match(text, /42/);
});

const dirtyScene = () => new MemoryDriver({
    nodes: [{ name: 'Canvas', components: [{ type: 'Canvas' }] }],
    dirty: {
        differsFromDisk: true,
        scenePath: 'db://assets/main.scene',
        diffs: [{ path: 'Canvas._lpos', kind: 'changed', disk: 0, live: 12 }]
    }
});

test('owners asks with the class and takes the active-only flag as its inverse', async () => {
    const driver = new MemoryDriver({
        nodes: [{ name: 'Canvas', components: [{ type: 'Canvas' }] }]
    });
    const output = present(await sceneOwners(driver, { className: 'Canvas', activeOnly: true }));
    assert.match(output.stdout, /Canvas/);
    const asked = driver.calls.find(call => call.name === 'findComponentOwners');
    assert.deepEqual(asked.args[0], { className: 'Canvas', includeInactive: false });
});

test('without --active-only the listing includes nodes switched off', async () => {
    const driver = new MemoryDriver({ nodes: [{ name: 'Canvas', components: [{ type: 'Canvas' }] }] });
    await sceneOwners(driver, { className: 'Canvas' });
    assert.equal(driver.calls.find(call => call.name === 'findComponentOwners').args[0].includeInactive, true);
});

test('dirty names the file the open scene differs from and where', async () => {
    const output = present(await sceneDirty(dirtyScene()));
    assert.match(output.stdout, /differs from disk/);
    assert.match(output.stdout, /Canvas\._lpos/);
});

test('a scene matching its file says so instead of listing nothing', async () => {
    const output = present(await sceneDirty(new MemoryDriver({ nodes: [] })));
    assert.doesNotMatch(output.stdout, /differs from disk/);
});

test('missing lists the component slots whose script no longer resolves', async () => {
    const driver = new MemoryDriver({
        nodes: [{ name: 'Canvas' }],
        missingScripts: [{
            nodePath: 'Canvas', nodeUuid: 'n-1', componentUuid: 'c-1', cid: 'abc'
        }]
    });
    assert.match(present(await sceneMissing(driver, {})).stderr, /Canvas/);
});

// --root is a node path, and the scene script takes a uuid: an unresolved path would scan the
// whole scene and answer about nodes nobody asked about.
test('--root reaches the scene as a resolved uuid rather than as the path', async () => {
    const driver = new MemoryDriver({
        nodes: [{ name: 'Canvas', children: [{ name: 'Bg' }] }], missingScripts: []
    });
    await sceneMissing(driver, { root: 'Canvas/Bg' });
    const asked = driver.calls.find(call => call.name === 'dumpMissingScripts');
    assert.deepEqual(asked.args[0], { rootUuid: driver.uuidOf('Canvas/Bg') });
});

test('without --root the scene is scanned whole, with no rootUuid invented for it', async () => {
    const driver = new MemoryDriver({ nodes: [{ name: 'Canvas' }], missingScripts: [] });
    await sceneMissing(driver, {});
    assert.deepEqual(driver.calls.find(call => call.name === 'dumpMissingScripts').args[0], {});
});

const SCENE_ON_DISK = {
    name: 'main',
    uuid: '0ba73f57-eedc-484a-89e4-20aeef0b73fc',
    nodes: [{ name: 'Canvas' }],
    assets: { 'db://assets/main.scene': '0ba73f57-eedc-484a-89e4-20aeef0b73fc' }
};

// `open-scene` forwards whatever it is given, and a url is not a uuid: the editor loads nothing
// and leaves a fresh scene behind.
test('open resolves a db:// url to a uuid before the editor is told to open it', async () => {
    const driver = new MemoryDriver(SCENE_ON_DISK);
    const output = present(await sceneOpen(driver, { target: 'db://assets/main.scene' }));
    assert.match(output.stdout, /^opened db:\/\/assets\/main\.scene/);
    assert.equal(driver.calls.find(call => call.name === 'scene.openScene').args[0],
        '0ba73f57-eedc-484a-89e4-20aeef0b73fc');
});

test('open by uuid names the url back, so the answer says which file was opened', async () => {
    const output = present(await sceneOpen(new MemoryDriver(SCENE_ON_DISK),
        { target: '0ba73f57-eedc-484a-89e4-20aeef0b73fc' }));
    assert.match(output.stdout, /^opened db:\/\/assets\/main\.scene/);
});

test('an address the database does not know is refused before the editor is told anything', async () => {
    const driver = new MemoryDriver(SCENE_ON_DISK);
    const output = present(await sceneOpen(driver, { target: 'db://assets/gone.scene' }));
    assert.equal(output.stdout, undefined);
    assert.match(output.stderr, /^FAILED/);
    assert.match(output.stderr, /db:\/\/assets\/gone\.scene/);
    assert.equal(output.exitCode, 1);
    assert.equal(driver.calls.some(call => call.name === 'scene.openScene'), false);
});

// The editor answers an address it cannot load with a new, never-saved scene and no error at all.
test('a scene other than the one asked for left open is a failure rather than an ok', async () => {
    const driver = new MemoryDriver({
        ...SCENE_ON_DISK,
        opensAs: { '0ba73f57-eedc-484a-89e4-20aeef0b73fc': '3e7bbb9e-ee77-4dac-bb0b-ef4ff2693369' }
    });
    const output = present(await sceneOpen(driver,
        { target: 'db://assets/main.scene', poll: { timeoutMs: 20, intervalMs: 5 } }));
    assert.match(output.stderr, /^FAILED/);
    assert.match(output.stderr, /3e7bbb9e-ee77-4dac-bb0b-ef4ff2693369/);
    assert.equal(output.exitCode, 1);
});

test('a prefab shown inside a scene of its own is the prefab open', async () => {
    const prefab = '3a8f811f-87e7-4db0-96b2-2ac46503c65b';
    const driver = new MemoryDriver({
        ...SCENE_ON_DISK,
        assets: { ...SCENE_ON_DISK.assets, 'db://assets/cc_hero.prefab': prefab },
        shownIn: { [prefab]: 'bdek5w61xETJRSLGMfiJ3c' }
    });
    const output = present(await sceneOpen(driver,
        { target: 'db://assets/cc_hero.prefab', poll: { timeoutMs: 20, intervalMs: 5 } }));
    assert.match(output.stdout, /^opened db:\/\/assets\/cc_hero\.prefab/);
    assert.equal(output.exitCode, 0);
});

// A chain of commands has to stop on a scene nobody could confirm is open, rather than build the
// next step on it.
test('a scene script that will not say which scene is open is UNVERIFIED and non-zero', async () => {
    const driver = new MemoryDriver({
        ...SCENE_ON_DISK, refuses: { getCurrentSceneInfo: 'the scene worker is reloading' }
    });
    const output = present(await sceneOpen(driver,
        { target: 'db://assets/main.scene', poll: { timeoutMs: 20, intervalMs: 5 } }));
    assert.equal(output.stdout, undefined);
    assert.match(output.stderr, /^UNVERIFIED/);
    assert.match(output.stderr, /the scene worker is reloading/);
    assert.equal(output.exitCode, 3);
});

test('save goes through the editor rather than writing the file itself', async () => {
    const driver = new MemoryDriver({ nodes: [] });
    assert.equal(present(await sceneSave(driver)).stdout, 'scene saved');
    assert.equal(driver.calls.filter(call => call.name === 'scene.saveScene').length, 1);
});

test('close says so when the editor closed the scene', async () => {
    const output = present(await sceneClose(new MemoryDriver({ nodes: [] })));
    assert.match(output.stdout, /scene closed/);
    assert.equal(output.exitCode, 0);
});

// `close-scene` answers a boolean and the editor says `false` when it keeps the scene open; an
// unread answer would print `ok` over a scene that is still there.
test('close refused by the editor is a failure, not an ok', async () => {
    const output = present(await sceneClose(new MemoryDriver({ nodes: [], closeScene: false })));
    assert.equal(output.stdout, undefined);
    assert.match(output.stderr, /^FAILED/);
    assert.equal(output.exitCode, 1);
});

test('reload answers what it did and nothing about what a reload is', async () => {
    const output = present(await sceneReload(new MemoryDriver({ nodes: [] })));
    assert.equal(output.stdout, 'components of the open scene reloaded');
    assert.equal(output.stderr, undefined);
});

const registry = () => new MemoryDriver({
    nodes: [],
    registeredClasses: { 'cc.Component': ['cc.Component', 'cc.Sprite', 'cc.SpriteComponent'] }
});

test('classes lists what the engine registers under the base, the base included', async () => {
    const output = present(await sceneClasses(registry(), { base: 'cc.Component' }));
    assert.match(output.stdout, /cc\.SpriteComponent/);
    assert.match(output.stdout, /cc\.Component/);
    assert.equal(output.stderr, undefined);
});

test('a base nothing extends answers an empty listing rather than the whole registry', async () => {
    const output = present(await sceneClasses(registry(), { base: 'cc.Asset' }));
    assert.equal(output.stdout, 'no class matched');
    assert.equal(output.stderr, undefined);
});
