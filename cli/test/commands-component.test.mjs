import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
    componentAdd, componentArrayMove, componentArrayRemove, componentGet, componentRemove,
    componentReset, componentSet, componentTypes
} from '../src/commands/component.ts';
import { present } from '../src/render/present.ts';
import { MemoryDriver } from '../src/driver/memory.ts';

const fixtures = JSON.parse(
    readFileSync(fileURLToPath(new URL('./fixtures/descriptors.json', import.meta.url)), 'utf8')
);

/** A command answers with a report; the presenter turns it into lines and an exit code. */
const setOutput = async (...args) => present(await componentSet(...args));

const white = () => ({ ...fixtures.color, value: { r: 255, g: 255, b: 255, a: 255 } });

const spriteScene = (component = {}) => ({
    nodes: [{ name: 'Canvas', children: [{ name: 'Bg', components: [
        { type: 'cc.Sprite', props: { color: white() }, ...component }
    ] }] }]
});

const writeOf = (driver) => driver.calls.find(call => call.name === 'scene.setProperty').args[0];

test('a write is wrapped in an undo bracket', async () => {
    const driver = new MemoryDriver(spriteScene());
    await componentSet(driver, { node: 'Canvas/Bg', component: 'Sprite', property: 'color', value: '#ffffff' });
    const names = driver.calls.map(call => call.name);
    assert.ok(names.indexOf('scene.beginRecording') < names.indexOf('scene.setProperty'));
    assert.ok(names.indexOf('scene.setProperty') < names.indexOf('scene.endRecording'));
    assert.ok(!names.includes('scene.cancelRecording'));
});

test('the result arrives on stdout as a report rather than as a raw object', async () => {
    const output = await setOutput(new MemoryDriver(spriteScene()),
        { node: 'Canvas/Bg', component: 'Sprite', property: 'color', value: '#ffffff' });
    assert.match(output.stdout, /^cc\.Sprite\.color/);
    assert.match(output.stdout, /persisted=true/);
    assert.equal(output.stderr, undefined);
    assert.equal(output.exitCode, 0);
});

test('a write accepts the prefixed spelling and names the registered class', async () => {
    const output = await setOutput(new MemoryDriver(spriteScene()),
        { node: 'Canvas/Bg', component: 'cc.Sprite', property: 'color', value: '#ffffff' });
    assert.match(output.stdout, /cc\.Sprite\.color/);
});

test('a node without the requested component gives a refusal naming what it does carry', async () => {
    await assert.rejects(
        () => componentSet(new MemoryDriver(spriteScene()),
            { node: 'Canvas/Bg', component: 'Label', property: 'string', value: 'hi' }),
        /Sprite/);
});

test('cc.Color gets the type hint and the value arrives parsed', async () => {
    const driver = new MemoryDriver(spriteScene());
    await componentSet(driver, { node: 'Canvas/Bg', component: 'Sprite', property: 'color', value: '#ff0000' });
    assert.equal(writeOf(driver).dump.type, 'cc.Color');
    assert.deepEqual(writeOf(driver).dump.value, { r: 255, g: 0, b: 0, a: 255 });
});

test('the serializer emits a different value — persisted=false and a non-zero outcome', async () => {
    // The shape the serializer really emits for cc.Color is a channel object; here it is BLACK
    // against a written WHITE, that is, a genuine divergence.
    const driver = new MemoryDriver(spriteScene({ serialized: { color: { r: 0, g: 0, b: 0, a: 255 } } }));
    const output = await setOutput(driver,
        { node: 'Canvas/Bg', component: 'Sprite', property: 'color', value: '#ffffff' });
    assert.match(output.stderr, /persisted=false/);
    assert.equal(output.stderr.split('  ')[0], 'UNPERSISTED');
    assert.equal(output.exitCode, 4);
});

test('the serializer knows the property only under its backing-field name — both tries, found', async () => {
    const driver = new MemoryDriver({
        nodes: [{ name: 'Canvas', children: [{ name: 'Bg', components: [{
            type: 'cc.UIOpacity',
            props: { opacity: { name: 'opacity', type: 'Number', value: 255 } },
            serialized: { _opacity: 128 }
        }] }] }]
    });
    const output = await setOutput(driver,
        { node: 'Canvas/Bg', component: 'UIOpacity', property: 'opacity', value: 128 });
    assert.match(output.stdout, /persisted=true/);
});

