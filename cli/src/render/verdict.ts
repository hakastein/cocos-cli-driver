import { EXIT } from '../exit.ts';

/**
 * How a command ended, from a closed set of five. The set is closed on purpose: a report kind that
 * names no word from here does not compile. `ok` is never printed — success is the exit code — and
 * the other four open their line, because a common log merges the two streams and an unmarked line
 * reads there as data.
 */
export type Verdict = 'ok' | 'UNVERIFIED' | 'UNPERSISTED' | 'FAILED' | 'TIMEOUT';

export function verdictExit(verdict: Verdict): number {
    switch (verdict) {
        case 'ok': return EXIT.OK;
        case 'FAILED': return EXIT.FAILED;
        case 'UNVERIFIED': return EXIT.UNVERIFIED;
        case 'UNPERSISTED': return EXIT.UNPERSISTED;
        case 'TIMEOUT': return EXIT.TIMEOUT;
    }
}

/**
 * Severity, so one bracket that carried several writes ends on the worst of them: the exit code is
 * one number for the whole call, and an `ok` there over an `UNPERSISTED` inside is the defect this
 * ordering exists to stop.
 */
const SEVERITY: Record<Verdict, number> = {
    ok: 0, UNVERIFIED: 1, UNPERSISTED: 2, TIMEOUT: 3, FAILED: 4
};

export function worstVerdict(verdicts: readonly Verdict[]): Verdict {
    return verdicts.reduce<Verdict>(
        (worst, verdict) => SEVERITY[verdict] > SEVERITY[worst] ? verdict : worst, 'ok');
}
