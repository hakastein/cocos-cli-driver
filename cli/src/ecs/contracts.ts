/**
 * Three readings of the census the four per-key counts do not give on their own, each standing for a
 * rule in the playables' `docs/ecs.md`:
 *
 * §6 — a system is a verb phrase and a key is a noun phrase, so the two sets do not meet. Where they
 * do, a bootstrap line, a profiler row and a comment about tick order all read the same word for the
 * rule and for the data.
 *
 * §2 — a capability publishes the keys its contract names. Every read from outside the folder that
 * declares the key is one crossing of that contract, and the count is how far the capability has
 * drifted from it.
 *
 * §4a.2 — one producer feeding one consumer is one system cut in half. Several on either side make
 * them separate.
 */
import type { KeyDeclaration, KeyReport, SystemDeclaration, UsageSite } from './census.ts';

export interface SystemNamedLikeKey {
    name: string;
    system: SystemDeclaration;
    key: KeyDeclaration;
}

export interface OutsideReader {
    key: string;
    capability: string;
    /** Where the outside reads come from, deduped: a capability, or the folder of a file in none. */
    from: string[];
    sites: UsageSite[];
}

export interface WriterReaderPair {
    key: string;
    writer: string;
    reader: string;
    writerSites: UsageSite[];
    readerSites: UsageSite[];
}

function folderOf(file: string): string {
    const cut = file.lastIndexOf('/');
    return cut < 0 ? '' : file.slice(0, cut);
}

function firstDeclarations(declarations: readonly KeyDeclaration[]): Map<string, KeyDeclaration> {
    const first = new Map<string, KeyDeclaration>();
    for (const declaration of declarations) if (!first.has(declaration.key)) first.set(declaration.key, declaration);
    return first;
}

export function systemsNamedLikeKeys(
    systems: readonly SystemDeclaration[],
    declarations: readonly KeyDeclaration[]
): SystemNamedLikeKey[] {
    const keys = firstDeclarations(declarations);
    const collisions: SystemNamedLikeKey[] = [];
    for (const system of systems) {
        const key = keys.get(system.name);
        if (key) collisions.push({ name: system.name, system, key });
    }
    return collisions.sort((a, b) => a.name.localeCompare(b.name) || a.system.file.localeCompare(b.system.file));
}

/**
 * The longest declaring folder the file sits in or under. Nested capabilities declare their own keys,
 * so `framework/death/destructible` wins over `framework/death` for a file inside it.
 */
function capabilityOf(file: string, capabilities: readonly string[]): string | null {
    let found: string | null = null;
    for (const capability of capabilities) {
        const inside = capability === '' || file.startsWith(`${capability}/`);
        if (inside && (found === null || capability.length > found.length)) found = capability;
    }
    return found;
}

export function readsOutsideCapability(
    reports: readonly KeyReport[],
    declarations: readonly KeyDeclaration[]
): OutsideReader[] {
    const keys = firstDeclarations(declarations);
    const capabilities = [...new Set(declarations.map((declaration) => folderOf(declaration.file)))];
    const outside: OutsideReader[] = [];

    for (const report of reports) {
        const declaration = keys.get(report.key);
        if (!declaration) continue;
        const capability = folderOf(declaration.file);
        const sites = report.readers.filter((site) => capabilityOf(site.file, capabilities) !== capability);
        if (!sites.length) continue;
        const from = [...new Set(sites.map((site) => capabilityOf(site.file, capabilities) ?? folderOf(site.file)))];
        outside.push({ key: report.key, capability, from: from.sort(), sites });
    }
    return outside;
}

/** The system whose class body encloses the site, or the file when the site sits outside every one. */
function partyAt(site: UsageSite, systems: readonly SystemDeclaration[]): { name: string; isSystem: boolean } {
    for (const system of systems) {
        if (system.file === site.file && site.line >= system.line && site.line <= system.endLine) {
            return { name: system.name, isSystem: true };
        }
    }
    return { name: site.file, isSystem: false };
}

function soleParty(
    sites: readonly UsageSite[],
    systems: readonly SystemDeclaration[]
): { name: string; isSystem: boolean } | null {
    let sole: { name: string; isSystem: boolean } | null = null;
    for (const site of sites) {
        const party = partyAt(site, systems);
        if (sole === null) sole = party;
        else if (sole.name !== party.name) return null;
    }
    return sole;
}

export function oneWriterOneReader(
    reports: readonly KeyReport[],
    systems: readonly SystemDeclaration[]
): WriterReaderPair[] {
    const pairs: WriterReaderPair[] = [];
    for (const report of reports) {
        const writerSites = [...report.writers, ...report.adders];
        const writer = soleParty(writerSites, systems);
        const reader = soleParty(report.readers, systems);
        if (!writer?.isSystem || !reader?.isSystem || writer.name === reader.name) continue;
        pairs.push({
            key: report.key,
            writer: writer.name,
            reader: reader.name,
            writerSites,
            readerSites: report.readers,
        });
    }
    return pairs;
}