const instancedRenderer = (prefab) => new MemoryDriver({
    nodes: [{
        name: 'Bullet',
        prefab: { asset: 'prefab-uuid', ...prefab },
        components: [{
            type: 'cc.MeshRenderer',
            props: { shadowCastingMode: { name: 'shadowCastingMode', type: 'Number', value: 0, default: 0 } }
        }]
    }]
});

const castShadow = { node: 'Bullet', component: 'cc.MeshRenderer', property: 'shadowCastingMode', value: 1 };

// Checked live 2026-08-22 on CyberCore: setting `shadowCastingMode` on a prefab instance made the
// editor record the override as `_shadowCastingMode`, which the write's own spelling never found.
test('a write finds the override the editor recorded under the backing field', async () => {
    const output = await setOutput(
        instancedRenderer({ componentOverrides: { _shadowCastingMode: ['_shadowCastingMode'] } }), castShadow);
    assert.match(output.stdout, /^cc\.MeshRenderer\.shadowCastingMode = 1/);
    assert.match(output.stdout, /persisted=true/);
    assert.match(output.stdout, /_shadowCastingMode/);
    assert.equal(output.exitCode, 0);
});

test('the backing field agreeing with the asset carries nothing, so the write stays UNPERSISTED', async () => {
    const output = await setOutput(
        instancedRenderer({ componentOverrides: { _shadowCastingMode: [] } }), castShadow);
    assert.equal(output.stderr.split('  ')[0], 'UNPERSISTED');
    assert.equal(output.exitCode, 4);
});

test('a node without the requested property gives a refusal naming the properties it has', async () => {
    await assert.rejects(
        () => componentSet(new MemoryDriver(spriteScene()),
            { node: 'Canvas/Bg', component: 'Sprite', property: 'spriteFrame', value: 'x' }),
        /color/);
});

// ----- References --------------------------------------------------------------------------

const emptyRef = () => ({ ...fixtures.nodeRef, value: { uuid: '' } });

const npcScene = (extra = {}) => ({
    nodes: [
        { name: 'Canvas', children: [{ name: 'Bg', components: [{ type: 'Npc', props: { target: emptyRef() } }] }] },
        { name: 'Characters', children: [{ name: 'hero' }] }
    ],
    ...extra
});

const targetOf = (driver) => driver.componentsOf(driver.uuidOf('Canvas/Bg'))[0].props.target.value.uuid;

test('a node path reaches the scene as a resolved uuid rather than as the path string', async () => {
    const driver = new MemoryDriver(npcScene());
    const hero = driver.uuidOf('Characters/hero');
    const output = await setOutput(driver,
        { node: 'Canvas/Bg', component: 'Npc', property: 'target', value: 'Characters/hero' });

    const plan = driver.calls.find(call => call.name === 'resolveComponentReference');
    assert.equal(plan.args[0].targetUuid, hero);
    assert.match(output.stdout, /^Npc\.target/);
    assert.equal(output.exitCode, 0);
});

test('a reference goes to the editor as a dump carrying a uuid, not as the raw --value', async () => {
    const driver = new MemoryDriver(npcScene());
    const hero = driver.uuidOf('Characters/hero');
    await componentSet(driver,
        { node: 'Canvas/Bg', component: 'Npc', property: 'target', value: 'Characters/hero' });

    assert.deepEqual(writeOf(driver).dump, { type: 'cc.Node', value: { uuid: hero } });
    assert.equal(targetOf(driver), hero);
});

test('a uuid in --value is accepted like a path and is not looked up in the scene', async () => {
    const driver = new MemoryDriver(npcScene());
    const hero = driver.uuidOf('Characters/hero');
    await componentSet(driver, { node: 'Canvas/Bg', component: 'Npc', property: 'target', value: hero });

    assert.ok(!driver.calls.some(call => call.name === 'resolveNodePaths' && call.args[0][0] === hero));
    assert.equal(targetOf(driver), hero);
});

