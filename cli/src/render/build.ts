import { BuildExitCode } from '../build-task.ts';
import { table } from './columns.ts';
import type { BuildRunReport, BuilderStatus } from '../build-task.ts';
import type { Verdict } from './verdict.ts';

/**
 * The exit code table is the editor's own, so a code that is not BUILD_SUCCESS is a build that did
 * not happen. `unknown` is the state of a task nobody could read back, and only that answers
 * `UNVERIFIED`: a row that says anything other than `success` has read the build back and
 * contradicted it, which is the same difference `persisted: null` keeps from `persisted: false`.
 */
export function buildVerdict(run: BuildRunReport): Verdict {
    if (run.timedOut) return 'TIMEOUT';
    if (run.exitCode !== null && run.exitCode !== BuildExitCode.BUILD_SUCCESS) return 'FAILED';
    if (run.state === 'unknown') return 'UNVERIFIED';
    return run.state === 'success' ? 'ok' : 'FAILED';
}

export function buildRunHead(run: BuildRunReport): string {
    return [
        run.platform,
        run.exitName === null ? 'no exit code' : `${run.exitName}(${run.exitCode})`,
        `state=${run.state}`,
        `debug=${run.debug === undefined ? 'unknown' : run.debug}`,
        `${(run.elapsedMs / 1000).toFixed(1)}s`
    ].join('  ');
}

export function renderBuildRun(run: BuildRunReport): string {
    const lines: string[] = [];
    if (run.taskId !== null) {
        lines.push(`task ${run.taskId}${run.taskName ? ` "${run.taskName}"` : ''}  ${
            run.rebuiltExistingTask ? 'rebuilt in place' : 'added as a new task'}`);
    }
    if (run.buildPath || run.outputName) {
        lines.push(`output ${run.buildPath || '?'}/${run.outputName || '?'}`);
    }
    if (run.builderMessage) lines.push(run.builderMessage);
    return lines.join('\n');
}

export function buildWarnings(run: BuildRunReport): string[] {
    const warnings: string[] = [];
    if (run.modifiedTaskSettings.length) {
        warnings.push(`wrote onto task ${run.taskId}: ${run.modifiedTaskSettings.join(', ')} — `
            + 'that edit to the Build panel row is permanent');
    }
    if (run.overwrites) {
        warnings.push(`this new task writes to ${run.buildPath}/${run.outputName}, where task `
            + `${run.overwrites} also writes: that task's build output is replaced`);
    }
    return warnings;
}

export function renderBuilderStatus(status: BuilderStatus): string {
    const worker = [
        status.ready ? 'worker ready' : 'worker not ready',
        status.idle === null ? '' : status.idle ? 'idle' : 'busy'
    ].filter(Boolean).join('  ');

    if (!status.tasks.length) {
        return `${worker}\nno build tasks — the Build panel has no rows to rebuild`;
    }
    return [worker, ...table(status.tasks.map(task => [
        task.id, task.platform, task.state, task.name,
        task.progress === null || task.progress >= 1
            ? task.message
            : `${Math.round(task.progress * 100)}% ${task.message}`.trim()
    ]))].join('\n');
}
