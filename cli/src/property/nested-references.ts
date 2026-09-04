import { resolveKind } from './kind.ts';
import type { PropertyDescriptor, PropertyKind } from './kind.ts';
import { isReferenceKind } from './reference-target.ts';

export interface ReferenceSite {
    /** Object members and array indices, from the caller's value down to the target. */
    path: Array<string | number>;
    kind: PropertyKind;
    /** For an array field, its element's class. */
    declaredType: string;
    spelling: unknown;
}

/**
 * Every reference the caller wrote INSIDE a serializable value class. The class goes out as one
 * editor dump, and the editor decodes a reference in it by looking the uuid up rather than by
 * resolving an address, so a node path left in there empties the slot and reports nothing —
 * checked live 2026-09-04 on `CueSpec.sound`.
 *
 * The supplied value decides which members are sites, so a member the caller did not name stays
 * as it is rather than being cleared.
 */
export function nestedReferenceSites(
    descriptor: PropertyDescriptor | null | undefined, value: unknown
): ReferenceSite[] {
    const sites: ReferenceSite[] = [];
    collect(descriptor, value, [], sites);
    return sites;
}

function collect(
    descriptor: PropertyDescriptor | null | undefined,
    value: unknown,
    path: Array<string | number>,
    sites: ReferenceSite[]
): void {
    if (!descriptor) return;
    const kind = resolveKind(descriptor);

    if (isReferenceKind(kind)) {
        sites.push({ path, kind, declaredType: declaredTypeOf(descriptor), spelling: value });
        return;
    }
    if (kind === 'classArray') {
        if (!Array.isArray(value)) return;
        value.forEach((element, index) =>
            collectMembers(descriptor.elementTypeData, element, path.concat(index), sites));
        return;
    }
    if (kind === 'nestedClass' || kind === 'gradient' || kind === 'curve') {
        collectMembers(descriptor, value, path, sites);
    }
}

function collectMembers(
    descriptor: PropertyDescriptor | null | undefined,
    value: unknown,
    path: Array<string | number>,
    sites: ReferenceSite[]
): void {
    if (!descriptor || !value || typeof value !== 'object' || Array.isArray(value)) return;
    const fields = descriptor.value;
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return;
    const members = fields as Record<string, PropertyDescriptor>;
    for (const [name, member] of Object.entries(value as Record<string, unknown>)) {
        collect(members[name], member, path.concat(name), sites);
    }
}

function declaredTypeOf(descriptor: PropertyDescriptor): string {
    const element = descriptor.elementTypeData;
    const named = (element && typeof element.type === 'string' && element.type) || descriptor.type;
    return typeof named === 'string' ? named : '';
}

export interface ResolvedSite {
    path: Array<string | number>;
    uuid: string | string[] | null;
}

export function withReferenceUuids(value: unknown, resolved: ResolvedSite[]): unknown {
    if (!resolved.length) return value;
    let copy = JSON.parse(JSON.stringify(value === undefined ? null : value)) as unknown;
    for (const site of resolved) {
        if (!site.path.length) { copy = site.uuid; continue; }
        assignAt(copy, site.path, site.uuid);
    }
    return copy;
}

function assignAt(root: unknown, path: Array<string | number>, value: unknown): void {
    let holder = root;
    for (const step of path.slice(0, -1)) {
        if (!holder || typeof holder !== 'object') return;
        holder = (holder as Record<string | number, unknown>)[step];
    }
    if (!holder || typeof holder !== 'object') return;
    (holder as Record<string | number, unknown>)[path[path.length - 1]] = value;
}

export function siteLabel(site: ReferenceSite): string {
    return site.path.join('.');
}
