/**
 * One code per outcome class, so a caller reads what happened without parsing the text. Five of
 * them are the verdicts of `render/verdict.ts` and come from `verdictExit`; the other two are the
 * cases that never reach a report — a shell that mistyped the command, and no editor to talk to.
 */
export const EXIT = {
    OK: 0,
    FAILED: 1,
    USAGE: 2,
    UNVERIFIED: 3,
    UNPERSISTED: 4,
    TIMEOUT: 5,
    NO_EDITOR: 6
} as const;

export type ExitCode = typeof EXIT[keyof typeof EXIT];
