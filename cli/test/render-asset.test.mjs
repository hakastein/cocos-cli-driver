import test from 'node:test';
import assert from 'node:assert/strict';

import * as r from '../src/render/asset.ts';

const {
    assetField, renderAssetInfo, renderAssetList, assetListHead, renderAssetReport,
    assetVerdict, renderAssetUsers
} = r;

const asset = (over = {}) => ({
    name: 'rifle', type: 'cc.Prefab', uuid: 'u-1', url: 'db://assets/rifle.prefab',
    importer: 'prefab', imported: true, file: 'D:\\p\\rifle.prefab', ...over
});

const report = (over = {}) => ({
    action: 'refreshed', target: 'db://assets/framework', landedAt: 'db://assets/framework',
    elapsedMs: 8400, settled: true, assets: { added: [], removed: [], changed: [] },
    classes: { added: [], removed: [] }, ...over
});

test('assetField hands back one bare value, the form that goes into a shell variable', () => {
    assert.equal(assetField(asset(), 'uuid'), 'u-1');
    assert.equal(assetField(asset(), 'url'), 'db://assets/rifle.prefab');
});

test('a missing importer reads as empty rather than as the string undefined', () => {
    assert.equal(assetField(asset({ importer: undefined }), 'importer'), '');
});

test('assetField counts sub-assets instead of printing them', () => {
    assert.equal(assetField(asset({ subAssets: { a: {}, b: {} } }), 'subAssets'), '2');
    assert.equal(assetField(asset(), 'subAssets'), '0');
});

test('an unknown field names the ones that exist', () => {
    assert.throws(() => assetField(asset(), 'nope'), /importer/);
});

test('renderAssetInfo prints the uuid and drops the fields the asset does not carry', () => {
    const text = renderAssetInfo(asset({ importer: undefined, file: undefined }));
    assert.match(text, /^uuid\s+u-1$/m);
    assert.equal(/importer/.test(text), false);
    assert.equal(/file/.test(text), false);
});

test('renderAssetInfo names an invalid import, which type alone would hide', () => {
    assert.match(renderAssetInfo(asset({ invalid: true })), /^invalid\s+true$/m);
});

test('renderAssetList marks a folder with a trailing slash', () => {
    const text = renderAssetList([asset({ url: 'db://assets/weapon', isDirectory: true, type: 'database' })]);
    assert.match(text, /db:\/\/assets\/weapon\//);
});

test('renderAssetList says so rather than printing an empty string', () => {
    assert.equal(renderAssetList([]), 'no asset matched');
});

// A head line over an uncut listing would only give back the number of lines under it.
test('only a cut listing gets a head, and it names the count the rows cannot give', () => {
    assert.equal(assetListHead(3, 3), undefined);
    assert.equal(assetListHead(15, 254), 'assets: 254, showing 15');
});

test('an untouched database says so rather than printing an empty diff', () => {
    assert.equal(
        renderAssetReport(report()).head, 'db://assets/framework  refreshed in 8.4s  no changes');
});

test('the newly registered class is named — that is what a refresh is run for', () => {
    const { body } = renderAssetReport(report({
        assets: { added: ['db://assets/f/TargetPolicy.ts'], removed: [], changed: [] },
        classes: { added: ['TargetPolicy'], removed: ['Npc'] }
    }));
    assert.match(body, /component classes: \+TargetPolicy {2}-Npc/);
    assert.match(body, /^assets: \+1 {2}-0 {2}~0$/m);
    assert.match(body, /^ {2}\+ db:\/\/assets\/f\/TargetPolicy\.ts$/m);
});

test('an operation that did not happen outranks the settle verdict', () => {
    const failed = report({ settled: true, failure: 'the asset stayed where it was' });
    assert.equal(assetVerdict(failed), 'FAILED');
    assert.match(renderAssetReport(failed).body, /the asset stayed where it was/);
});

// The database answers before the import ends, so `the command ran` and `the database finished
// importing` are different news, and the second one decides the verdict.
test('a database still working when the timeout ran out is a TIMEOUT, not a FAILED', () => {
    assert.equal(assetVerdict(report({ settled: false })), 'TIMEOUT');
    assert.equal(assetVerdict(report({ settled: false, failure: 'the asset stayed where it was' })), 'FAILED');
    assert.equal(assetVerdict(report()), 'ok');
});

test('a long list is capped and says how many it did not print', () => {
    const urls = Array.from({ length: 5 }, (_unused, index) => `db://assets/${index}.ts`);
    const { body } = renderAssetReport(
        report({ assets: { added: urls, removed: [], changed: [] } }), 2);
    assert.match(body, /\+ … and 3 more/);
    assert.equal(/db:\/\/assets\/4\.ts/.test(body), false);
});

// Silence about the class delta and an empty delta are different answers: without the distinction
// `the class never showed up` reads as `the class did not change`.
test('a class list the scene never answered is unread rather than unchanged', () => {
    assert.match(renderAssetReport(report({ classes: null })).body, /component classes: unknown/);
    assert.match(renderAssetReport(report()).body, /component classes: unchanged/);
    assert.equal(assetVerdict(report({ classes: null })), 'UNVERIFIED');
});

// The database renames on conflict by default, so the address asked for and the address reached are
// two different facts and the second one is what a following command has to use.
test('an asset that landed somewhere other than the address asked for says where', () => {
    const { head } = renderAssetReport(report({
        action: 'moved from db://assets/a.prefab', target: 'db://assets/b.prefab',
        landedAt: 'db://assets/b-001.prefab'
    }));
    assert.match(head, /landed at db:\/\/assets\/b-001\.prefab/);
});

test('an asset that reached the address asked for does not repeat it', () => {
    assert.doesNotMatch(renderAssetReport(report()).head, /landed at/);
});

test('an asset at no address at all is not passed off as having landed', () => {
    assert.doesNotMatch(renderAssetReport(report({ landedAt: null })).head, /landed at/);
});

const users = (list) => ({ asset: 'db://assets/weapon/prefab/rifle.prefab', nodes: list });

test('a using node prints its path and its uuid', () => {
    const text = renderAssetUsers(users([{ path: 'Characters/cc_hero', uuid: 'n-1' }]));
    assert.match(text, /Characters\/cc_hero/);
    assert.match(text, /n-1/);
});

// The scene dump is what turns a uuid into a path; a node the dump does not carry still gets named,
// because dropping it would understate how much of the scene depends on the asset.
test('a node the scene dump did not name still prints, by uuid', () => {
    const text = renderAssetUsers(users([{ path: null, uuid: 'n-2' }]));
    assert.match(text, /n-2/);
    assert.match(text, /path unknown/);
});

test('an asset nothing uses is said outright rather than printed as an empty list', () => {
    assert.match(renderAssetUsers(users([])), /no node/);
});

