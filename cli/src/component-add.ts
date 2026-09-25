import type { Driver } from '@cocos-cli/shared';
import { settle } from './settle.ts';
import {
    componentClassNames, componentLabels, componentUuid
} from './property/component-dump.ts';
import type { ComponentDump } from './property/component-dump.ts';

const CC_PREFIX = 'cc.';

function bareComponentType(type: string): string {
    return type.indexOf(CC_PREFIX) === 0 ? type.slice(CC_PREFIX.length) : type;
}

/**
 * The editor's `create-component` message silently does nothing for the spelling it does not
 * register under, and the scene-side fallback throws `Component type not found` for the other —
 * so both spellings are tried, caller's own first.
 */
function spellingCandidates(type: string): string[] {
    const bare = bareComponentType(type);
    const prefixed = `${CC_PREFIX}${bare}`;
    return type === bare ? [bare, prefixed] : [prefixed, bare];
}

export async function queryComponents(client: Driver, nodeUuid: string): Promise<ComponentDump[]> {
    const node = await client.editor.scene.queryNode(nodeUuid);
    return ((node && node.__comps__) as ComponentDump[] | undefined) || [];
}

export interface PollOptions {
    timeoutMs?: number;
    intervalMs?: number;
}

interface Appearance {
    /** The node's components after the add. */
    after: ComponentDump[];
    /** Those of them whose uuid the node did not carry before, in component order. */
    appeared: ComponentDump[];
    matched: ComponentDump | null;
}

/**
 * A new component is told from an old one of the same class by its uuid alone, since a node can
 * carry several of one class. A class declaring a requirement makes the editor attach that
 * requirement AHEAD of it, so the first component to appear is not the one that was asked for: the
 * wait runs until a spelling of the asked-for type appears, and what else the node gained comes
 * back with it.
 */
async function pollForNewComponent(
    client: Driver, nodeUuid: string, before: Set<string | null>, spellings: string[],
    pollOptions?: PollOptions
): Promise<Appearance> {
    let seen: Appearance = { after: [], appeared: [], matched: null };
    await settle(async () => {
        const after = await queryComponents(client, nodeUuid);
        const appeared = after.filter(component => !before.has(componentUuid(component)));
        const names = componentClassNames(appeared);
        const at = names.findIndex(name => spellings.includes(name));
        seen = { after, appeared, matched: at >= 0 ? appeared[at] : null };
        return at >= 0;
    }, pollOptions);
    return seen;
}

/** An add whose component was read back. */
export interface ComponentRegistered {
    verified: true;
    /** The name the class registered under. */
    type: string;
    /** The address the new component answers to on its node. */
    label: string;
    uuid: string | null;
}

/**
 * The node gained several components and no spelling of the type asked for names any of them, so
 * every registered name on offer is a guess — which is the choice this outcome refuses to make.
 */
export interface ComponentUnverified {
    verified: false;
    spellings: string[];
    appeared: string[];
}

export type ComponentAddOutcome = ComponentRegistered | ComponentUnverified;

/** What an add with no registered name to report says in place of naming one. */
export function unverifiedAddNote(outcome: ComponentUnverified): string {
    return `the node gained ${outcome.appeared.join(', ')}`
        + `, nothing named ${outcome.spellings.join(' or ')}`;
}

/**
 * A spelling of the type asked for names the component; failing that, a single new component is the
 * one the add produced and there is nothing to choose between.
 */
function outcomeOf(spellings: string[], seen: Appearance): ComponentAddOutcome {
    const named = seen.matched || (seen.appeared.length === 1 ? seen.appeared[0] : null);
    if (!named) {
        return { verified: false, spellings, appeared: componentClassNames(seen.appeared) };
    }
    const at = seen.after.indexOf(named);
    return {
        verified: true,
        type: componentClassNames([named])[0],
        label: componentLabels(seen.after)[at],
        uuid: componentUuid(named)
    };
}

/** Neither add path is trusted on its own word — each spelling is tried, then polled for. Shared by
 * `component add` and `node create --component` so success and failure both take one shape. */
export async function addComponent(
    client: Driver, nodeUuid: string, type: string, pollOptions?: PollOptions
): Promise<ComponentAddOutcome> {
    const components = await queryComponents(client, nodeUuid);
    const before = new Set(components.map(componentUuid));
    const spellings = spellingCandidates(type);

    for (const candidate of spellings) {
        await client.editor.scene.createComponent({ uuid: nodeUuid, component: candidate }).catch(() => undefined);
        let seen = await pollForNewComponent(client, nodeUuid, before, spellings, pollOptions);
        // Anything at all on the node is this add's doing; a further add would only pile up a copy.
        if (seen.appeared.length) return outcomeOf(spellings, seen);

        const fallback = await client.scene.call('addComponentToNode', nodeUuid, candidate);
        if (fallback.success) {
            seen = await pollForNewComponent(client, nodeUuid, before, spellings, pollOptions);
            if (seen.appeared.length) return outcomeOf(spellings, seen);
        }
    }

    const held = componentClassNames(components).some(name => spellings.includes(name));
    const after = componentLabels(await queryComponents(client, nodeUuid));
    throw new Error(
        `component '${type}' did not appear on node ${nodeUuid} after the add${
            held ? ', which already carried one' : ''}; the node carries: ${after.join(', ') || '(none)'}`);
}
