import test from 'node:test';
import assert from 'node:assert/strict';

import { present } from '../src/render/present.ts';
import { verdictExit } from '../src/render/verdict.ts';

// The closed set exists for this table: the exit code is decided once here instead of being
// reassembled in every command body, and each failing class carries its own number.
test('each verdict has its own exit code', () => {
    assert.equal(verdictExit('ok'), 0);
    assert.equal(verdictExit('FAILED'), 1);
    assert.equal(verdictExit('UNVERIFIED'), 3);
    assert.equal(verdictExit('UNPERSISTED'), 4);
    assert.equal(verdictExit('TIMEOUT'), 5);
});

test('a successful call answers on stdout and leaves stderr empty', () => {
    const output = present({ kind: 'action', verdict: 'ok', summary: 'scene saved' });
    assert.equal(output.stdout, 'scene saved');
    assert.equal(output.stderr, undefined);
    assert.equal(output.exitCode, 0);
});

// A redirection of stdout into a file must never leave half an answer there.
test('a failing call answers on stderr and leaves stdout empty', () => {
    const output = present({ kind: 'action', verdict: 'FAILED', summary: 'Guard not moved' });
    assert.equal(output.stdout, undefined);
    assert.equal(output.stderr, 'FAILED  Guard not moved');
    assert.equal(output.exitCode, 1);
});

test('warnings ride the report as a list and print under the answer', () => {
    const output = present({
        kind: 'action', verdict: 'ok', summary: 'socket added',
        warnings: ['written on the live component']
    });
    assert.deepEqual(output.warnings, ['written on the live component']);
    assert.equal(output.stdout, 'socket added\nwarning: written on the live component');
});

test('a bracket that held costs no line, and one that did not becomes a warning', () => {
    assert.deepEqual(
        present({ kind: 'action', verdict: 'ok', summary: 'done', undoNote: null }).warnings, []);
    assert.deepEqual(
        present({ kind: 'action', verdict: 'ok', summary: 'done', undoNote: 'left open' }).warnings,
        ['left open']);
});

test('a failing report takes its warnings to stderr with the rest of it', () => {
    const output = present({
        kind: 'action', verdict: 'TIMEOUT', summary: 'the build did not finish',
        warnings: ['wrote onto task 1']
    });
    assert.equal(output.stdout, undefined);
    assert.match(output.stderr, /^TIMEOUT {2}the build did not finish\nwarning: wrote onto task 1$/);
});

const writeReport = (over = {}) => ({
    kind: 'write',
    target: 'cc.Sprite',
    undoNote: null,
    writes: [{
        target: 'cc.Sprite',
        property: 'color',
        value: '#ffffff',
        report: { written: true, verified: true, persisted: true, channel: 'editor', ...over }
    }]
});

// The verdict is computed from the report's data: a command never passes it and so cannot drift
// from what gets printed.
test('a write a save will drop is UNPERSISTED with its own exit code', () => {
    const output = present(writeReport({ persisted: false }));
    assert.equal(output.exitCode, 4);
    assert.match(output.stderr, /^UNPERSISTED {2}cc\.Sprite\.color/);
});

test('a write nobody checked for persistence is UNVERIFIED rather than ok', () => {
    const output = present(writeReport({ persisted: null }));
    assert.equal(output.exitCode, 3);
    assert.match(output.stderr, /^UNVERIFIED {2}cc\.Sprite\.color/);
});

test('on the live channel persisted=false stays a success', () => {
    const output = present(writeReport({ persisted: false, channel: 'live' }));
    assert.equal(output.exitCode, 0);
    assert.match(output.stdout, /^cc\.Sprite\.color/);
});

// The word already opens each write's own line; a report-wide head above them would be the head
// line this report shape dropped.
test('a write batch is not given a head line of its own', () => {
    const output = present(writeReport({ persisted: false }));
    assert.equal(output.stderr.split('\n').length, 1);
});

const settle = (over = {}) => ({
    kind: 'asset',
    asset: {
        action: 'refreshed', target: 'db://assets/f', landedAt: 'db://assets/f', elapsedMs: 60000,
        settled: true, assets: { added: [], removed: [], changed: [] },
        classes: { added: [], removed: [] }, ...over
    }
});

