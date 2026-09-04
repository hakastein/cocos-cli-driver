import type { EditorMethod } from './protocol';

/**
 * The primitives the editor answers by raising a modal dialog when it holds its own dirty flag —
 * the one that draws the star in the title bar. The dialog waits for a person, and the driver
 * serves one request at a time, so every later request for that project queues behind it.
 * `builder:add-task` raises `builder.is_save_scene` (Save / Ignore / Cancel) under the same flag.
 *
 * `save-as-scene` prompts as well and is absent from `EDITOR_METHODS`, so there is nothing to gate.
 */
export const PROMPTING_METHODS: readonly `editor.${EditorMethod}`[] = [
    'editor.scene.openScene',
    'editor.scene.closeScene',
    'editor.builder.addTask'
];

const PROMPTING = new Set<string>(PROMPTING_METHODS);

export function raisesDialog(name: string): boolean {
    return PROMPTING.has(name);
}

/**
 * JSON-RPC reserves -32000..-32099 for implementation-defined server errors. Two codes rather than
 * one because they are two verdicts: the flag was read and is raised, or the flag was not read at
 * all and nothing is proven about what the call would have done.
 */
export const GATE_EDITOR_DIRTY = -32040;
export const GATE_DIRTY_UNKNOWN = -32041;

export interface GateRefusalData {
    method: string;
    /** Why the flag could not be read. Absent when the flag was read and is raised. */
    detail?: string;
}
