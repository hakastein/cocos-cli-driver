import type {
    ComponentOwnerReport, Hello, MissingScriptDump, NodeInfo, PrefabAssetDump, PrefabOverrideReport,
    SceneDirtyReport, SkeletalSocketList
} from '@cocos-cli/shared';
import { verdictExit } from './verdict.ts';
import {
    assetField, assetListHead, assetVerdict, renderAssetInfo, renderAssetList, renderAssetReport,
    renderAssetUsers
} from './asset.ts';
import { buildRunHead, buildVerdict, buildWarnings, renderBuildRun, renderBuilderStatus } from './build.ts';
import { logSearchHead, logTailHead, renderLogEntries, renderLogMatches } from './log.ts';
import { renderClassList, renderSockets, socketsHead } from './component.ts';
import { nodeHead, renderNodeTransforms } from './node.ts';
import { renderWrites, writesVerdict } from './report.ts';
import { renderTree } from './tree.ts';
import { renderInstances } from './instances.ts';
import { formatReading, renderComponentReading } from './property.ts';
import { prefabOverridesHead, renderPrefabDump, renderPrefabOverrides } from './prefab.ts';
import {
    componentOwnersHead, renderComponentOwners, renderMissingScripts, renderSceneDirty
} from './scene.ts';
import type { Verdict } from './verdict.ts';
import type { AssetReport } from '../asset/settle.ts';
import type { AssetUsers } from './asset.ts';
import type { ClassEntry } from './component.ts';
import type { RenderedWrite } from './report.ts';
import type { DumpNode, TreeOptions } from './tree.ts';
import type { AssetRecord } from '../asset/query.ts';
import type { BuildRunReport, BuilderStatus } from '../build-task.ts';
import type { LogWindow, ProjectLogEntry } from '../log/entries.ts';
import type { LogFileInfo } from '../log/file.ts';
import type { LogSearchResult } from '../log/search.ts';
import type { ComponentChoice, PropertyReading } from '../property/component-dump.ts';
import type { ReferenceLabel } from '../property/reference-index.ts';

export type { RenderedWrite } from './report.ts';
export type { DumpNode } from './tree.ts';

/**
 * A non-empty `stderr` means the call did not succeed, without exception: on the way out a report
 * takes one stream or the other, never both.
 */
export interface CommandOutput {
    stdout?: string;
    stderr?: string;
    /** Carried as a list so a test asks what was warned about rather than grepping the text. */
    warnings: string[];
    exitCode: number;
}

/** The node and component a report is about. */
export interface ComponentAddress {
    nodePath: string;
    nodeUuid: string;
    choice: ComponentChoice;
}

/**
 * A report names what happened; `present` decides what that becomes on the two streams and in the
 * exit code. The union is tagged by `kind`, so a new report kind cannot be added without naming its
 * verdict — which is what the union is for.
 */
export type Report =
    /** An outcome with no structure beyond one line: a verdict and a free-text tail. */
    | {
        kind: 'action'; verdict: Verdict; summary: string; warnings?: string[];
        undoNote?: string | null;
    }
    /** Every write of one undo bracket, each judged on whether a save carries it. */
    | {
        kind: 'write'; target: string; writes: RenderedWrite[]; undoNote: string | null;
        warnings?: string[];
    }
    | { kind: 'asset'; asset: AssetReport; warnings?: string[] }
    | { kind: 'assetInfo'; asset: AssetRecord; field?: string }
    | { kind: 'assetList'; assets: AssetRecord[]; total: number }
    | { kind: 'assetUsers'; users: AssetUsers }
    /** The classes the scene's engine knows: under a base when one was named, the add menu when not. */
    | { kind: 'classList'; classes: ClassEntry[] }
    | { kind: 'node'; info: NodeInfo }
    | { kind: 'nodeSockets'; sockets: SkeletalSocketList }
    | { kind: 'sceneTree'; nodes: DumpNode[]; options: TreeOptions }
    | { kind: 'sceneOwners'; owners: ComponentOwnerReport }
    | { kind: 'sceneDirty'; dirty: SceneDirtyReport }
    | { kind: 'sceneMissing'; missing: MissingScriptDump }
    | {
        kind: 'componentProperty'; address: ComponentAddress; reading: PropertyReading;
        references: Map<string, ReferenceLabel>; unread?: string; warnings?: string[];
    }
    | {
        kind: 'componentProperties'; address: ComponentAddress; readings: PropertyReading[];
        hidden: string[]; references: Map<string, ReferenceLabel>; unread?: string;
        warnings?: string[];
    }
    | { kind: 'prefabDump'; dump: PrefabAssetDump }
    | { kind: 'prefabOverrides'; overrides: PrefabOverrideReport }
    | { kind: 'instances'; instances: Hello[] }
    /** The build worker and the rows of the editor's Build panel. */
    | { kind: 'builderStatus'; status: BuilderStatus }
    /** One build that ran to its end, judged on the builder's exit code and the task's own state. */
    | { kind: 'buildRun'; run: BuildRunReport }
    | {
        kind: 'logTail'; file: LogFileInfo; window: LogWindow; entries: ProjectLogEntry[];
        detail: boolean;
    }
    | { kind: 'logSearch'; file: LogFileInfo; window: LogWindow; result: LogSearchResult };

interface Rendered {
    verdict: Verdict;
    /** The answer's own lines. */
    text: string;
    /** A fact the answer's lines do not carry; the verdict word joins it. */
    head?: string;
    warnings?: string[];
    /**
     * Each line of the answer opens with the verdict of that line, so the report's own word is not
     * printed above them again. A write batch is the only report shaped that way.
     */
    marksItsOwnLines?: boolean;
}