test('an unresolvable path is refused BEFORE the write: the slot keeps its previous value', async () => {
    const driver = new MemoryDriver(npcScene());
    const hero = driver.uuidOf('Characters/hero');
    await componentSet(driver, { node: 'Canvas/Bg', component: 'Npc', property: 'target', value: hero });

    await assert.rejects(
        () => componentSet(driver,
            { node: 'Canvas/Bg', component: 'Npc', property: 'target', value: 'Characters/gone' }),
        /does not resolve/);
    assert.equal(targetOf(driver), hero);
});

test('a uuid absent from the scene is refused by the scene, and the slot stays untouched', async () => {
    const driver = new MemoryDriver(npcScene());
    const hero = driver.uuidOf('Characters/hero');
    await componentSet(driver, { node: 'Canvas/Bg', component: 'Npc', property: 'target', value: hero });
    const writesBefore = driver.calls.filter(call => call.name === 'scene.setProperty').length;

    const output = await setOutput(driver,
        { node: 'Canvas/Bg', component: 'Npc', property: 'target', value: 'zZzZzZzZzZzZzZzZzZzZzZ' });
    assert.equal(output.stdout, undefined);
    assert.equal(output.stderr.split('  ')[0], 'FAILED');
    assert.equal(output.exitCode, 1);
    assert.equal(driver.calls.filter(call => call.name === 'scene.setProperty').length, writesBefore);
    assert.equal(targetOf(driver), hero);
});

test('an asset reference is taken by db:// path through the asset database', async () => {
    const driver = new MemoryDriver({
        nodes: [{ name: 'Canvas', children: [{ name: 'Bg', components: [{
            type: 'cc.Sprite', props: { spriteFrame: { ...fixtures.emptySpriteFrame } }
        }] }] }],
        assets: { 'db://assets/ui/icon.png/spriteFrame': 'a_icon' }
    });
    await componentSet(driver, {
        node: 'Canvas/Bg', component: 'Sprite', property: 'spriteFrame',
        value: 'db://assets/ui/icon.png/spriteFrame'
    });

    assert.deepEqual(writeOf(driver).dump, { type: 'cc.SpriteFrame', value: { uuid: 'a_icon' } });
});

test('an asset is not looked up by node name — refused before the write', async () => {
    const driver = new MemoryDriver({
        nodes: [{ name: 'Canvas', children: [{ name: 'Bg', components: [{
            type: 'cc.Sprite', props: { spriteFrame: { ...fixtures.spriteFrame } }
        }] }] }]
    });
    await assert.rejects(
        () => componentSet(driver,
            { node: 'Canvas/Bg', component: 'Sprite', property: 'spriteFrame', value: 'Canvas/Bg' }),
        /db:/);
    assert.ok(!driver.calls.some(call => call.name === 'scene.setProperty'));
});

const copy = (name) => JSON.parse(JSON.stringify(fixtures[name]));

const tradeScene = () => ({
    nodes: [
        { name: 'Counter', children: [{ name: 'Sale', components: [{
            type: 'Trade',
            props: { saleAmounts: copy('numberArray'), saleCue: copy('cueSpec') },
            serialized: { saleAmounts: [600, 200, 400], saleCue: { sound: null, fx: null } }
        }] }] },
        { name: 'Audio', children: [
            { name: 'SfxSale', components: [{ type: 'SoundEmitter' }] },
            { name: 'Silent' }
        ] }
    ]
});

const tradeProps = (driver) => driver.componentsOf(driver.uuidOf('Counter/Sale'))[0].props;
const stepAt = (driver, path) =>
    driver.calls.filter(call => call.name === 'scene.setProperty')
        .map(call => call.args[0]).find(write => write.path === path);

test('an array of primitives reaches the editor as element dumps and takes the length asked for', async () => {
    const driver = new MemoryDriver(tradeScene());
    const output = await setOutput(driver,
        { node: 'Counter/Sale', component: 'Trade', property: 'saleAmounts', value: [600, 200, 400] });

    assert.deepEqual(stepAt(driver, '__comps__.0.saleAmounts').dump, {
        type: 'Integer',
        isArray: true,
        value: [
            { type: 'Integer', value: 600 },
            { type: 'Integer', value: 200 },
            { type: 'Integer', value: 400 }
        ]
    });
    assert.deepEqual(tradeProps(driver).saleAmounts.value.map(element => element.value), [600, 200, 400]);
    assert.equal(output.exitCode, 0);
});

