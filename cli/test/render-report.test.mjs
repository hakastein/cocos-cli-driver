import test from 'node:test';
import assert from 'node:assert/strict';

import { renderWriteReport, renderWrites, writeVerdict, writesVerdict } from '../src/render/report.ts';
import { worstVerdict } from '../src/render/verdict.ts';

const write = (report = {}, over = {}) => ({
    target: 'Sprite',
    property: 'color',
    report: { written: true, verified: true, persisted: true, channel: 'editor', ...report },
    ...over
});

test('a write that landed and survives a save costs no verdict word', () => {
    const text = renderWriteReport(write({}, { value: '#ffffff' }));
    assert.match(text, /^Sprite\.color = "#ffffff"/);
    assert.match(text, /persisted=true/);
});

test('persisted=null prints as unknown rather than as false', () => {
    const text = renderWriteReport(write({ persisted: null }));
    assert.match(text, /persisted=unknown/);
    assert.doesNotMatch(text, /persisted=false/);
});

// Everyone reads the first word and nobody reads the tail: a write a save will drop has no right
// to look like one that landed, even when the read-back confirmed it.
test('a verified write a save will drop is called UNPERSISTED', () => {
    const text = renderWriteReport(write({ verified: true, persisted: false, channel: 'editor' }));
    assert.equal(text.split('  ')[0], 'UNPERSISTED');
    assert.equal(
        writeVerdict({ written: true, verified: true, persisted: false, channel: 'editor' }),
        'UNPERSISTED');
});

test('on the live channel persisted=false is no failure — nothing there serializes', () => {
    assert.equal(
        writeVerdict({ written: true, verified: true, persisted: false, channel: 'live' }), 'ok');
});

// `ok` used to cover the state nobody had looked into, printing `persisted=unknown` on the same
// line as the word that says a save carries it.
test('a write whose persistence nobody checked is UNVERIFIED', () => {
    assert.equal(
        writeVerdict({ written: true, verified: true, persisted: null, channel: 'editor' }),
        'UNVERIFIED');
});

test('an unwritten value is FAILED either way', () => {
    assert.equal(writeVerdict({ written: false, verified: false, persisted: null }), 'FAILED');
});

test('a write the read-back did not confirm is UNVERIFIED, neither ok nor FAILED', () => {
    const report = { written: true, verified: false, persisted: true, channel: 'editor' };
    assert.equal(writeVerdict(report), 'UNVERIFIED');
    assert.equal(renderWriteReport(write(report)).split('  ')[0], 'UNVERIFIED');
});

test('a channel the report did not name prints as unknown', () => {
    const text = renderWriteReport(write({ channel: undefined }));
    assert.match(text, /channel=unknown/);
});

test('written but unverified is not the same as never written', () => {
    const written = renderWriteReport(write({ written: true, verified: false, persisted: true }));
    const notWritten = renderWriteReport(write({ written: false, verified: false, persisted: null }));
    assert.equal(written.split('  ')[0], 'UNVERIFIED');
    assert.equal(notWritten.split('  ')[0], 'FAILED');
});

test('the report detail reaches the line', () => {
    const text = renderWriteReport(write({ detail: 'the serializer does not emit this property' }));
    assert.match(text, /the serializer does not emit/);
});

const batch = (writes) => renderWrites({ target: 'Environment/Guard', writes });

// A line pulled out of a merged log has no line above it to take its subject from.
test('a write names its own target and property whether it is alone or one of two', () => {
    const alone = batch([write({}, { value: '#ffffff' })]);
    assert.equal(alone.split('\n').length, 1);
    assert.match(alone, /^Sprite\.color = "#ffffff"/);

    const pair = batch([
        write({}, { target: 'Environment/Guard', property: 'name', value: 'Sentry' }),
        write({ persisted: false }, { target: 'Environment/Guard', property: 'position' })
    ]).split('\n');
    assert.equal(pair.length, 2);
    assert.match(pair[0], /^Environment\/Guard\.name = "Sentry"/);
    assert.match(pair[1], /^UNPERSISTED {2}Environment\/Guard\.position/);
});

test('nothing asked for is said out loud rather than passing for a write that landed', () => {
    assert.equal(batch([]), 'Environment/Guard  nothing to write');
});

test('the batch verdict is the worst write and nothing else', () => {
    assert.equal(writesVerdict([write(), write()]), 'ok');
    assert.equal(writesVerdict([write(), write({ verified: false })]), 'UNVERIFIED');
    assert.equal(writesVerdict([write({ persisted: false }), write({ written: false })]), 'FAILED');
    assert.equal(writesVerdict([]), 'ok');
});

test('severity puts FAILED above UNPERSISTED above UNVERIFIED above ok', () => {
    assert.equal(worstVerdict(['ok', 'UNVERIFIED']), 'UNVERIFIED');
    assert.equal(worstVerdict(['UNVERIFIED', 'UNPERSISTED']), 'UNPERSISTED');
    assert.equal(worstVerdict(['UNPERSISTED', 'TIMEOUT']), 'TIMEOUT');
    assert.equal(worstVerdict(['TIMEOUT', 'FAILED']), 'FAILED');
    assert.equal(worstVerdict([]), 'ok');
});