function joined(parts: Array<string | false | undefined>, separator = '  '): string {
    return parts.filter(part => part).join(separator);
}

/** A read that answered part of what was asked is not a success: unread data reads as absent data. */
function readingVerdict(unread: string | undefined): Verdict {
    return unread === undefined ? 'ok' : 'UNVERIFIED';
}

function render(report: Report): Rendered {
    switch (report.kind) {
        case 'action':
            return {
                verdict: report.verdict,
                head: report.summary,
                text: '',
                warnings: withUndo(report.warnings, report.undoNote)
            };

        case 'write':
            return {
                verdict: writesVerdict(report.writes),
                text: renderWrites(report),
                marksItsOwnLines: true,
                warnings: withUndo(report.warnings, report.undoNote)
            };

        case 'asset': {
            const { head, body } = renderAssetReport(report.asset);
            return { verdict: assetVerdict(report.asset), head, text: body, warnings: report.warnings };
        }

        case 'assetInfo':
            return report.field
                ? { verdict: 'ok', text: assetField(report.asset, report.field) }
                : { verdict: 'ok', text: renderAssetInfo(report.asset) };

        case 'assetList':
            return {
                verdict: 'ok',
                head: assetListHead(report.assets.length, report.total),
                text: renderAssetList(report.assets)
            };

        case 'assetUsers':
            return { verdict: 'ok', text: renderAssetUsers(report.users) };

        case 'classList':
            return { verdict: 'ok', text: renderClassList(report.classes) };

        case 'node':
            return { verdict: 'ok', head: nodeHead(report.info), text: renderNodeTransforms(report.info) };

        case 'nodeSockets':
            return {
                verdict: 'ok',
                head: socketsHead(report.sockets),
                text: renderSockets(report.sockets)
            };

        case 'sceneTree':
            return {
                verdict: 'ok',
                text: report.nodes.length
                    ? renderTree(report.nodes, report.options)
                    : 'the scene is empty — no nodes'
            };

        case 'sceneOwners':
            return {
                verdict: 'ok',
                head: componentOwnersHead(report.owners),
                text: renderComponentOwners(report.owners)
            };

        case 'sceneDirty':
            return { verdict: 'ok', text: renderSceneDirty(report.dirty) };

        case 'sceneMissing':
            return {
                verdict: report.missing.entries.length ? 'FAILED' : 'ok',
                text: renderMissingScripts(report.missing)
            };

        case 'componentProperty': {
            const { address, reading, references } = report;
            return {
                verdict: readingVerdict(report.unread),
                head: joined([
                    `${address.choice.className}.${reading.name}  ${reading.type || 'type not declared'}`,
                    reading.differsFromDefault === true && 'differs from the default',
                    reading.hiddenInInspector && 'hidden in the inspector'
                ]),
                text: joined([
                    formatReading(reading, uuid => references.get(uuid)),
                    report.unread
                ], '\n'),
                warnings: report.warnings
            };
        }

        case 'componentProperties': {
            const { address, readings, hidden, references } = report;
            return {
                verdict: readingVerdict(report.unread),
                head: joined([
                    `${address.choice.className} on ${address.nodePath}  enabled=${
                        address.choice.enabled === null ? 'unknown' : address.choice.enabled}`,
                    hidden.length > 0 && `hidden: ${hidden.length}`,
                    readings.some(reading => reading.differsFromDefault === true)
                        && '* — differs from the default'
                ]),
                text: joined([
                    renderComponentReading(readings, uuid => references.get(uuid)),
                    report.unread
                ], '\n'),
                warnings: report.warnings
            };
        }

        case 'prefabDump':
            return { verdict: 'ok', text: renderPrefabDump(report.dump) };

        case 'prefabOverrides':
            return {
                verdict: 'ok',
                head: prefabOverridesHead(report.overrides),
                text: renderPrefabOverrides(report.overrides)
            };

        case 'instances':
            return { verdict: 'ok', text: renderInstances(report.instances) };

        case 'builderStatus':
            return { verdict: 'ok', text: renderBuilderStatus(report.status) };

        case 'buildRun':
            return {
                verdict: buildVerdict(report.run),
                head: buildRunHead(report.run),
                text: renderBuildRun(report.run),
                warnings: buildWarnings(report.run)
            };

        case 'logTail':
            return {
                verdict: 'ok',
                head: logTailHead(report.file, report.window, report.entries.length),
                text: renderLogEntries(report.entries, report.detail)
            };

        case 'logSearch':
            return {
                verdict: 'ok',
                head: logSearchHead(report.file, report.window, report.result),
                text: renderLogMatches(report.result)
            };
    }
}

function withUndo(warnings: string[] | undefined, undoNote: string | null | undefined): string[] {
    const listed = warnings ? [...warnings] : [];
    if (undoNote) listed.push(undoNote);
    return listed;
}

export function present(report: Report): CommandOutput {
    const rendered = render(report);
    const warnings = rendered.warnings || [];
    const opener = rendered.marksItsOwnLines || rendered.verdict === 'ok'
        ? rendered.head
        : joined([rendered.verdict, rendered.head]);
    const body = joined(
        [opener, rendered.text, ...warnings.map(warning => `warning: ${warning}`)], '\n');

    return {
        stdout: rendered.verdict === 'ok' ? body || undefined : undefined,
        stderr: rendered.verdict === 'ok' ? undefined : body || undefined,
        warnings,
        exitCode: verdictExit(rendered.verdict)
    };
}