test('a reference nested in a value class goes out as the COMPONENT uuid, not the node uuid', async () => {
    const driver = new MemoryDriver(tradeScene());
    const emitter = driver.componentsOf(driver.uuidOf('Audio/SfxSale'))[0];
    await componentSet(driver, {
        node: 'Counter/Sale', component: 'Trade', property: 'saleCue',
        value: { sound: 'Audio/SfxSale' }
    });

    assert.deepEqual(stepAt(driver, '__comps__.0.saleCue.sound').dump,
        { type: 'SoundEmitter', value: { uuid: emitter.uuid } });
    assert.notEqual(emitter.uuid, driver.uuidOf('Audio/SfxSale'));
});

test('the member the caller did not name keeps its value', async () => {
    const driver = new MemoryDriver(tradeScene());
    await componentSet(driver, {
        node: 'Counter/Sale', component: 'Trade', property: 'saleCue',
        value: { sound: 'Audio/SfxSale' }
    });
    assert.equal(stepAt(driver, '__comps__.0.saleCue.fx'), undefined);
});

test('a component uuid in a nested slot is taken as it stands', async () => {
    const driver = new MemoryDriver(tradeScene());
    const emitter = driver.componentsOf(driver.uuidOf('Audio/SfxSale'))[0];
    await componentSet(driver, {
        node: 'Counter/Sale', component: 'Trade', property: 'saleCue', value: { sound: emitter.uuid }
    });
    assert.deepEqual(stepAt(driver, '__comps__.0.saleCue.sound').dump,
        { type: 'SoundEmitter', value: { uuid: emitter.uuid } });
});

test('a node carrying two components of the nested slot class is refused BEFORE the write', async () => {
    const scene = tradeScene();
    scene.nodes[1].children[0].components.push({ type: 'SoundEmitter' });
    const driver = new MemoryDriver(scene);
    const [first, second] = driver.componentsOf(driver.uuidOf('Audio/SfxSale'));
    await assert.rejects(
        () => componentSet(driver, {
            node: 'Counter/Sale', component: 'Trade', property: 'saleCue',
            value: { sound: 'Audio/SfxSale' }
        }),
        { message: `'sound': Audio/SfxSale carries 2 components of SoundEmitter: `
            + `${first.uuid}, ${second.uuid}` });
    assert.ok(!driver.calls.some(call => call.name === 'scene.setProperty'));
});

test('a node carrying no such component is refused BEFORE the write', async () => {
    const driver = new MemoryDriver(tradeScene());
    await assert.rejects(
        () => componentSet(driver, {
            node: 'Counter/Sale', component: 'Trade', property: 'saleCue',
            value: { sound: 'Audio/Silent' }
        }),
        /SoundEmitter.*Audio\/SfxSale/s);
    assert.ok(!driver.calls.some(call => call.name === 'scene.setProperty'));
});

const FAST = { timeoutMs: 30, intervalMs: 5 };

const withGuard = () => new MemoryDriver({
    nodes: [{ name: 'Guard', components: [{ type: 'cc.Sprite' }] }],
    classes: ['cc.Sprite', 'cc.Camera']
});

test('add names the class the engine registered, not the spelling that was typed', async () => {
    const driver = withGuard();
    const output = present(await componentAdd(driver, {
        node: 'Guard', component: 'Camera', poll: FAST
    }));
    const camera = driver.componentsOf(driver.uuidOf('Guard')).find(one => one.type === 'cc.Camera');
    assert.equal(output.stdout, `cc.Camera added to Guard  ${camera.uuid}`);
});

// The editor attaches a declared requirement ahead of the class asked for, so the dependency is
// the first component to appear on the node.
const withDependency = (attaches) => new MemoryDriver({
    nodes: [{ name: 'Guard' }], classes: [], attaches
});

