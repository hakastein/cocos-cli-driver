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

const COMMAND_OF: Record<string, string> = {
    'editor.scene.openScene': 'scene open',
    'editor.scene.closeScene': 'scene close'
};

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
        method: typeof data.method === 'string' ? data.method : '',
        detail: typeof data.detail === 'string' ? data.detail : undefined
    };
}

/**
 * Two notions of "changed" meet here. The editor's own flag counts undo steps, so an action that
 * put the scene back the way it was still raises it; whether a save would carry anything is the
 * disk comparison's question, and it is the one that says whether `scene save` is about to write
 * real work or the same bytes.
 */
export function gateReport(refusal: GateRefusal, disk: DiskAnswer | null): Report {
    const command = COMMAND_OF[refusal.method] || 'the command';
    if (refusal.reason === 'unknown') {
        return {
            kind: 'action',
            verdict: 'FAILED',
            summary: `${command} was not run: the editor did not say whether it holds unsaved `
                + `changes (${refusal.detail || 'no answer'})`
        };
    }
    return {
        kind: 'action',
        verdict: 'FAILED',
        summary: `${command} was not run: the editor holds an unsaved scene, and running it would `
            + `raise a dialog that stops every command for this project until a person answers it. `
            + remedy(disk)
    };
}

function remedy(disk: DiskAnswer | null): string {
    if (!disk || !disk.ok) {
        return 'Save with `cocos scene save`, or put the scene back the way it was and save.';
    }
    const where = disk.dirty.scenePath || 'the file on disk';
    if (!disk.dirty.differsFromDisk) {
        return `The scene matches ${where}, so nothing a save would carry has changed: `
            + '`cocos scene save` writes the same bytes and clears the flag.';
    }
    return `The scene differs from ${where} in ${disk.dirty.diffs.length} place(s): save with `
        + '`cocos scene save`, or put it back the way it was and save.';
}
