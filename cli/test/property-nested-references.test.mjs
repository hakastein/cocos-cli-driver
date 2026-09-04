import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { nestedReferenceSites, withReferenceUuids } from '../src/property/nested-references.ts';

const fixtures = JSON.parse(
    readFileSync(fileURLToPath(new URL('./fixtures/descriptors.json', import.meta.url)), 'utf8')
);

const PREFAB = '5965dcc0-7042-42a8-90ac-df7df5ede667';

test('a reference inside a value class is a site, with the class the field declares', () => {
    assert.deepEqual(nestedReferenceSites(fixtures.cueSpec, { sound: 'Audio/SfxSale' }), [
        { path: ['sound'], kind: 'componentRef', declaredType: 'SoundEmitter', spelling: 'Audio/SfxSale' }
    ]);
});

test('a member the caller left out is no site, so the write does not clear it', () => {
    const sites = nestedReferenceSites(fixtures.cueSpec, { sound: 'Audio/SfxSale' });
    assert.deepEqual(sites.map(site => site.path), [['sound']]);
});

test('a plain member of the same class is not a site', () => {
    assert.deepEqual(nestedReferenceSites(fixtures.nestedClass, { duration: 1.25, easing: 'backOut' }), []);
});

test('an asset reference inside a value class is a site of its own kind', () => {
    assert.deepEqual(nestedReferenceSites(fixtures.nestedClass, { duration: 1, clip: PREFAB }), [
        { path: ['clip'], kind: 'assetRef', declaredType: 'cc.AudioClip', spelling: PREFAB }
    ]);
});

test('a reference inside a class-array element carries the element index in its path', () => {
    const sites = nestedReferenceSites(fixtures.classArray, [
        { spawnInterval: 1 },
        { squads: [{ prefab: PREFAB, count: 2 }] }
    ]);
    assert.deepEqual(sites, [
        { path: [1, 'squads', 0, 'prefab'], kind: 'assetRef', declaredType: 'cc.Prefab', spelling: PREFAB }
    ]);
});

test('a field the descriptor does not declare yields no site', () => {
    assert.deepEqual(nestedReferenceSites(fixtures.cueSpec, { spin: 'Audio/SfxSale' }), []);
});

test('a top-level reference descriptor is one site addressed by the empty path', () => {
    assert.deepEqual(nestedReferenceSites(fixtures.nodeRef, 'Characters/hero'), [
        { path: [], kind: 'nodeRef', declaredType: 'cc.Node', spelling: 'Characters/hero' }
    ]);
});

test('a resolved site replaces its own spelling and leaves the rest of the value alone', () => {
    const written = withReferenceUuids(
        { sound: 'Audio/SfxSale', fx: 'Fx/Burst' },
        [{ path: ['sound'], uuid: 'comp-uuid' }]
    );
    assert.deepEqual(written, { sound: 'comp-uuid', fx: 'Fx/Burst' });
});

test('the caller value is not mutated, so a report can still print what was asked for', () => {
    const asked = { sound: 'Audio/SfxSale' };
    withReferenceUuids(asked, [{ path: ['sound'], uuid: 'comp-uuid' }]);
    assert.deepEqual(asked, { sound: 'Audio/SfxSale' });
});

test('a site deep in a class array is replaced at its index', () => {
    const written = withReferenceUuids(
        [{ spawnInterval: 1 }, { squads: [{ prefab: 'db://assets/a.prefab', count: 2 }] }],
        [{ path: [1, 'squads', 0, 'prefab'], uuid: PREFAB }]
    );
    assert.deepEqual(written, [
        { spawnInterval: 1 },
        { squads: [{ prefab: PREFAB, count: 2 }] }
    ]);
});

test('an array-valued site takes one uuid per slot', () => {
    assert.deepEqual(
        withReferenceUuids({ targets: ['a', 'b'] }, [{ path: ['targets'], uuid: ['uuid-a', 'uuid-b'] }]),
        { targets: ['uuid-a', 'uuid-b'] });
});

test('nothing to resolve hands the value back as it stands', () => {
    const asked = { duration: 1.25 };
    assert.equal(withReferenceUuids(asked, []), asked);
});