test('add names the class asked for, not the dependency attached ahead of it', async () => {
    const driver = withDependency({ 'cc.Sprite': ['cc.UITransform', 'cc.Sprite'] });
    const output = present(await componentAdd(driver, {
        node: 'Guard', component: 'cc.Sprite', poll: FAST
    }));
    assert.match(output.stdout, /^cc\.Sprite added to Guard {2}/);
});

test('an add no spelling of which names what appeared is UNVERIFIED, naming what did', async () => {
    const driver = withDependency({ '2f3aRk1': ['cc.UITransform', 'cc.Sprite'] });
    const output = present(await componentAdd(driver, {
        node: 'Guard', component: '2f3aRk1', poll: FAST
    }));
    assert.equal(output.stdout, undefined);
    assert.equal(output.stderr,
        'UNVERIFIED  2f3aRk1 added to Guard  the node gained cc.UITransform, cc.Sprite'
        + ', nothing named 2f3aRk1 or cc.2f3aRk1');
    assert.equal(output.exitCode, 3);
});

test('a class already on the node is added again, under the address of the new one', async () => {
    const driver = withGuard();
    const output = present(await componentAdd(driver, {
        node: 'Guard', component: 'cc.Sprite', poll: FAST
    }));
    const sprites = driver.componentsOf(driver.uuidOf('Guard'));
    assert.equal(sprites.length, 2);
    assert.equal(output.stdout, `cc.Sprite#2 added to Guard  ${sprites[1].uuid}`);
});

test('a class the engine never registered is refused rather than reported as added', async () => {
    const driver = new MemoryDriver({ nodes: [{ name: 'Guard' }], classes: [] });
    await assert.rejects(
        () => componentAdd(driver, { node: 'Guard', component: 'Nope', poll: FAST }), /Nope/);
});

// `remove-component` takes the component's own uuid; a removal aimed at the node uuid would take the
// wrong thing.
test('rm reaches the editor with the component uuid the node dump names', async () => {
    const driver = withGuard();
    const nodeUuid = driver.uuidOf('Guard');
    const componentUuid = driver.componentsOf(nodeUuid)[0].uuid;
    const output = present(await componentRemove(driver, { node: 'Guard', component: 'cc.Sprite' }));
    assert.equal(output.stdout, 'cc.Sprite removed from Guard');
    assert.equal(driver.calls.find(call => call.name === 'scene.removeComponent').args[0].uuid,
        componentUuid);
    assert.equal(driver.componentsOf(nodeUuid).length, 0);
});

test('a class the node does not carry is refused, naming what it does carry', async () => {
    await assert.rejects(
        () => componentRemove(withGuard(), { node: 'Guard', component: 'cc.Camera' }),
        /cc\.Sprite/);
});

test('get reads the properties of a component the way the inspector holds them', async () => {
    const output = present(await componentGet(new MemoryDriver(spriteScene()),
        { node: 'Canvas/Bg', component: 'Sprite' }));
    assert.match(output.stdout, /^cc\.Sprite on Canvas\/Bg/);
    assert.match(output.stdout, /color/);
    assert.equal(output.stderr, undefined);
});

// The declared type is what a caller has to know to write the value back, and the value line does
// not carry it.
test('--prop prints the value under the address and the type it is declared with', async () => {
    const output = present(await componentGet(new MemoryDriver(spriteScene()),
        { node: 'Canvas/Bg', component: 'Sprite', property: 'color' }));
    assert.equal(output.stdout, 'cc.Sprite.color  cc.Color\n#ffffffff');
});

// ----- Several components of one class ----------------------------------------------------

const speed = (value) => ({ name: 'speed', type: 'Number', value, default: 1 });

const dropship = (extra = {}) => ({
    nodes: [{ name: 'Dropship', components: [
        { type: 'SplineAnimate', props: { speed: speed(2) } },
        { type: 'EntityRoot' },
        { type: 'SplineAnimate', props: { speed: speed(5) } }
    ] }],
    ...extra
});

const splines = (driver) =>
    driver.componentsOf(driver.uuidOf('Dropship')).filter(one => one.type === 'SplineAnimate');

