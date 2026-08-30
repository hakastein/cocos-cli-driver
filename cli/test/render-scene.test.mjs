import test from 'node:test';
import assert from 'node:assert/strict';

import * as r from '../src/render/scene.ts';

const { renderComponentOwners, componentOwnersHead, renderSceneDirty, renderMissingScripts } = r;

const owner = (over = {}) => ({
    nodePath: 'Characters/guard_1', nodeUuid: 'u-1', nodeName: 'guard_1',
    active: true, activeInHierarchy: true, componentUuid: 'c-1',
    className: 'TargetPolicy', enabled: true, ...over
});

const owners = (list) => ({
    className: 'TargetPolicy', sceneName: 'cc_action_1a', nodesScanned: 391,
    ownerCount: list.length, owners: list
});

test('a class nothing carries is said outright rather than printing an empty list', () => {
    assert.equal(renderComponentOwners(owners([])), 'no node in the scene carries TargetPolicy');
});

test('an owner prints its path and uuid with no marks when it is fully live', () => {
    const text = renderComponentOwners(owners([owner()]));
    assert.match(text, /Characters\/guard_1/);
    assert.match(text, /u-1/);
    assert.equal(/\(off\)/.test(text), false);
});

test('a node switched off itself and one switched off by a parent read differently', () => {
    const own = renderComponentOwners(owners([owner({ active: false, activeInHierarchy: false })]));
    const parent = renderComponentOwners(owners([owner({ active: true, activeInHierarchy: false })]));
    assert.match(own, /\(off\)/);
    assert.match(parent, /\(under an off parent\)/);
});

test('a disabled component is marked apart from a disabled node', () => {
    assert.match(renderComponentOwners(owners([owner({ enabled: false })])), /\(component off\)/);
});

// How much of the scene was searched is what says whether an empty answer means anything; the
// owner rows carry neither that nor which scene they came from.
test('the head names the scene searched and how much of it, not the row count', () => {
    const text = componentOwnersHead(owners([owner()]));
    assert.match(text, /nodes scanned 391/);
    assert.doesNotMatch(text, /owners 1/);
});

test('a scene matching disk says so and names the file', () => {
    assert.equal(
        renderSceneDirty({ differsFromDisk: false, scenePath: 'D:\\p\\a.scene', diffs: [] }),
        'matches disk  D:\\p\\a.scene');
});

test('a differing scene leads with its own word and shows where it differs', () => {
    const text = renderSceneDirty({
        differsFromDisk: true, scenePath: 'D:\\p\\a.scene',
        diffs: [{ path: '.2._lpos.x', live: '5', disk: '0' }]
    });
    assert.equal(text.split('  ')[0], 'differs from disk');
    assert.match(text, /\.2\._lpos\.x {2}scene 5 {2}disk 0/);
    assert.match(text, /differences: 1/);
});

test('a scene whose path is unknown still renders instead of printing null', () => {
    assert.match(
        renderSceneDirty({ differsFromDisk: false, scenePath: null, diffs: [] }),
        /path unknown/);
});

// A scene never written to disk differs from it with no diffs to show, so the reason is the whole
// answer rather than a remark beside one.
test('the reason a scene differs with nothing to show reaches the line', () => {
    assert.match(
        renderSceneDirty({
            differsFromDisk: true, scenePath: null, diffs: [], reason: 'never written to disk'
        }),
        /never written to disk/);
});

test('a clean scene reports no dead components rather than an empty string', () => {
    assert.equal(renderMissingScripts({ entries: [] }), 'no dead components in the scene');
});

test('a dead component names the node and the cid that no longer resolves', () => {
    const text = renderMissingScripts({
        entries: [{ nodePath: 'Characters/guard_1', nodeUuid: 'u-1', componentUuid: 'c-1', cid: '04e75Mu' }]
    });
    assert.match(text, /Characters\/guard_1/);
    assert.match(text, /cid=04e75Mu/);
});

test('a dead component with no cid says so instead of printing null', () => {
    assert.match(
        renderMissingScripts({ entries: [{ nodePath: 'a', nodeUuid: 'u', componentUuid: 'c', cid: null }] }),
        /cid=unknown/);
});

