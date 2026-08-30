import type { WriteReport } from '@cocos-cli/shared';
import { worstVerdict } from './verdict.ts';
import type { Verdict } from './verdict.ts';

export interface RenderedWrite {
    /** What the property sits on: a component's registered class name, or a node's path. */
    target: string;
    property: string;
    value?: unknown;
    report: WriteReport;
}

/** Every write of one undo bracket, which is what a command performs at most one of. */
export interface WriteBatch {
    target: string;
    writes: RenderedWrite[];
}

/**
 * `persisted: false` means something only on the editor channel: there a save really does drop the
 * value, while live serializes nothing by construction. `persisted: null` is nobody having looked,
 * which is a gap in the answer rather than a value proven to survive.
 */
export function writeVerdict(report: WriteReport): Verdict {
    if (!report.written) return 'FAILED';
    if (report.channel === 'live') return report.verified ? 'ok' : 'UNVERIFIED';
    if (report.persisted === false) return 'UNPERSISTED';
    return report.verified && report.persisted === true ? 'ok' : 'UNVERIFIED';
}

export function writesVerdict(writes: readonly RenderedWrite[]): Verdict {
    return worstVerdict(writes.map(write => writeVerdict(write.report)));
}

/** One self-contained line per write, naming its own target and property whether it is alone or
 * one of five: a line read out of a merged log has no line above it. */
export function renderWrites(batch: WriteBatch): string {
    if (!batch.writes.length) return `${batch.target}  nothing to write`;
    return batch.writes.map(write => renderWriteReport(write)).join('\n');
}

export function renderWriteReport(write: RenderedWrite): string {
    const { report } = write;
    const verdict = writeVerdict(report);
    const persisted = report.persisted === null ? 'unknown' : String(report.persisted);
    const value = write.value === undefined ? '' : ` = ${JSON.stringify(write.value)}`;

    const parts = [
        `${verdict === 'ok' ? '' : `${verdict}  `}${write.target}.${write.property}${value}`,
        report.verified ? 'verified' : 'unverified',
        `persisted=${persisted}`,
        `channel=${report.channel || 'unknown'}`
    ];

    if (report.prefabOverride) parts.push(`override on ${report.prefabOverride.targetPath}`);
    if (report.detail) parts.push(report.detail);

    return parts.join('  ');
}
