import test from 'node:test';
import assert from 'node:assert/strict';

import { addComponent, unverifiedAddNote } from '../src/component-add.ts';
import { MemoryDriver } from '../src/driver/memory.ts';

const FAST = { timeoutMs: 30, intervalMs: 5 };

// The engine registers a class under the spelling it accepted: an engine one as `cc.MeshRenderer`,
// a user one under its own name. The node dump answers exactly that.
const scene = (already, classes) => new MemoryDriver({
    nodes: [{ name: 'Hero', components: already.map(type => ({ type })) }],
    ...(classes === undefined ? {} : { classes })
});

const tried = (driver) => driver.calls
    .filter(call => call.name === 'scene.createComponent')
    .map(call => call.args[0].component);

test('an added component is reported with the uuid the node dump gives it', async () => {
    const driver = scene([]);
    const outcome = await addComponent(driver, driver.uuidOf('Hero'), 'Sprite', FAST);
    assert.equal(outcome.type, 'Sprite');
    assert.equal(outcome.label, 'Sprite');
    assert.equal(outcome.uuid, driver.componentsOf(driver.uuidOf('Hero'))[0].uuid);
});

test('the report names the registered class name rather than the spelling from the request', async () => {
    const driver = scene([]);
    const outcome = await addComponent(driver, driver.uuidOf('Hero'), 'cc.MeshRenderer', FAST);
    assert.equal(outcome.type, 'cc.MeshRenderer');
});

test('the editor silently ignores the bare name — the cc. spelling is what registers', async () => {
    const driver = scene([], ['cc.MeshRenderer']);
    const outcome = await addComponent(driver, driver.uuidOf('Hero'), 'MeshRenderer', FAST);
    assert.equal(outcome.type, 'cc.MeshRenderer');
    assert.deepEqual(tried(driver), ['MeshRenderer', 'cc.MeshRenderer']);
});

test('a component that appeared under no spelling is refused rather than passed off as ok', async () => {
    const driver = scene(['Sprite'], []);
    await assert.rejects(
        () => addComponent(driver, driver.uuidOf('Hero'), 'Nope', FAST),
        error => /Nope/.test(error.message) && /Sprite/.test(error.message));
});

// Checked live 2026-09-25: `create-component` on a node already carrying `SplineAnimate` attached
// a second one.
test('a class already on the node gets one more, told from the first by its uuid', async () => {
    const driver = scene(['SplineAnimate']);
    const hero = driver.uuidOf('Hero');
    const outcome = await addComponent(driver, hero, 'SplineAnimate', FAST);
    const [first, second] = driver.componentsOf(hero);
    assert.equal(outcome.label, 'SplineAnimate#2');
    assert.equal(outcome.uuid, second.uuid);
    assert.notEqual(outcome.uuid, first.uuid);
});

test('a class the engine allows once per node is refused, saying the node already carried one', async () => {
    const driver = new MemoryDriver({
        nodes: [{ name: 'Hero', components: [{ type: 'cc.UITransform' }] }],
        classes: ['cc.UITransform'],
        disallowMultiple: ['cc.UITransform']
    });
    await assert.rejects(
        () => addComponent(driver, driver.uuidOf('Hero'), 'cc.UITransform', FAST),
        /did not appear .*, which already carried one; the node carries: cc\.UITransform$/);
    assert.equal(driver.componentsOf(driver.uuidOf('Hero')).length, 1);
});

// A class that declares a requirement makes the editor attach that requirement AHEAD of it, so the
// first component to appear on the node is the dependency rather than the one asked for.
const withDependency = (attaches, classes = []) => new MemoryDriver({
    nodes: [{ name: 'Hero' }], classes, attaches
});

test('the dependency attached ahead of the component does not take its place in the report', async () => {
    const driver = withDependency({ 'cc.Sprite': ['cc.UITransform', 'cc.Sprite'] });
    const outcome = await addComponent(driver, driver.uuidOf('Hero'), 'cc.Sprite', FAST);
    assert.equal(outcome.type, 'cc.Sprite');
    assert.deepEqual(driver.componentsOf(driver.uuidOf('Hero')).map(one => one.type),
        ['cc.UITransform', 'cc.Sprite']);
});

// `create-component` takes a cid as well as a class name, and the class then registers under its
// own name — which no spelling of the cid names.
test('one component under a name no spelling asked for is still the one the add produced', async () => {
    const driver = withDependency({ '2f3aRk1': ['cc.Sprite'] });
    const outcome = await addComponent(driver, driver.uuidOf('Hero'), '2f3aRk1', FAST);
    assert.equal(outcome.verified, true);
    assert.equal(outcome.type, 'cc.Sprite');
});

test('several components and no spelling naming any of them is UNVERIFIED, not a guess', async () => {
    const driver = withDependency({ '2f3aRk1': ['cc.UITransform', 'cc.Sprite'] });
    const outcome = await addComponent(driver, driver.uuidOf('Hero'), '2f3aRk1', FAST);
    assert.equal(outcome.verified, false);
    assert.equal(unverifiedAddNote(outcome),
        'the node gained cc.UITransform, cc.Sprite, nothing named 2f3aRk1 or cc.2f3aRk1');
});
