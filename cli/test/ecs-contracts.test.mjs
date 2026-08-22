/**
 * The three readings the census draws on top of its per-key counts. Each stands for a rule in the
 * playables' `docs/ecs.md`, so the cases that matter are the ones where the rule is nearly kept: a
 * system named for its rule rather than its data, a read that stays inside its own folder, and a
 * second consumer that makes a pair no longer a pair.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { runCensus } from '../src/ecs/census.ts';

const keysIn = (path, ...names) => ({
    path,
    text: `declare module './core/world' {\n    interface Entity {\n`
        + `${names.map((name) => `        ${name}?: true;`).join('\n')}\n    }\n}\n`,
});

const systemIn = (path, className, label, body) => ({
    path,
    text: `export class ${className} extends system('${label}', { world: GameWorld }) {\n`
        + `    run(): void { ${body} }\n}\n`,
});

test('a system whose name is a declared key is named, with the file of each', () => {
    const result = runCensus([
        keysIn('motion/locomotion/components.ts', 'speed'),
        systemIn('motion/locomotion/speed.ts', 'Speed', 'speed', 'entity.speed.value = 1;'),
    ]);
    assert.deepEqual(result.systemsNamedLikeKeys.map((collision) => ({
        name: collision.name,
        className: collision.system.className,
        system: `${collision.system.file}:${collision.system.line}`,
        key: `${collision.key.file}:${collision.key.line}`,
    })), [{
        name: 'speed',
        className: 'Speed',
        system: 'motion/locomotion/speed.ts:1',
        key: 'motion/locomotion/components.ts:3',
    }]);
});

test('a system named for its rule collides with nothing and is still counted as a system', () => {
    const result = runCensus([
        keysIn('motion/locomotion/components.ts', 'speed'),
        systemIn('motion/locomotion/speed.ts', 'CapSpeed', 'capSpeed', 'entity.speed.value = 1;'),
    ]);
    assert.deepEqual(result.systemsNamedLikeKeys, []);
    assert.deepEqual(result.systems.map((declaration) => declaration.name), ['capSpeed']);
});

test('a class extending anything else is not a system', () => {
    const result = runCensus([
        keysIn('components.ts', 'node'),
        { path: 'Mountable.ts', text: 'export class Mountable extends Component {\n    play() {}\n}\n' },
    ]);
    assert.deepEqual(result.systems, []);
});

test('a read from another capability is reported and one from the declaring folder is not', () => {
    const result = runCensus([
        keysIn('framework/motion/locomotion/components.ts', 'intent'),
        keysIn('framework/motion/nav/components.ts', 'route'),
        systemIn('framework/motion/locomotion/turn.ts', 'TurnToward', 'turnToward', 'if (entity.intent.face) hold();'),
        systemIn('framework/motion/nav/route.ts', 'FollowRoute', 'followRoute', 'if (entity.intent) go();'),
    ]);
    assert.deepEqual(result.readOutsideCapability.map((outside) => ({
        key: outside.key,
        capability: outside.capability,
        from: outside.from,
        sites: outside.sites.map((site) => `${site.file}:${site.line}`),
    })), [{
        key: 'intent',
        capability: 'framework/motion/locomotion',
        from: ['framework/motion/nav'],
        sites: ['framework/motion/nav/route.ts:2'],
    }]);
});

test('a capability nested in another is its own, so reading the outer key crosses a contract', () => {
    const result = runCensus([
        keysIn('framework/death/components.ts', 'dead'),
        keysIn('framework/death/destructible/components.ts', 'destructible'),
        systemIn('framework/death/destructible/shatter.ts', 'Shatter', 'shatter', 'if (entity.dead) shatter();'),
    ]);
    assert.deepEqual(result.readOutsideCapability.map((outside) => [outside.key, outside.from]),
        [['dead', ['framework/death/destructible']]]);
});

test('one system fills the key and one system reads it: the pair is named', () => {
    const result = runCensus([
        keysIn('framework/actuation/components.ts', 'actStarted'),
        systemIn('framework/actuation/acting.ts', 'Acting', 'acting', 'entity.actStarted = true;'),
        systemIn('framework/present/animation/clipSelect.ts', 'ClipSelect', 'clipSelect', 'if (entity.actStarted) play();'),
    ]);
    assert.deepEqual(result.oneWriterOneReader.map((pair) => [pair.key, pair.writer, pair.reader]),
        [['actStarted', 'acting', 'clipSelect']]);
});

test('a second consumer is not a pair', () => {
    const result = runCensus([
        keysIn('framework/actuation/components.ts', 'actStarted'),
        systemIn('framework/actuation/acting.ts', 'Acting', 'acting', 'entity.actStarted = true;'),
        systemIn('framework/present/animation/clipSelect.ts', 'ClipSelect', 'clipSelect', 'if (entity.actStarted) play();'),
        systemIn('framework/present/audio/actSound.ts', 'ActSound', 'actSound', 'if (entity.actStarted) cue();'),
    ]);
    assert.deepEqual(result.oneWriterOneReader, []);
});

test('a key filled outside every system has no producer to merge with', () => {
    const result = runCensus([
        keysIn('framework/actuation/components.ts', 'actStarted'),
        { path: 'framework/assembly/hero.ts', text: 'export function spawn(entity: Entity) { entity.actStarted = true; }\n' },
        systemIn('framework/present/animation/clipSelect.ts', 'ClipSelect', 'clipSelect', 'if (entity.actStarted) play();'),
    ]);
    assert.deepEqual(result.oneWriterOneReader, []);
});
