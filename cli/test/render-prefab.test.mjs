import test from 'node:test';
import assert from 'node:assert/strict';

import {
    prefabOverridesHead, renderPrefabDump, renderPrefabOverrides
} from '../src/render/prefab.ts';

const component = (over = {}) => ({
    className: 'CharacterAnimator', cid: null, fileId: 'f1', enabled: true, missing: false, ...over
});

const dump = (over = {}) => ({
    prefabUuid: 'p1',
    rootName: 'char_hero',
    nodeCount: 1,
    componentCount: 1,
    missingCount: 0,
    nodes: [{ path: 'char_hero', name: 'char_hero', active: true, fileId: 'n1', components: [component()] }],
    ...over
});

test('a node prints as its path and a component list', () => {
    assert.equal(renderPrefabDump(dump()), 'char_hero  [CharacterAnimator]');
});

test('a node switched off is marked the same way as in the scene tree', () => {
    const off = dump();
    off.nodes[0].active = false;
    assert.match(renderPrefabDump(off), /\(off\)/);
});

test('a disabled component is named together with its state', () => {
    const off = dump();
    off.nodes[0].components = [component({ enabled: false })];
    assert.match(renderPrefabDump(off), /CharacterAnimator\(off\)/);
});

// The dead slot is what the dump gets read for: it crashes preview on scene load.
test('a dead component is named by its own word and its cid', () => {
    const dead = dump();
    dead.nodes[0].components = [component({ missing: true, className: 'cc.MissingScript', cid: '04e75MuPw1E2Y0Yv' })];
    const text = renderPrefabDump(dead);
    assert.match(text, /DEAD/);
    assert.match(text, /04e75MuPw1E2Y0Yv/);
});

test('a node with no components prints as a bare path, with no empty brackets', () => {
    const bare = dump();
    bare.nodes[0].components = [];
    assert.equal(renderPrefabDump(bare), 'char_hero');
});


const override = (over = {}) => ({
    index: 0,
    propertyPath: '_lpos',
    propertyPathParts: ['_lpos'],
    localID: ['abc'],
    target: { kind: 'node', name: 'Hips', path: 'char_hero/Hips', type: 'cc.Node' },
    valueKind: 'valueType',
    valueType: 'Vec3',
    value: { x: 1, y: 0, z: 0 },
    ...over
});

const report = (overrides) => ({
    nodeUuid: 'n1', nodeName: 'char_hero', prefabAsset: 'p1',
    overrideCount: overrides.length, removedComponents: 0, mountedChildren: 0, overrides
});

test('an instance with no overrides says so in words rather than as an empty string', () => {
    assert.equal(renderPrefabOverrides(report([])), 'no overrides');
});

test('an override prints as index, property path, target and value', () => {
    const text = renderPrefabOverrides(report([override()]));
    assert.match(text, /^0\s+_lpos\s+char_hero\/Hips\s+Vec3\s+\{"x":1/);
});

test('a component target is named by its class and its node', () => {
    const text = renderPrefabOverrides(report([override({
        target: { kind: 'component', name: 'char_hero', path: 'char_hero', type: 'CharacterAnimator' }
    })]));
    assert.match(text, /CharacterAnimator on char_hero/);
});

// An override outlives the value it was recorded for, so a target with no name has to stay
// addressable — by localID, rather than turning into a dash.
test('a target that could not be named prints as its localID', () => {
    const text = renderPrefabOverrides(report([override({ target: null, localID: ['a', 'b'] })]));
    assert.match(text, /localID a\/b/);
});

test('an asset reference prints as a name and a uuid', () => {
    const text = renderPrefabOverrides(report([override({
        valueKind: 'asset', valueType: 'SkeletalAnimationClip', assetName: 'idle', assetUuid: 'a1'
    })]));
    assert.match(text, /idle\s+a1/);
});

// A removed component and a mounted child are overrides too, and no property row lists them.
test('removed components and mounted children reach the head', () => {
    const head = prefabOverridesHead({ ...report([]), removedComponents: 1, mountedChildren: 2 });
    assert.match(head, /prefab: p1/);
    assert.match(head, /removed components: 1/);
    assert.match(head, /mounted children: 2/);
});

test('the head does not count the override rows printed under it', () => {
    assert.doesNotMatch(prefabOverridesHead(report([override()])), /overrides: /);
});
