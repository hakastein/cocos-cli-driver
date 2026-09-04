import type { Report } from './render/present.ts';

/**
 * How long one request may go unanswered before the CLI stops waiting. The driver serves one
 * request at a time, so a modal dialog nobody is sitting in front of stops every command for that
 * project — and `dialog-gate.ts`'s list of primitives that raise one will always trail what the
 * editor thinks of asking, while a deadline covers the class. Measured 2026-09-04 against both open
 * projects: `scene tree` on 1442 nodes, `scene dirty`, `asset ls db://assets`, `scene owners` and
 * `build status` each answered inside 350ms, process start included.
 */
export const DEFAULT_REPLY_TIMEOUT_MS = 60_000;

/**
 * `builder.addTask` with `waitForFinish` resolves only when the build does, which is minutes, and
 * `build run` already bounds that wait with its own `--timeout`. A budget here would either cut a
 * legitimate build short or have to be as wide as the longest build, which is no budget at all.
 */
const CALLER_BOUNDED = new Set<string>(['editor.builder.addTask']);

export function replyBudgetMs(method: string, budgetMs: number): number | null {
    return CALLER_BOUNDED.has(method) ? null : budgetMs;
}

export interface MissedReply {
    /** The dotted name as it went over the wire: `editor.scene.openScene`, `scene.dumpSceneNodes`. */
    method: string;
    project: string;
    waitedMs: number;
}

export class ReplyTimeout extends Error {
    readonly missed: MissedReply;

    constructor(missed: MissedReply) {
        super(`${missed.method}: ${missed.project} did not answer in ${missed.waitedMs}ms`);
        this.missed = missed;
    }
}

export function replyTimeout(error: unknown): MissedReply | null {
    const carried = (error as { missed?: unknown } | null)?.missed as MissedReply | undefined;
    return carried && typeof carried.method === 'string' ? carried : null;
}

/** What the client recorded, for a command that answered the rejection with a `catch` of its own. */
export interface ReplyWatch {
    missed(): MissedReply | null;
}

export function missedReplyReport(missed: MissedReply): Report {
    return {
        kind: 'action',
        verdict: 'TIMEOUT',
        summary: `${missed.method}: ${missed.project} did not answer in `
            + `${Math.round(missed.waitedMs / 1000)}s. The editor answers one request at a time, so `
            + `whatever it is busy with holds up every command for this project — most often a modal `
            + `dialog waiting for a person, which somebody has to answer in the editor.`
    };
}
