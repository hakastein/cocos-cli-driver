import { table } from './columns.ts';
import type { Verdict } from './verdict.ts';
import type { CensusResult, KeyReport, UnresolvedSite, UsageSite } from '../ecs/census.ts';
import type { UnreadableFile } from '../ecs/kit.ts';
import type { OutsideReader, SystemNamedLikeKey, WriterReaderPair } from '../ecs/contracts.ts';

interface Finding {
    word: string;
    /** The half of the key that is not empty — who is left reading it, or left writing it. */
    sites: UsageSite[];
}

/**
 * The three findings, in the words the listing is grepped by. They are read off the lists the
 * census already drew rather than re-derived from the counts, so the listing and the summary cannot
 * disagree about which keys are flagged.
 */
function findings(result: CensusResult): Map<string, Finding> {
    const found = new Map<string, Finding>();
    for (const report of result.readWithoutWriter) {
        found.set(report.key, { word: 'read without a writer', sites: report.readers });
    }
    for (const report of result.writtenNeverRead) {
        found.set(report.key, { word: 'written never read', sites: [...report.writers, ...report.adders] });
    }
    for (const declaration of result.declaredNeverUsed) {
        found.set(declaration.key, { word: 'never used', sites: [] });
    }
    return found;
}

function countsOf(report: KeyReport): string {
    return `readers ${report.counts.readers}  writers ${report.counts.writers}`
        + `  adders ${report.counts.adders}  removers ${report.counts.removers}`;
}

function indented(rows: ReadonlyArray<readonly string[]>): string[] {
    return table(rows).map(line => `  ${line}`);
}

function blindSection(title: string, sites: readonly UnresolvedSite[]): string[] {
    if (!sites.length) return [];
    return [title, ...indented(sites.map(site => [
        `${site.file}:${site.line}`, site.fn, site.text, site.reason,
        site.keys?.length ? `keys: ${site.keys.join(' ')}` : ''
    ]))];
}

function section(title: string, rows: ReadonlyArray<readonly string[]>): string[] {
    return rows.length ? [title, ...indented(rows)] : [];
}

function collisionRows(collisions: readonly SystemNamedLikeKey[]): string[][] {
    return collisions.map(collision => [
        collision.name, `${collision.system.file}:${collision.system.line}`, collision.system.className,
        `${collision.key.file}:${collision.key.line}`
    ]);
}

const FROM_WIDTH = 100;

function fromList(from: readonly string[]): string {
    const shown: string[] = [];
    let width = 0;
    for (const capability of from) {
        if (shown.length && width + capability.length + 1 > FROM_WIDTH) break;
        shown.push(capability);
        width += capability.length + 1;
    }
    const hidden = from.length - shown.length;
    return hidden ? `${shown.join(' ')} +${hidden} more` : shown.join(' ');
}

/**
 * The counts are exact and the names are the ones that fit: `node` is read from 26 capabilities and
 * spelling them all out puts a 600-character line in a listing that is read with grep. `--json`
 * carries every reader and every site.
 */
function outsideRows(outside: readonly OutsideReader[]): string[][] {
    return outside.map(reader => [
        reader.key, reader.capability, `read ${reader.sites.length} from ${reader.from.length}`,
        fromList(reader.from)
    ]);
}

function pairRows(pairs: readonly WriterReaderPair[]): string[][] {
    return pairs.map(pair => [
        pair.key, `${pair.writer} writes`, `${pair.reader} reads`,
        `${pair.writerSites[0].file}:${pair.writerSites[0].line}`
    ]);
}

export function renderCensus(result: CensusResult, unreadable: readonly UnreadableFile[]): string {
    if (!result.keysDeclared) return 'no interface Entity is declared under this kit';

    const found = findings(result);
    const lines: string[] = [];
    table(result.keys.map(report => [
        report.key, report.declaredType, countsOf(report), report.declaredIn,
        found.get(report.key)?.word ?? ''
    ])).forEach((line, index) => {
        lines.push(line);
        const sites = found.get(result.keys[index].key)?.sites ?? [];
        if (sites.length) {
            lines.push(...indented(
                sites.map(site => [site.kind, `${site.file}:${site.line}`, site.fn, site.text])));
        }
    });

    lines.push(...section('system named like a key', collisionRows(result.systemsNamedLikeKeys)));
    lines.push(...section('read outside its capability', outsideRows(result.readOutsideCapability)));
    lines.push(...section('one writer, one reader', pairRows(result.oneWriterOneReader)));
    lines.push(...blindSection('unresolved', result.unresolved));
    lines.push(...blindSection('not a declared key', result.suspectEntityLiteralProperties));
    if (result.parseErrors.length) {
        lines.push('unparsed', ...indented(result.parseErrors.map(entry => [entry.file, entry.message])));
    }
    if (unreadable.length) {
        lines.push('unread', ...indented(unreadable.map(entry => [entry.file, entry.message])));
    }
    return lines.join('\n');
}

/**
 * A sweep that did not read the whole kit answers about the part it read, and a key can look
 * unwritten because its writer sat in the file that went unread. A `--kit` narrower than the asset
 * tree is that same situation chosen deliberately, and it gets the same word: the caller asking for
 * the narrowing does not make the finding any more confirmed.
 */
export function censusVerdict(result: CensusResult, narrowed: boolean): Verdict {
    return narrowed || result.filesSkipped > 0 || result.parseErrors.length > 0
        ? 'UNVERIFIED'
        : 'ok';
}

export function censusSummary(result: CensusResult, root: string, narrowed: boolean): string {
    return [
        [
            `${censusVerdict(result, narrowed)}  ${root}`,
            `keys ${result.keysDeclared} in ${result.filesAnalysed} files`,
            `read without a writer: ${result.readWithoutWriter.length}`,
            `written never read: ${result.writtenNeverRead.length}`,
            `never used: ${result.declaredNeverUsed.length}`,
            result.filesSkipped ? `files skipped: ${result.filesSkipped}` : '',
            result.parseErrors.length ? `parse errors: ${result.parseErrors.length}` : ''
        ].filter(Boolean).join('  '),
        [
            `systems ${result.systems.length}`,
            `named like a key: ${result.systemsNamedLikeKeys.length}`,
            `read outside their capability: ${result.readOutsideCapability.length}`,
            `one writer one reader: ${result.oneWriterOneReader.length}`
        ].join('  '),
        'structural analysis, no type checker — --json carries the limits and every site',
        narrowed ? 'the sweep was narrowed to --kit: a writer outside it is not counted' : ''
    ].filter(Boolean).join('\n');
}
