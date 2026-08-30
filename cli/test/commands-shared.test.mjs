import test from 'node:test';
import assert from 'node:assert/strict';

import { unwrap, withClient, withProject } from '../src/commands/shared.ts';
import { MemoryDriver } from '../src/driver/memory.ts';

/** The two process streams and the exit code are the only place a command's output can be read. */
async function capture(body) {
    const out = [];
    const err = [];
    const stdout = process.stdout.write;
    const stderr = process.stderr.write;
    const exitCodeBefore = process.exitCode;
    process.stdout.write = chunk => { out.push(String(chunk)); return true; };
    process.stderr.write = chunk => { err.push(String(chunk)); return true; };
    try {
        await body();
        return { stdout: out.join(''), stderr: err.join(''), exitCode: process.exitCode };
    } finally {
        process.stdout.write = stdout;
        process.stderr.write = stderr;
        process.exitCode = exitCodeBefore;
    }
}

const connected = () => {
    const client = new MemoryDriver({ nodes: [] });
    let closed = false;
    client.close = () => { closed = true; };
    return { resolve: async () => ({ ok: true, client }), closed: () => closed };
};

const noEditor = () => async () => ({ ok: false, message: 'no editor is running' });

test('a report reaches stdout and leaves the exit code alone', async () => {
    const editor = connected();
    const seen = await capture(() => withClient(editor.resolve,
        async () => ({ kind: 'action', verdict: 'ok', summary: 'the scene was saved' })));
    assert.equal(seen.stdout, 'the scene was saved\n');
    assert.equal(seen.stderr, '');
    assert.equal(seen.exitCode, undefined);
});

test('a failing verdict takes the whole report to stderr and leaves stdout empty', async () => {
    const editor = connected();
    const seen = await capture(() => withClient(editor.resolve,
        async () => ({ kind: 'action', verdict: 'FAILED', summary: 'the node is gone' })));
    assert.equal(seen.stdout, '');
    assert.equal(seen.stderr, 'FAILED  the node is gone\n');
    assert.equal(seen.exitCode, 1);
});

// A merged log of both streams has to read the same way for either, so a thrown error carries the
// mark a refusal that did reach a report carries.
test('a thrown error is marked FAILED on stderr, with nothing on stdout', async () => {
    const editor = connected();
    const seen = await capture(() => withClient(editor.resolve, async () => {
        throw new Error('the scene script did not answer setNodeProperty');
    }));
    assert.equal(seen.stdout, '');
    assert.equal(seen.stderr, 'FAILED  the scene script did not answer setNodeProperty\n');
    assert.equal(seen.exitCode, 1);
});

test('the connection is closed whether the command answered or threw', async () => {
    const answered = connected();
    await capture(() => withClient(answered.resolve,
        async () => ({ kind: 'action', verdict: 'ok', summary: 'done' })));
    assert.equal(answered.closed(), true);

    const threw = connected();
    await capture(() => withClient(threw.resolve, async () => { throw new Error('refused'); }));
    assert.equal(threw.closed(), true);
});

test('no editor to talk to is its own exit code, and the command body never runs', async () => {
    let ran = false;
    const seen = await capture(() => withClient(noEditor(), async () => {
        ran = true;
        return { kind: 'action', verdict: 'ok', summary: 'unreachable' };
    }));
    assert.equal(ran, false);
    assert.equal(seen.stderr, 'FAILED  no editor is running\n');
    assert.equal(seen.stdout, '');
    assert.equal(seen.exitCode, 6);
});

const openProject = () => async () => ({ ok: true, hello: { projectPath: 'D:/CyberCore' } });

test('a command that needs only the project gets its path and opens no connection', async () => {
    let seenPath = null;
    const seen = await capture(() => withProject(openProject(), async hello => {
        seenPath = hello.projectPath;
        return { kind: 'action', verdict: 'ok', summary: 'swept' };
    }));
    assert.equal(seenPath, 'D:/CyberCore');
    assert.equal(seen.stdout, 'swept\n');
});

test('with no editor open the project body never runs either', async () => {
    let ran = false;
    const seen = await capture(() => withProject(noEditor(), async () => {
        ran = true;
        return { kind: 'action', verdict: 'ok', summary: 'unreachable' };
    }));
    assert.equal(ran, false);
    assert.equal(seen.exitCode, 6);
});

test('a project body that throws is a marked message on stderr and a non-zero exit', async () => {
    const seen = await capture(() => withProject(openProject(), async () => {
        throw new Error('could not read D:/CyberCore/assets');
    }));
    assert.equal(seen.stdout, '');
    assert.equal(seen.stderr, 'FAILED  could not read D:/CyberCore/assets\n');
    assert.equal(seen.exitCode, 1);
});

// The class of failure has to be readable off the number alone, without parsing the text.
test('each failing class carries its own exit code out to the process', async () => {
    const editor = connected();
    const codes = {};
    for (const verdict of ['UNVERIFIED', 'UNPERSISTED', 'TIMEOUT']) {
        const seen = await capture(() => withClient(editor.resolve,
            async () => ({ kind: 'action', verdict, summary: 'x' })));
        codes[verdict] = seen.exitCode;
    }
    assert.deepEqual(codes, { UNVERIFIED: 3, UNPERSISTED: 4, TIMEOUT: 5 });
});

test('unwrap answers with the data the scene script sent', async () => {
    assert.deepEqual(await unwrap({ success: true, data: { name: 'Hero' } }, 'getNodeInfo'),
        { name: 'Hero' });
});

test("unwrap throws the scene script's own refusal rather than a message of its own", async () => {
    await assert.rejects(
        () => unwrap({ success: false, error: "Node 'Hero' has no 'cc.Sprite' component" }, 'getNodeInfo'),
        error => error.message === "Node 'Hero' has no 'cc.Sprite' component");
});

test('a scene answer carrying no data names the method that stayed silent', async () => {
    await assert.rejects(() => unwrap({ success: true }, 'serializedNodeValue'),
        error => error.message === 'the scene script did not answer serializedNodeValue');
});
