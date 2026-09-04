import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ReplyTimeout, missedReplyReport, replyBudgetMs, replyTimeout
} from '../src/reply-deadline.ts';

// A build runs for minutes and `build run` bounds it with `--timeout`; a budget here would cut it
// short, and one wide enough for the longest build would bound nothing else.
test('a build waits as long as its own command lets it, everything else waits the budget', () => {
    assert.equal(replyBudgetMs('editor.builder.addTask', 60000), null);
    assert.equal(replyBudgetMs('editor.scene.openScene', 60000), 60000);
    assert.equal(replyBudgetMs('scene.dumpSceneNodes', 60000), 60000);
});

test('the missed request is recognised by what it carries, not by the class it was thrown as', () => {
    const missed = { method: 'scene.dumpSceneNodes', project: 'thuglife', waitedMs: 60000 };
    assert.deepEqual(replyTimeout(new ReplyTimeout(missed)), missed);
    assert.deepEqual(replyTimeout({ missed }), missed);
    assert.equal(replyTimeout(new Error('the connection to the editor closed')), null);
    assert.equal(replyTimeout(null), null);
});

test('a missed reply names the request and the project that went quiet', () => {
    const report = missedReplyReport(
        { method: 'editor.scene.openScene', project: 'CyberCore', waitedMs: 60000 });
    assert.equal(report.verdict, 'TIMEOUT');
    assert.ok(report.summary.includes('editor.scene.openScene'));
    assert.ok(report.summary.includes('CyberCore'));
});