test('a bare class the node carries twice is refused by every subcommand, naming both', async () => {
    const driver = new MemoryDriver(dropship());
    const [arrive, leave] = splines(driver);
    const refusal = `'SplineAnimate' matches 2 components of the node: SplineAnimate#1 ${arrive.uuid}, `
        + `SplineAnimate#2 ${leave.uuid}`;
    const bare = { node: 'Dropship', component: 'SplineAnimate' };
    await assert.rejects(() => componentGet(driver, bare), { message: refusal });
    await assert.rejects(() => componentSet(driver, { ...bare, property: 'speed', value: 9 }),
        { message: refusal });
    await assert.rejects(() => componentRemove(driver, bare), { message: refusal });
    await assert.rejects(() => componentReset(driver, bare), { message: refusal });
    assert.deepEqual(splines(driver).map(one => one.props.speed.value), [2, 5]);
});

test('get names the component by its address and prints its uuid', async () => {
    const driver = new MemoryDriver(dropship());
    const output = present(await componentGet(driver, { node: 'Dropship', component: 'SplineAnimate#2' }));
    assert.equal(output.stdout.split('\n')[0],
        `SplineAnimate#2 on Dropship  ${splines(driver)[1].uuid}  enabled=unknown  hidden: 1  `
            + '* — differs from the default');
    assert.match(output.stdout, /speed +Number +\* +5/);
});

