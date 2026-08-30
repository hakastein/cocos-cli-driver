import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildRunHead, buildVerdict, buildWarnings, renderBuildRun, renderBuilderStatus
} from '../src/render/build.ts';

const RUN = {
    platform: 'web-mobile',
    taskId: '1785322023936',
    taskName: 'SHOWCASE',
    rebuiltExistingTask: true,
    exitCode: 36,
    exitName: 'BUILD_SUCCESS',
    state: 'success',
    buildPath: 'project://build',
    outputName: 'web-mobile',
    debug: false,
    builderMessage: 'build finished',
    elapsedMs: 148300,
    modifiedTaskSettings: [],
    overwrites: null,
    timedOut: false
};

const STATUS = {
    ready: true,
    idle: true,
    tasks: [
        {
            id: '1785322023936', platform: 'web-mobile', state: 'success', name: 'SHOWCASE',
            progress: 1, message: 'build finished'
        },
        {
            id: '1785322023937', platform: 'android', state: 'processing', name: 'debug',
            progress: 0.42, message: 'compiling'
        }
    ]
};

test('the exit code is the authority and the task state confirms it', () => {
    assert.equal(buildVerdict(RUN), 'ok');
    assert.equal(buildVerdict({ ...RUN, exitCode: 34, exitName: 'BUILD_FAILED' }), 'FAILED');
});

test('no task to read the build back from leaves a successful exit code unconfirmed', () => {
    assert.equal(buildVerdict({ ...RUN, state: 'unknown' }), 'UNVERIFIED');
});

test('a task state that contradicts a successful exit code fails — nobody-looked is the other word', () => {
    assert.equal(buildVerdict({ ...RUN, state: 'failure' }), 'FAILED');
    assert.equal(buildVerdict({ ...RUN, state: 'processing' }), 'FAILED');
});

test('with no exit code the task state is all there is', () => {
    const silent = { ...RUN, exitCode: null, exitName: null };
    assert.equal(buildVerdict(silent), 'ok');
    assert.equal(buildVerdict({ ...silent, state: 'failure' }), 'FAILED');
    assert.equal(buildVerdict({ ...silent, state: 'unknown' }), 'UNVERIFIED');
});

test('a wait that ran out is a TIMEOUT — the build is still running in the editor', () => {
    assert.equal(buildVerdict({ ...RUN, timedOut: true, exitCode: null, exitName: null, state: 'unknown' }),
        'TIMEOUT');
});

// The presenter puts the verdict word in front of this line; the renderer never carries `ok`.
test('the head names the platform, the exit code and the state, with no verdict word', () => {
    assert.equal(buildRunHead(RUN),
        'web-mobile  BUILD_SUCCESS(36)  state=success  debug=false  148.3s');
});

test('the task that was built and where its output landed are on their own lines', () => {
    const text = renderBuildRun(RUN);
    assert.match(text, /^task 1785322023936 "SHOWCASE" {2}rebuilt in place$/m);
    assert.match(text, /^output project:\/\/build\/web-mobile$/m);
});

test('a new task says it was added rather than rebuilt', () => {
    assert.match(renderBuildRun({ ...RUN, rebuiltExistingTask: false }), /^task .* {2}added as a new task$/m);
});

// A build that edited the Build panel row it rebuilt did something past what was asked of it.
test('settings the build wrote onto the task are warned about — that edit is permanent', () => {
    const warnings = buildWarnings({ ...RUN, modifiedTaskSettings: ['debug', 'sourceMaps'] });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /debug, sourceMaps/);
});

test('a new task landing on another row output says whose artefacts it replaces', () => {
    const warnings = buildWarnings({ ...RUN, rebuiltExistingTask: false, overwrites: '1785322023936' });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /task 1785322023936 also writes/);
});

test('a build that changed nothing about the panel warns about nothing', () => {
    assert.deepEqual(buildWarnings(RUN), []);
});

test('the worker line and the task rows are both on stdout', () => {
    const text = renderBuilderStatus(STATUS);
    assert.match(text, /^worker ready {2}idle$/m);
    assert.match(text, /^1785322023936 {2}web-mobile {2}success {5}SHOWCASE {2}build finished$/m);
    assert.match(text, /^1785322023937 {2}android {5}processing {2}debug {5}42% compiling$/m);
});

test('a worker that is not up says so, and an unknown idle flag is not printed as busy', () => {
    assert.match(renderBuilderStatus({ ready: false, idle: null, tasks: [] }), /^worker not ready$/m);
});

test('an empty Build panel says so instead of printing one bare line', () => {
    assert.match(renderBuilderStatus({ ready: true, idle: true, tasks: [] }), /no build tasks/);
});

