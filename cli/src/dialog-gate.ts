import { GATE_DIRTY_UNKNOWN, GATE_EDITOR_DIRTY } from '@cocos-cli/shared';
import type { SceneDirtyReport } from '@cocos-cli/shared';
import type { Report } from './render/present.ts';

export interface GateRefusal {
    /** `dirty` — the flag was read and is raised; `unknown` — it was not read at all. */
    reason: 'dirty' | 'unknown';
    method: string;
    detail?: string;
}

/** What the disk comparison answered on the refusal path, or why it did not. */
export type DiskAnswer =
    | { ok: true; dirty: SceneDirtyReport }
    | { ok: false; error: string };

interface CodedError {
    code?: unknown;
    data?: unknown;
}

/**
 * The driver refuses a prompting primitive with its own JSON-RPC code, which `JSONRPCClient`
 * carries onto the rejection. Recognised by that code rather than by the message text, so a
 * reworded refusal does not become an unrecognised crash.
 */
export function gateRefusal(error: unknown): GateRefusal | null {
    const coded = error as CodedError | null;
    if (!coded || (coded.code !== GATE_EDITOR_DIRTY && coded.code !== GATE_DIRTY_UNKNOWN)) {
        return null;
    }
    const data = (coded.data || {}) as { method?: unknown; detail?: unknown };
    return {
        reason: coded.code === GATE_EDITOR_DIRTY ? 'dirty' : 'unknown',
        method: typeof data.method === 'string' ? data.method : 'the call',
        detail: typeof data.detail === 'string' ? data.detail : undefined
    };
}

/**
 * Two notions of "changed" meet here, and the refusal names both. The editor's own flag counts
 * undo steps, so an action that put the scene back the way it was still raises it; whether a save
 * would carry anything is the disk comparison's question, and it is the one that says whether
 * `scene save` is about to write real work or the same bytes.
 *
 * A flag that could not be read is `UNVERIFIED` rather than `FAILED`: the call was not made, and
 * nothing proves it would have waited for a person.
 */
export function gateReport(refusal: GateRefusal, disk: DiskAnswer | null): Report {
    if (refusal.reason === 'unknown') {
        return {
            kind: 'action',
            verdict: 'UNVERIFIED',
            summary: `${refusal.method} was not sent: the editor did not say whether it holds `
                + 'unsaved changes',
            note: refusal.detail
                ? `${refusal.detail}; nothing in the scene was touched`
                : 'nothing in the scene was touched'
        };
    }
    return {
        kind: 'action',
        verdict: 'FAILED',
        summary: `${refusal.method} was not sent: the editor holds an unsaved scene, and sending it `
            + 'would raise a dialog that waits for a person while every later command queues behind it',
        note: remedy(disk)
    };
}

function remedy(disk: DiskAnswer | null): string {
    if (!disk) {
        return 'save with `cocos scene save`, or put the scene back the way it was with the '
            + 'commands that changed it and then save';
    }
    if (!disk.ok) {
        return `whether the scene differs from disk could not be read (${disk.error}); `
            + '`cocos scene save` clears the flag either way';
    }
    const where = disk.dirty.scenePath || 'the file on disk';
    if (!disk.dirty.differsFromDisk) {
        return `the open scene matches ${where}, so the flag came from an action that changed `
            + 'nothing a save would carry; `cocos scene save` writes the same bytes and clears it';
    }
    return `the open scene differs from ${where} in ${disk.dirty.diffs.length} place(s): save with `
        + '`cocos scene save`, or put the scene back the way it was with the commands that changed '
        + 'it and then save';
}