test('set on #2 writes the second component and leaves the first alone', async () => {
    const driver = new MemoryDriver(dropship());
    const output = await setOutput(driver,
        { node: 'Dropship', component: 'SplineAnimate#2', property: 'speed', value: 9 });
    assert.deepEqual(splines(driver).map(one => one.props.speed.value), [2, 9]);
    assert.match(output.stdout, /^SplineAnimate#2\.speed = 9 .*persisted=true/);
    assert.equal(output.exitCode, 0);
});

// The serializer is asked about a component by class id, which names only the first of its class;
// compared against the first's value, a write to the second would read as one a save drops.
test('the save verdict for #2 is taken from the second component, not from the first', async () => {
    const driver = new MemoryDriver({
        nodes: [{ name: 'Dropship', components: [
            { type: 'SplineAnimate', props: { speed: speed(2) }, serialized: { speed: 2 } },
            { type: 'SplineAnimate', props: { speed: speed(5) }, serialized: { speed: 9 } }
        ] }]
    });
    const output = await setOutput(driver,
        { node: 'Dropship', component: 'SplineAnimate#2', property: 'speed', value: 9 });
    assert.match(output.stdout, /persisted=true/);
});

test('a scene script that answers about the first of the class leaves the verdict on #2 open', async () => {
    const driver = new MemoryDriver(dropship({ staleSceneScript: true }));
    const output = await setOutput(driver,
        { node: 'Dropship', component: 'SplineAnimate#2', property: 'speed', value: 9 });
    assert.equal(output.stderr.split('  ')[0], 'UNVERIFIED');
    assert.match(output.stderr, /answered about another component of the class/);
    assert.equal(output.exitCode, 3);
});

test('rm on #1 removes the first and leaves the second', async () => {
    const driver = new MemoryDriver(dropship());
    const [, leave] = splines(driver);
    const output = present(await componentRemove(driver, { node: 'Dropship', component: 'SplineAnimate#1' }));
    assert.equal(output.stdout, 'SplineAnimate#1 removed from Dropship');
    assert.deepEqual(splines(driver).map(one => one.uuid), [leave.uuid]);
});

test('reset on #2 resets the second and reports it by its address', async () => {
    const driver = new MemoryDriver(dropship());
    const output = present(await componentReset(driver, { node: 'Dropship', component: 'SplineAnimate#2' }));
    assert.deepEqual(splines(driver).map(one => one.props.speed.value), [2, 1]);
    assert.match(output.stdout, /^SplineAnimate#2\.speed = 1/);
});

const departure = () => ({
    name: 'departure', value: { uuid: '' }, default: null, type: 'SplineAnimate', visible: true,
    extends: ['cc.Component', 'cc.Object']
});

const flight = (extra) => new MemoryDriver(dropship({
    nodes: [...dropship().nodes, { name: 'Game', components: [{ type: 'ActionFlow', props: { departure: departure() } }] }],
    ...extra
}));

const departureOf = (driver) => driver.componentsOf(driver.uuidOf('Game'))[0].props.departure.value.uuid;

test('a reference to a node carrying two components of the declared class is refused before the write', async () => {
    const driver = flight();
    const [arrive, leave] = splines(driver);
    await assert.rejects(
        () => componentSet(driver,
            { node: 'Game', component: 'ActionFlow', property: 'departure', value: 'Dropship' }),
        { message: `'Dropship': 'SplineAnimate' matches 2 components of the node: `
            + `SplineAnimate#1 ${arrive.uuid}, SplineAnimate#2 ${leave.uuid}` });
    assert.ok(!driver.calls.some(call => call.name === 'scene.setProperty'));
});

test('the uuid of the second component is written as it stands', async () => {
    const driver = flight();
    const leave = splines(driver)[1];
    const output = await setOutput(driver,
        { node: 'Game', component: 'ActionFlow', property: 'departure', value: leave.uuid });
    assert.equal(departureOf(driver), leave.uuid);
    assert.equal(output.exitCode, 0);
});

test('a reference written on #2 lands in the second component, not the first', async () => {
    const driver = new MemoryDriver({
        nodes: [
            { name: 'Dropship', components: [
                { type: 'SplineAnimate', props: { container: emptyRef() } },
                { type: 'SplineAnimate', props: { container: emptyRef() } }
            ] },
            { name: 'Path' }
        ]
    });
    await componentSet(driver,
        { node: 'Dropship', component: 'SplineAnimate#2', property: 'container', value: 'Path' });
    assert.deepEqual(splines(driver).map(one => one.props.container.value.uuid), ['', driver.uuidOf('Path')]);
});

test('--target-component with #N picks that component of the target node', async () => {
    const driver = flight();
    const leave = splines(driver)[1];
    await componentSet(driver, {
        node: 'Game', component: 'ActionFlow', property: 'departure', value: 'Dropship',
        targetComponent: 'SplineAnimate#2'
    });
    assert.equal(departureOf(driver), leave.uuid);
});

test('a property the component does not declare is refused, naming the ones it has', async () => {
    await assert.rejects(
        () => componentGet(new MemoryDriver(spriteScene()),
            { node: 'Canvas/Bg', component: 'Sprite', property: 'tint' }),
        /no property 'tint'.*color/s);
});

const band = (upTo) => ({ name: 'upTo', type: 'Number', value: upTo, default: 0 });

const bandsProp = () => ({
    name: 'bands', type: 'Number', isArray: true, default: [], visible: true, extends: [],
    value: [band(1), band(2), band(3)]
});

const banded = () => new MemoryDriver({
    nodes: [{ name: 'Hero', components: [{ type: 'ClipBands', props: { bands: bandsProp() } }] }]
});

const bandsOf = (driver) =>
    driver.componentsOf(driver.uuidOf('Hero'))[0].props.bands.value.map(entry => entry.value);

test('moving an element forward puts it where the offset asked and reports the new order', async () => {
    const driver = banded();
    const output = present(await componentArrayMove(driver,
        { node: 'Hero', component: 'ClipBands', property: 'bands', index: 0, offset: 1 }));
    assert.deepEqual(bandsOf(driver), [2, 1, 3]);
    assert.match(output.stdout, /^ClipBands\.bands/);
    assert.match(output.stdout, /element 0 moved to 1/);
});

test('a negative offset moves an element towards the front', async () => {
    const driver = banded();
    await componentArrayMove(driver,
        { node: 'Hero', component: 'ClipBands', property: 'bands', index: 2, offset: -2 });
    assert.deepEqual(bandsOf(driver), [3, 1, 2]);
});

// `move-array-element` answers `true` for an index it then ignores, so an out-of-range ask has to
// be refused here; forwarded, it would come back as a success that moved nothing.
test('an index outside the array is refused, naming how long the array is', async () => {
    await assert.rejects(
        () => componentArrayMove(banded(),
            { node: 'Hero', component: 'ClipBands', property: 'bands', index: 5, offset: 1 }),
        /3 element/);
});

test('an offset that would land outside the array is refused too', async () => {
    await assert.rejects(
        () => componentArrayMove(banded(),
            { node: 'Hero', component: 'ClipBands', property: 'bands', index: 2, offset: 1 }),
        /--offset 1/);
});

test('a property that is not an array is refused rather than moved as one', async () => {
    const driver = new MemoryDriver(spriteScene());
    await assert.rejects(
        () => componentArrayMove(driver,
            { node: 'Canvas/Bg', component: 'Sprite', property: 'color', index: 0, offset: 1 }),
        /not an array/);
});

test('removing an element drops it and reports what is left', async () => {
    const driver = banded();
    const output = present(await componentArrayRemove(driver,
        { node: 'Hero', component: 'ClipBands', property: 'bands', index: 1 }));
    assert.deepEqual(bandsOf(driver), [1, 3]);
    assert.match(output.stdout, /2 left/);
    assert.match(output.stdout, /persisted=true/);
});

test('an array edit is wrapped in an undo bracket', async () => {
    const driver = banded();
    await componentArrayRemove(driver,
        { node: 'Hero', component: 'ClipBands', property: 'bands', index: 1 });
    const names = driver.calls.map(call => call.name);
    assert.ok(names.indexOf('scene.beginRecording') < names.indexOf('scene.removeArrayElement'));
    assert.ok(names.indexOf('scene.removeArrayElement') < names.indexOf('scene.endRecording'));
});

const resettable = () => new MemoryDriver({
    nodes: [{ name: 'Canvas', children: [{ name: 'Bg', components: [
        { type: 'cc.Sprite', props: { color: white(), sizeMode: { name: 'sizeMode', type: 'Number', value: 2, default: 0 } } }
    ] }] }]
});

test('reset answers for the properties whose value moved, and for no others', async () => {
    const output = present(await componentReset(resettable(), { node: 'Canvas/Bg', component: 'Sprite' }));
    assert.match(output.stdout, /^cc\.Sprite\.sizeMode = 0/);
    assert.doesNotMatch(output.stdout, /color/);
});

test('a component already at its defaults says so rather than listing nothing', async () => {
    const driver = resettable();
    await componentReset(driver, { node: 'Canvas/Bg', component: 'Sprite' });
    const output = present(await componentReset(driver, { node: 'Canvas/Bg', component: 'Sprite' }));
    assert.match(output.stdout, /nothing to write/);
    assert.equal(output.exitCode, 0);
});

// Checked live on a prefab instance: `reset-component` moved the value and recorded no override,
// so the next load rebuilds the prefab's and the reset is gone.
test('a reset inside an instance that records no override is UNPERSISTED', async () => {
    const driver = new MemoryDriver({
        nodes: [{
            name: 'Hero',
            prefab: { asset: 'prefab-uuid', recordsOverrides: false },
            components: [{ type: 'Health', props: {
                maxHp: { name: 'maxHp', type: 'Number', value: 7, default: 1 }
            } }]
        }]
    });
    const output = present(await componentReset(driver, { node: 'Hero', component: 'Health' }));
    assert.match(output.stderr, /^UNPERSISTED {2}Health\.maxHp = 1/);
    assert.equal(output.exitCode, 4);
});

test('reset is wrapped in an undo bracket', async () => {
    const driver = resettable();
    await componentReset(driver, { node: 'Canvas/Bg', component: 'Sprite' });
    const names = driver.calls.map(call => call.name);
    assert.ok(names.indexOf('scene.beginRecording') < names.indexOf('scene.resetComponent'));
    assert.ok(names.indexOf('scene.resetComponent') < names.indexOf('scene.endRecording'));
});

test('types lists what the editor offers to add, with the menu path it offers it under', async () => {
    const driver = new MemoryDriver({
        nodes: [],
        offeredComponents: [{ name: 'cc.Camera', cid: 'cc.Camera', path: 'Rendering/Camera' }]
    });
    const output = present(await componentTypes(driver));
    assert.match(output.stdout, /cc\.Camera/);
    assert.match(output.stdout, /Rendering\/Camera/);
    assert.equal(output.stderr, undefined);
});