test('a database that did not go quiet within the timeout is TIMEOUT', () => {
    const output = present(settle({ settled: false }));
    assert.equal(output.exitCode, 5);
    assert.match(output.stderr, /^TIMEOUT {2}db:\/\/assets\/f/);
});

test('a class delta the scene never answered makes the whole read UNVERIFIED', () => {
    const output = present(settle({ classes: null }));
    assert.equal(output.exitCode, 3);
    assert.match(output.stderr, /component classes: unknown/);
});

const ASSET = { name: 'rifle', type: 'cc.Prefab', uuid: 'u-1', url: 'db://assets/rifle.prefab' };

// `--field` exists to be substituted into a shell variable, so it answers a bare value.
test('--field answers one value and nothing around it', () => {
    assert.equal(present({ kind: 'assetInfo', asset: ASSET, field: 'uuid' }).stdout, 'u-1');
});

const missing = (entries) => ({ kind: 'sceneMissing', missing: { entries } });

test('a dead component in the scene is an outcome rather than a calm report', () => {
    const found = present(missing([{ nodePath: 'a', nodeUuid: 'u', componentUuid: 'c', cid: null }]));
    assert.equal(found.exitCode, 1);
    assert.match(found.stderr, /^FAILED\n/);
    assert.equal(present(missing([])).exitCode, 0);
});

const reading = (over = {}) => ({
    name: 'target', type: 'cc.Node', kind: 'nodeRef', value: 'u-hero', label: null,
    differsFromDefault: false, hiddenInInspector: false, ...over
});

const address = {
    nodePath: 'Canvas/Bg', nodeUuid: 'u-bg',
    choice: {
        index: 0, className: 'Npc', label: 'Npc', sameClassIndex: 0, uuid: 'c-npc', cid: null,
        enabled: true
    }
};

// A hidden property is reachable only through --prop, so this read is the only place that can say
// the inspector does not draw it; the value line carries neither fact.
test('a value that drifted from the default and one the inspector hides are named in the head', () => {
    const output = present({
        kind: 'componentProperty',
        address,
        reading: reading({ differsFromDefault: true, hiddenInInspector: true }),
        references: new Map()
    });
    assert.match(output.stdout.split('\n')[0], /differs from the default {2}hidden in the inspector$/);
});

test('a reference prints as the node name rather than a bare uuid when the index knows it', () => {
    const output = present({
        kind: 'componentProperty',
        address,
        reading: reading(),
        references: new Map([['u-hero', { kind: 'node', path: 'Characters/hero' }]])
    });
    assert.match(output.stdout, /^Npc\.target {2}cc\.Node\nCharacters\/hero {2}u-hero$/);
});

// The scene refusing to name the references answered part of the question; unread data must not
// reach the caller looking like absent data.
test('a read that could not name its references is UNVERIFIED and goes to stderr', () => {
    const output = present({
        kind: 'componentProperty',
        address,
        reading: reading(),
        references: new Map(),
        unread: 'the scene could not be enumerated'
    });
    assert.equal(output.exitCode, 3);
    assert.equal(output.stdout, undefined);
    assert.match(output.stderr, /the scene could not be enumerated/);
});

test('the hidden properties reach the head and the read count does not', () => {
    const output = present({
        kind: 'componentProperties',
        address,
        readings: [reading(), reading({ name: 'speed', type: 'Number', kind: 'scalar', value: 3 })],
        hidden: ['_id'],
        references: new Map()
    });
    assert.match(output.stdout, /hidden: 1/);
    assert.doesNotMatch(output.stdout, /properties: 2/);
});

test('an uncut listing gets no head line counting its own rows', () => {
    const output = present({
        kind: 'assetList', assets: [{ ...ASSET, type: 'cc.Prefab' }], total: 1
    });
    assert.doesNotMatch(output.stdout, /assets: 1/);
});

test('a cut listing names the count the rows cannot give', () => {
    const output = present({ kind: 'assetList', assets: [ASSET], total: 254 });
    assert.match(output.stdout, /^assets: 254, showing 1\n/);
});
