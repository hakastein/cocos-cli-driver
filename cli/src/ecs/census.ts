/**
 * Per-component-key census of an ECS kit: who reads a key, who writes its fields, who adds it and
 * who removes it — and which keys have readers and no writer at all.
 *
 * A component nothing writes is a feature that silently never runs. Unit tests over systems do not
 * see it (the system runs, the query is simply empty forever), and neither does the type checker
 * (the key is declared, so every read compiles). The only thing that finds it is a whole-kit sweep.
 *
 * Parsing is the TypeScript compiler's own parser over real syntax trees — never a text match. What
 * it does NOT do is bind or type-check: there is no checker, so classification is structural. Every
 * place that costs the census precision is reported in `limits` and in the `unresolved` list rather
 * than being silently dropped.
 */

import * as ts from 'typescript';
import { oneWriterOneReader, readsOutsideCapability, systemsNamedLikeKeys } from './contracts.ts';
import type { OutsideReader, SystemNamedLikeKey, WriterReaderPair } from './contracts.ts';
import { collectBindings, collectClassNames, receiverShape, scopeRange } from './receivers.ts';
import type { BindingTable, ParsedSource } from './receivers.ts';
import { collectContributors, resolveContribution } from './contributions.ts';
import type { ContributionScope } from './contributions.ts';

export interface CensusSource {
    /** Path as it should appear in the report — the caller decides whether it is absolute or relative. */
    path: string;
    text: string;
}

export type UsageKind =
    /** `entity.key`, `entity.key !== undefined` — the value is consumed. */
    | 'read'
    /** `world.with('key')`, `.without('key')`, `singletonOf(world, 'key')`. */
    | 'query'
    /** `entity.key.field = …` — the component object is mutated in place. */
    | 'fieldWrite'
    /** `entity.key = …` — the slot itself is assigned. */
    | 'set'
    /** `commands.add(e, 'key', …)`, `world.addComponent`, a key in an entity object literal. */
    | 'add'
    /** `commands.remove(e, 'key')`, `world.removeComponent`, `delete entity.key`. */
    | 'remove';

export interface UsageSite {
    file: string;
    line: number;
    kind: UsageKind;
    /** Nearest enclosing named function, method or class — "which system does this". */
    fn: string;
    /** The expression as written, truncated. */
    text: string;
    /** Set when the site was reached through a local wrapper rather than a direct world/command call. */
    viaWrapper?: string;
}

export interface KeyDeclaration {
    key: string;
    file: string;
    line: number;
    /** Text of the declared type, e.g. `FireTimer` or `true`. */
    type: string;
}

export interface SystemDeclaration {
    /** The label handed to `system('…')` — what a bootstrap, a tick order and a profiler row call it. */
    name: string;
    className: string;
    file: string;
    line: number;
    /** Last line of the class body, so a usage site can be attributed to the system it sits in. */
    endLine: number;
}

export interface KeyReport {
    key: string;
    declaredIn: string;
    declaredType: string;
    counts: { readers: number; writers: number; adders: number; removers: number };
    readers: UsageSite[];
    writers: UsageSite[];
    adders: UsageSite[];
    removers: UsageSite[];
}

export interface UnresolvedSite {
    file: string;
    line: number;
    fn: string;
    text: string;
    reason: string;
    /** The union of what every kit method of that name returns; the site lays some subset of it. */
    keys?: string[];
}

export interface CensusResult {
    filesAnalysed: number;
    filesSkipped: number;
    truncated: boolean;
    keysDeclared: number;
    /** Declared, and something reads it, but nothing writes, adds or assigns it. */
    readWithoutWriter: KeyReport[];
    /** Declared and not referenced anywhere at all. */
    declaredNeverUsed: KeyDeclaration[];
    /** Declared, written or added, but nothing ever reads it. */
    writtenNeverRead: KeyReport[];
    keys: KeyReport[];
    /** Every `class X extends system('name', …)` the sweep found. */
    systems: SystemDeclaration[];
    /** A system whose name is also a declared key: `ecs.md` §6 says the two sets do not meet. */
    systemsNamedLikeKeys: SystemNamedLikeKey[];
    /** Keys read from outside the folder that declares them — the divergence from `ecs.md` §2. */
    readOutsideCapability: OutsideReader[];
    /** One system fills the key, one system reads it: merge candidates under `ecs.md` §4a.2. */
    oneWriterOneReader: WriterReaderPair[];
    /** Key arguments the parser could see but not resolve to a name — the census is blind to these. */
    unresolved: UnresolvedSite[];
    /** Object literals in an entity position carrying a property that is not a declared key. */
    suspectEntityLiteralProperties: UnresolvedSite[];
    /** Local functions that forward a `keyof Entity` parameter, and the effect inferred for each. */
    wrappers: { name: string; file: string; parameter: string; effects: UsageKind[] }[];
    parseErrors: { file: string; message: string }[];
    limits: string[];
}

const MAX_TEXT = 120;

/**
 * Method/function names whose string arguments name a component key, and what calling them means.
 * A Map, not an object: a callee named `toString` or `constructor` would otherwise hit
 * Object.prototype and come back as a match.
 */
const CALL_EFFECTS = new Map<string, { keyArgs: number[] | 'all'; kind: UsageKind }>([
    ['add', { keyArgs: [1], kind: 'add' }],
    ['addComponent', { keyArgs: [1], kind: 'add' }],
    ['remove', { keyArgs: [1], kind: 'remove' }],
    ['removeComponent', { keyArgs: [1], kind: 'remove' }],
    ['with', { keyArgs: 'all', kind: 'query' }],
    ['without', { keyArgs: 'all', kind: 'query' }],
    ['singletonOf', { keyArgs: [1], kind: 'query' }],
]);

/** Names whose single object-literal argument is an entity being assembled. */
const ENTITY_LITERAL_CALLS = new Set(['add', 'spawn']);

const LIMITS: string[] = [
    'Structural analysis only: no type checker runs, so a key is recognised by its name, and a receiver is placed by its own declaration rather than by its type.',
    'Accesses on `this` are skipped — `this.node` in a cc.Component is the engine node, not the `node` component. An EC class that stored a component on itself is therefore invisible.',
    'A receiver is not an entity when it was bound from `getComponent…()`, from a container `get(Class)`, or annotated with a class name. A local whose declaration says none of those reads as an entity, so `bullet.damage` on an untyped Projectile still counts as a read of `damage`.',
    'A `const` bound to a component or to one of its fields carries writes through: `const v = body.velocity; v.x = 1` writes `velocity`. Reads are not carried, the binding itself having counted as one. A `let`, a destructuring, or a binding handed to another function carries nothing.',
    'A spread and an entity-typed argument are expanded from the object literal the named method returns. A dispatch over a class the sweep cannot name goes to `unresolved` carrying the keys any method of that name returns, and a computed key goes there too, rather than being guessed.',
    'A wrapper, a contributor and an entity-typed parameter are matched by function name across the whole scanned set; two same-named local functions are treated as one.',
    'Despawn removes every component at once and is not counted as a per-key remover.',
    'A method call that mutates a component in place (`entity.key.list.push(x)`) reads as a read, not a write.',
    'A system is recognised by `class X extends system(\'name\', …)`; one declared any other way is absent from the systems list and its name is never checked against the keys.',
    'A capability is the folder that declares the key. A file under no declaring folder — an assembly, a playable\'s script group — is in no capability, so every read from it counts as outside one.',
    'A site belongs to the system whose class body encloses it; a site outside every system is attributed to its file, and a file is never a merge candidate.',
];

function truncate(text: string): string {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > MAX_TEXT ? `${flat.slice(0, MAX_TEXT)}…` : flat;
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

/** Nearest enclosing named function, method or class — what a reader wants to see next to a site. */
function enclosingName(node: ts.Node): string {
    let current: ts.Node | undefined = node;
    while (current) {
        if (ts.isFunctionDeclaration(current) && current.name) return current.name.text;
        if (ts.isMethodDeclaration(current) && ts.isIdentifier(current.name)) return current.name.text;
        if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current)) && current.parent) {
            const owner = current.parent;
            if (ts.isVariableDeclaration(owner) && ts.isIdentifier(owner.name)) return owner.name.text;
            if (ts.isPropertyAssignment(owner) && ts.isIdentifier(owner.name)) return owner.name.text;
        }
        if (ts.isClassDeclaration(current) && current.name) return current.name.text;
        current = current.parent;
    }
    return '<module>';
}

function stripWrappers(node: ts.Expression): ts.Expression {
    let current = node;
    while (ts.isParenthesizedExpression(current) || ts.isNonNullExpression(current) || ts.isAsExpression(current)) {
        current = current.expression;
    }
    return current;
}

/** The property name a receiver expression ends in, so `entity.cameraRig.node` can tell that `node` is a field. */
function receiverTailName(expression: ts.Expression): string | null {
    const target = stripWrappers(expression);
    if (ts.isPropertyAccessExpression(target)) return target.name.text;
    if (ts.isElementAccessExpression(target) && target.argumentExpression && ts.isStringLiteralLike(target.argumentExpression)) {
        return target.argumentExpression.text;
    }
    return null;
}

/** The name a call targets: `commands.add` -> `add`, `singletonOf(...)` -> `singletonOf`. */
function calleeName(call: ts.CallExpression): string | null {
    const callee = stripWrappers(call.expression);
    if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
    if (ts.isIdentifier(callee)) return callee.text;
    return null;
}

type ChainOutcome = { assigned: boolean; deleted: boolean; depth: number };

/**
 * Walk up from an access to find out what is ultimately done to it. `depth` counts the member
 * hops taken on the way, which is what separates `entity.key = v` (depth 0) from
 * `entity.key.field = v` (depth 1).
 */
function chainOutcome(access: ts.Node): ChainOutcome {
    let current: ts.Node = access;
    let depth = 0;
    for (;;) {
        const parent: ts.Node | undefined = current.parent;
        if (!parent) return { assigned: false, deleted: false, depth };
        if (ts.isParenthesizedExpression(parent) || ts.isNonNullExpression(parent) || ts.isAsExpression(parent)) {
            current = parent;
            continue;
        }
        if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === current) {
            current = parent;
            depth += 1;
            continue;
        }
        if (ts.isDeleteExpression(parent)) return { assigned: false, deleted: true, depth };
        if (ts.isBinaryExpression(parent) && parent.left === current && isAssignmentOperator(parent.operatorToken.kind)) {
            return { assigned: true, deleted: false, depth };
        }
        if ((ts.isPostfixUnaryExpression(parent) || ts.isPrefixUnaryExpression(parent)) &&
            (parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken)) {
            return { assigned: true, deleted: false, depth };
        }
        return { assigned: false, deleted: false, depth };
    }
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
    return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

interface WrapperInfo {
    name: string;
    file: string;
    parameter: string;
    parameterIndex: number;
    effects: Set<UsageKind>;
}

interface ScopedName<T> {
    name: string;
    start: number;
    end: number;
    value: T;
}

function innermost<T>(scoped: readonly ScopedName<T>[], name: string, position: number): T | undefined {
    let best: ScopedName<T> | undefined;
    for (const entry of scoped) {
        if (entry.name !== name || position < entry.start || position > entry.end) continue;
        if (!best || entry.end - entry.start < best.end - best.start) best = entry;
    }
    return best?.value;
}

/** `const measured = body.velocity` — the component the local stands for, and how deep inside it. */
function keyAccessIn(
    expression: ts.Expression,
    universe: ReadonlySet<string>,
    onAnEntity: (access: ts.PropertyAccessExpression) => boolean
): { key: string; depth: number } | null {
    let current = stripWrappers(expression);
    let depth = 0;
    while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
        if (ts.isPropertyAccessExpression(current) && universe.has(current.name.text) && onAnEntity(current)) {
            return { key: current.name.text, depth };
        }
        current = stripWrappers(current.expression);
        depth += 1;
    }
    return null;
}

function collectAliases(
    sourceFile: ts.SourceFile,
    universe: ReadonlySet<string>,
    onAnEntity: (access: ts.PropertyAccessExpression) => boolean
): ScopedName<{ key: string; depth: number }>[] {
    const aliases: ScopedName<{ key: string; depth: number }>[] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
            && node.parent && ts.isVariableDeclarationList(node.parent)
            && (node.parent.flags & ts.NodeFlags.Const) !== 0) {
            const held = keyAccessIn(node.initializer, universe, onAnEntity);
            if (held) aliases.push({ name: node.name.text, value: held, ...scopeRange(node) });
        }
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);
    return aliases;
}

const KEYOF_ENTITY = /keyof\s+Entity/;

/**
 * A local standing for a key the caller chose: `claim`'s `key: K`, `lay`'s `Object.keys(parts) as
 * (keyof Entity)[]`. Which keys it ranges over is decided at the call site and counted there.
 */
function collectKeyLocals(sourceFile: ts.SourceFile): ScopedName<true>[] {
    const locals: ScopedName<true>[] = [];
    const constrained = (declaration: ts.SignatureDeclaration): Set<string> => {
        const names = new Set<string>();
        for (const parameter of declaration.typeParameters ?? []) {
            if (parameter.constraint && KEYOF_ENTITY.test(parameter.constraint.getText(sourceFile))) {
                names.add(parameter.name.text);
            }
        }
        return names;
    };
    const visit = (node: ts.Node): void => {
        if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)
            || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
            const generics = constrained(node);
            for (const parameter of node.parameters) {
                if (!parameter.type || !ts.isIdentifier(parameter.name)) continue;
                const text = parameter.type.getText(sourceFile);
                if (!KEYOF_ENTITY.test(text) && !generics.has(text)) continue;
                locals.push({ name: parameter.name.text, value: true, ...scopeRange(parameter) });
            }
        }
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
            const source = node.type ?? (node.parent && ts.isVariableDeclarationList(node.parent)
                && node.parent.parent && ts.isForOfStatement(node.parent.parent)
                ? node.parent.parent.expression : undefined);
            const text = source === undefined ? '' : source.getText(sourceFile);
            if (KEYOF_ENTITY.test(text)) locals.push({ name: node.name.text, value: true, ...scopeRange(node) });
        }
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);
    return locals;
}

/** `const STRIPPED_ON_DEATH = ['seeking', 'attacking'] as const` — module-level key lists, by name. */
function collectKeyArrays(sourceFile: ts.SourceFile): Map<string, string[]> {
    const arrays = new Map<string, string[]>();
    for (const statement of sourceFile.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
            const initializer = stripWrappers(declaration.initializer);
            if (!ts.isArrayLiteralExpression(initializer)) continue;
            const literals = initializer.elements.filter(ts.isStringLiteralLike).map((element) => element.text);
            if (literals.length === initializer.elements.length && literals.length > 0) {
                arrays.set(declaration.name.text, literals);
            }
        }
    }
    return arrays;
}

/** The declared keys of `interface Entity`, wherever it is declared or augmented. */
export function collectKeys(sources: CensusSource[]): KeyDeclaration[] {
    const declarations: KeyDeclaration[] = [];
    for (const source of sources) {
        const sourceFile = ts.createSourceFile(source.path, source.text, ts.ScriptTarget.ES2017, true, ts.ScriptKind.TS);
        const visit = (node: ts.Node): void => {
            if (ts.isInterfaceDeclaration(node) && node.name.text === 'Entity') {
                for (const member of node.members) {
                    if (!ts.isPropertySignature(member)) continue;
                    const name = ts.isIdentifier(member.name) || ts.isStringLiteralLike(member.name) ? member.name.text : null;
                    if (!name) continue;
                    declarations.push({
                        key: name,
                        file: source.path,
                        line: lineOf(sourceFile, member),
                        type: member.type ? truncate(member.type.getText(sourceFile)) : 'unknown',
                    });
                }
            }
            ts.forEachChild(node, visit);
        };
        ts.forEachChild(sourceFile, visit);
    }
    return declarations;
}

function systemLabel(declaration: ts.ClassDeclaration): string | null {
    for (const clause of declaration.heritageClauses ?? []) {
        if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
        for (const type of clause.types) {
            const base = stripWrappers(type.expression);
            if (!ts.isCallExpression(base) || calleeName(base) !== 'system') continue;
            const label = base.arguments[0] === undefined ? null : stripWrappers(base.arguments[0]);
            if (label && ts.isStringLiteralLike(label)) return label.text;
        }
    }
    return null;
}

function collectSystems(parsed: { source: CensusSource; sourceFile: ts.SourceFile }[]): SystemDeclaration[] {
    const systems: SystemDeclaration[] = [];
    for (const { source, sourceFile } of parsed) {
        const visit = (node: ts.Node): void => {
            if (ts.isClassDeclaration(node) && node.name) {
                const name = systemLabel(node);
                if (name !== null) {
                    systems.push({
                        name,
                        className: node.name.text,
                        file: source.path,
                        line: lineOf(sourceFile, node),
                        endLine: sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
                    });
                }
            }
            ts.forEachChild(node, visit);
        };
        ts.forEachChild(sourceFile, visit);
    }
    return systems;
}

/**
 * Functions that take a component key as a parameter and forward it — `claim(world, entity, key, …)`
 * in the kit's assembly. Without these, the only adder of a key can be a call the census does not
 * recognise, and the key looks read-without-writer when it is not.
 */
function collectWrappers(parsed: { source: CensusSource; sourceFile: ts.SourceFile }[]): Map<string, WrapperInfo> {
    const wrappers = new Map<string, WrapperInfo>();
    const candidates: { info: WrapperInfo; body: ts.Node; sourceFile: ts.SourceFile }[] = [];

    for (const { source, sourceFile } of parsed) {
        const visit = (node: ts.Node): void => {
            if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
                const name = functionNameOf(node);
                if (name && node.body) {
                    const keyTypeNames = new Set<string>();
                    for (const typeParameter of node.typeParameters ?? []) {
                        if (typeParameter.constraint && /keyof\s+Entity/.test(typeParameter.constraint.getText(sourceFile))) {
                            keyTypeNames.add(typeParameter.name.text);
                        }
                    }
                    node.parameters.forEach((parameter, index) => {
                        if (!parameter.type || !ts.isIdentifier(parameter.name)) return;
                        const typeText = parameter.type.getText(sourceFile);
                        const isKeyParameter = /keyof\s+Entity/.test(typeText) || keyTypeNames.has(typeText);
                        if (!isKeyParameter) return;
                        const info: WrapperInfo = {
                            name,
                            file: source.path,
                            parameter: parameter.name.text,
                            parameterIndex: index,
                            effects: new Set<UsageKind>(),
                        };
                        wrappers.set(name, info);
                        candidates.push({ info, body: node.body!, sourceFile });
                    });
                }
            }
            ts.forEachChild(node, visit);
        };
        ts.forEachChild(sourceFile, visit);
    }

    // A wrapper may forward into another wrapper, so effects settle by iteration rather than one pass.
    for (let round = 0; round < 4; round += 1) {
        let changed = false;
        for (const candidate of candidates) {
            const before = candidate.info.effects.size;
            collectParameterEffects(candidate.body, candidate.sourceFile, candidate.info, wrappers);
            if (candidate.info.effects.size !== before) changed = true;
        }
        if (!changed) break;
    }
    return wrappers;
}

function functionNameOf(node: ts.FunctionLikeDeclaration): string | null {
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name && ts.isIdentifier(node.name)) return node.name.text;
    const owner = node.parent;
    if (owner && ts.isVariableDeclaration(owner) && ts.isIdentifier(owner.name)) return owner.name.text;
    return null;
}

function collectParameterEffects(body: ts.Node, sourceFile: ts.SourceFile, info: WrapperInfo, wrappers: Map<string, WrapperInfo>): void {
    const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && node.text === info.parameter) {
            const parent = node.parent;
            if (parent && ts.isCallExpression(parent)) {
                const index = parent.arguments.indexOf(node as ts.Expression);
                if (index >= 0) {
                    const name = calleeName(parent);
                    const builtin = name ? CALL_EFFECTS.get(name) : undefined;
                    if (builtin && (builtin.keyArgs === 'all' || builtin.keyArgs.includes(index))) info.effects.add(builtin.kind);
                    const nested = name ? wrappers.get(name) : undefined;
                    if (nested && nested !== info && nested.parameterIndex === index) {
                        for (const effect of nested.effects) info.effects.add(effect);
                    }
                }
            }
            if (parent && ts.isElementAccessExpression(parent) && parent.argumentExpression === node) {
                const outcome = chainOutcome(parent);
                if (outcome.deleted) info.effects.add('remove');
                else if (outcome.assigned) info.effects.add(outcome.depth === 0 ? 'set' : 'fieldWrite');
                else info.effects.add('read');
            }
        }
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(body, visit);
}

export interface CensusOptions {
    /** Report one key only; the flag lists still consider it alone. */
    keyFilter?: string;
    /** Files the caller refused to read, so the payload can say the census is partial. */
    filesSkipped?: number;
    truncated?: boolean;
}

export function runCensus(sources: CensusSource[], options: CensusOptions = {}): CensusResult {
    const parsed: { source: CensusSource; sourceFile: ts.SourceFile }[] = [];
    const parseErrors: { file: string; message: string }[] = [];

    for (const source of sources) {
        try {
            parsed.push({
                source,
                sourceFile: ts.createSourceFile(source.path, source.text, ts.ScriptTarget.ES2017, true, ts.ScriptKind.TS),
            });
        } catch (err: any) {
            parseErrors.push({ file: source.path, message: err?.message || String(err) });
        }
    }

    const declarations = collectKeys(sources);
    const universe = new Set(declarations.map((declaration) => declaration.key));
    const systems = collectSystems(parsed);
    const wrappers = collectWrappers(parsed);

    const parsedSources: ParsedSource[] = parsed.map(({ source, sourceFile }) => ({ path: source.path, sourceFile }));
    const componentClasses = collectClassNames(parsedSources);
    const tables = new Map<string, BindingTable>();
    for (const entry of parsedSources) tables.set(entry.path, collectBindings(entry.sourceFile, componentClasses));
    const contributors = collectContributors(parsedSources, universe, componentClasses, tables);

    const sites = new Map<string, UsageSite[]>();
    for (const key of universe) sites.set(key, []);
    const unresolved: UnresolvedSite[] = [];
    const suspect: UnresolvedSite[] = [];

    // One source position is one site: `singletonOf` is both a known call and a local wrapper, and
    // without this it would report the same line twice.
    const seen = new Set<string>();
    const record = (key: string, site: UsageSite): void => {
        const list = sites.get(key);
        if (!list) return;
        const identity = `${key}|${site.file}|${site.line}|${site.kind}`;
        if (seen.has(identity)) return;
        seen.add(identity);
        list.push(site);
    };

    for (const { source, sourceFile } of parsed) {
        const keyArrays = collectKeyArrays(sourceFile);
        const table = tables.get(source.path)!;
        const scope: ContributionScope = { index: contributors, table, classes: componentClasses };

        const onAnEntity = (access: ts.PropertyAccessExpression): boolean => {
            const receiver = stripWrappers(access.expression);
            if (receiver.kind === ts.SyntaxKind.ThisKeyword || receiver.kind === ts.SyntaxKind.SuperKeyword) return false;
            const tail = receiverTailName(access.expression);
            if (tail !== null && universe.has(tail)) return false;
            return receiverShape(access.expression, table, componentClasses) === undefined;
        };

        const aliases = collectAliases(sourceFile, universe, onAnEntity);
        const keyLocals = collectKeyLocals(sourceFile);

        /** A key argument as written: a literal, or a named list of literals, or nothing we can name. */
        const resolveKeyArgument = (argument: ts.Expression): { keys: string[]; unresolvedReason: string | null } => {
            const target = stripWrappers(argument);
            if (ts.isStringLiteralLike(target)) return { keys: [target.text], unresolvedReason: null };
            if (ts.isIdentifier(target) && keyArrays.has(target.text)) {
                return { keys: keyArrays.get(target.text)!, unresolvedReason: null };
            }
            if (ts.isElementAccessExpression(target)) {
                const base = stripWrappers(target.expression);
                if (ts.isIdentifier(base) && keyArrays.has(base.text)) {
                    return { keys: keyArrays.get(base.text)!, unresolvedReason: null };
                }
            }
            return { keys: [], unresolvedReason: 'key argument is not a literal or a local list of literals' };
        };

        const recordUsage = (key: string, at: ts.Node, outcome: ChainOutcome, depth: number): void => {
            let kind: UsageKind;
            if (outcome.deleted && depth === 0) kind = 'remove';
            else if (outcome.assigned) kind = depth === 0 ? 'set' : 'fieldWrite';
            else if (outcome.deleted) kind = 'fieldWrite';
            else kind = 'read';
            record(key, {
                file: source.path,
                line: lineOf(sourceFile, at),
                kind,
                fn: enclosingName(at),
                text: truncate(at.getText(sourceFile)),
            });
        };

        const visit = (node: ts.Node): void => {
            if (ts.isPropertyAccessExpression(node) && universe.has(node.name.text) && onAnEntity(node)) {
                const outcome = chainOutcome(node);
                recordUsage(node.name.text, node, outcome, outcome.depth);
            }

            if (ts.isIdentifier(node)) {
                const alias = innermost(aliases, node.text, node.getStart(sourceFile));
                const outcome = alias ? chainOutcome(node) : null;
                if (alias && outcome && (outcome.assigned || outcome.deleted)) {
                    recordUsage(alias.key, node, outcome, alias.depth + outcome.depth);
                }
            }

            if (ts.isCallExpression(node)) {
                const name = calleeName(node);
                const builtin = name ? CALL_EFFECTS.get(name) : undefined;
                const wrapper = name ? wrappers.get(name) : undefined;

                const consider = (index: number, kinds: UsageKind[], viaWrapper?: string): void => {
                    const argument = node.arguments[index];
                    if (!argument) return;
                    const resolved = resolveKeyArgument(argument);
                    if (resolved.unresolvedReason) {
                        const named = stripWrappers(argument);
                        const forwarded = ts.isIdentifier(named)
                            && innermost(keyLocals, named.text, named.getStart(sourceFile)) === true;
                        if (ts.isStringLiteralLike(argument) || ts.isIdentifier(named) || ts.isElementAccessExpression(named)) {
                            unresolved.push({
                                file: source.path,
                                line: lineOf(sourceFile, node),
                                fn: enclosingName(node),
                                text: truncate(node.getText(sourceFile)),
                                reason: forwarded
                                    ? `"${named.text}" is a key the caller chose — counted at the call sites`
                                    : resolved.unresolvedReason,
                                keys: [],
                            });
                        }
                        return;
                    }
                    for (const key of resolved.keys) {
                        if (!universe.has(key)) continue;
                        for (const kind of kinds) {
                            record(key, {
                                file: source.path,
                                line: lineOf(sourceFile, node),
                                kind,
                                fn: enclosingName(node),
                                text: truncate(node.getText(sourceFile)),
                                ...(viaWrapper ? { viaWrapper } : {}),
                            });
                        }
                    }
                };

                if (builtin) {
                    if (builtin.keyArgs === 'all') node.arguments.forEach((_, index) => consider(index, [builtin.kind]));
                    else for (const index of builtin.keyArgs) consider(index, [builtin.kind]);
                }
                if (!builtin && wrapper && wrapper.effects.size > 0) {
                    consider(wrapper.parameterIndex, [...wrapper.effects], `${wrapper.name}()`);
                }
                if (name && ENTITY_LITERAL_CALLS.has(name) && node.arguments.length === 1) {
                    const argument = stripWrappers(node.arguments[0]);
                    if (ts.isObjectLiteralExpression(argument)) recordEntityLiteral(argument);
                }
                for (const index of (name ? contributors.entityParameters(name) : undefined) ?? []) {
                    const argument = node.arguments[index];
                    if (argument) takeContribution(argument, argument, false);
                }
            }

            if (ts.isObjectLiteralExpression(node) && isEntityTypedPosition(node, sourceFile)) recordEntityLiteral(node);

            if (ts.isObjectBindingPattern(node) && isEntityTypedBinding(node, sourceFile)) {
                for (const element of node.elements) {
                    const name = element.propertyName ?? element.name;
                    if (!ts.isIdentifier(name) || !universe.has(name.text)) continue;
                    record(name.text, {
                        file: source.path,
                        line: lineOf(sourceFile, element),
                        kind: 'read',
                        fn: enclosingName(node),
                        text: truncate(node.getText(sourceFile)),
                    });
                }
            }

            ts.forEachChild(node, visit);
        };

        const spreadMethodName = (expression: ts.Expression): string | null => {
            const target = stripWrappers(expression);
            if (ts.isBinaryExpression(target) && target.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
                return spreadMethodName(target.left);
            }
            if (!ts.isCallExpression(target)) return null;
            return calleeName(target);
        };

        const takeContribution = (expression: ts.Expression, at: ts.Node, spread: boolean): void => {
            const target = stripWrappers(expression);
            if (ts.isObjectLiteralExpression(target)) { recordEntityLiteral(target); return; }
            const contribution = resolveContribution(expression, universe, scope);
            for (const key of contribution?.keys ?? []) {
                record(key, {
                    file: source.path,
                    line: lineOf(sourceFile, at),
                    kind: 'add',
                    fn: enclosingName(at),
                    text: truncate(at.getText(sourceFile)),
                });
            }
            if (contribution && !contribution.partial) return;
            const method = spreadMethodName(expression);
            if (!contribution && method === null) return;
            const known = method ? contributors.keysOfMethod(method) : { keys: [], owners: 0 };
            if (!spread && known.owners === 0) return;
            unresolved.push({
                file: source.path,
                line: lineOf(sourceFile, at),
                fn: enclosingName(at),
                text: truncate(at.getText(sourceFile)),
                reason: method === null
                    ? 'entity parts from an expression the sweep cannot follow'
                    : `${method}() dispatches over a class the sweep cannot name; `
                        + `${known.owners} in the kit answer it`,
                keys: known.keys,
            });
        };

        const recordEntityLiteral = (literal: ts.ObjectLiteralExpression): void => {
            for (const property of literal.properties) {
                if (ts.isSpreadAssignment(property)) {
                    takeContribution(property.expression, property, true);
                    continue;
                }
                const name = property.name;
                if (!name || !(ts.isIdentifier(name) || ts.isStringLiteralLike(name))) continue;
                if (!universe.has(name.text)) {
                    suspect.push({
                        file: source.path,
                        line: lineOf(sourceFile, property),
                        fn: enclosingName(property),
                        text: truncate(property.getText(sourceFile)),
                        reason: `"${name.text}" is not a declared Entity key`,
                    });
                    continue;
                }
                record(name.text, {
                    file: source.path,
                    line: lineOf(sourceFile, property),
                    kind: 'add',
                    fn: enclosingName(property),
                    text: truncate(property.getText(sourceFile)),
                });
            }
        };

        ts.forEachChild(sourceFile, visit);
    }

    const declarationOf = new Map<string, KeyDeclaration>();
    for (const declaration of declarations) if (!declarationOf.has(declaration.key)) declarationOf.set(declaration.key, declaration);

    const reports: KeyReport[] = [];
    for (const declaration of declarations) {
        if (declarationOf.get(declaration.key) !== declaration) continue;
        if (options.keyFilter && declaration.key !== options.keyFilter) continue;
        const all = sites.get(declaration.key) ?? [];
        const readers = all.filter((site) => site.kind === 'read' || site.kind === 'query');
        const writers = all.filter((site) => site.kind === 'set' || site.kind === 'fieldWrite');
        const adders = all.filter((site) => site.kind === 'add');
        const removers = all.filter((site) => site.kind === 'remove');
        reports.push({
            key: declaration.key,
            declaredIn: `${declaration.file}:${declaration.line}`,
            declaredType: declaration.type,
            counts: { readers: readers.length, writers: writers.length, adders: adders.length, removers: removers.length },
            readers,
            writers,
            adders,
            removers,
        });
    }
    reports.sort((a, b) => a.key.localeCompare(b.key));

    const readWithoutWriter = reports.filter((report) => report.counts.readers > 0 && report.counts.writers === 0 && report.counts.adders === 0);
    const writtenNeverRead = reports.filter((report) => report.counts.readers === 0 && (report.counts.writers > 0 || report.counts.adders > 0));
    const declaredNeverUsed = reports
        .filter((report) => report.counts.readers === 0 && report.counts.writers === 0 && report.counts.adders === 0 && report.counts.removers === 0)
        .map((report) => declarationOf.get(report.key)!);

    return {
        filesAnalysed: parsed.length,
        filesSkipped: options.filesSkipped ?? 0,
        truncated: options.truncated === true,
        keysDeclared: universe.size,
        readWithoutWriter,
        declaredNeverUsed,
        writtenNeverRead,
        keys: reports,
        systems,
        systemsNamedLikeKeys: systemsNamedLikeKeys(systems, declarations),
        readOutsideCapability: readsOutsideCapability(reports, declarations),
        oneWriterOneReader: oneWriterOneReader(reports, systems),
        unresolved,
        suspectEntityLiteralProperties: suspect,
        wrappers: [...wrappers.values()].map((wrapper) => ({
            name: wrapper.name,
            file: wrapper.file,
            parameter: wrapper.parameter,
            effects: [...wrapper.effects],
        })),
        parseErrors,
        limits: LIMITS,
    };
}

/** `const entity: Entity = { … }`, `x as Entity`, or a literal returned from a function typed Entity. */
function isEntityTypedPosition(literal: ts.ObjectLiteralExpression, sourceFile: ts.SourceFile): boolean {
    let current: ts.Node = literal;
    let parent = current.parent;
    while (parent && (ts.isParenthesizedExpression(parent) || ts.isNonNullExpression(parent))) {
        current = parent;
        parent = parent.parent;
    }
    if (!parent) return false;
    if ((ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent)) && parent.expression === current) {
        return /\bEntity\b/.test(parent.type.getText(sourceFile));
    }
    if (ts.isVariableDeclaration(parent) && parent.initializer === current && parent.type) {
        return /\bEntity\b/.test(parent.type.getText(sourceFile));
    }
    if (ts.isReturnStatement(parent)) {
        const owner = enclosingFunction(parent);
        return !!owner && !!owner.type && /\bEntity\b/.test(owner.type.getText(sourceFile));
    }
    return false;
}

function isEntityTypedBinding(pattern: ts.ObjectBindingPattern, sourceFile: ts.SourceFile): boolean {
    const parent = pattern.parent;
    if (!parent) return false;
    if (ts.isVariableDeclaration(parent) || ts.isParameter(parent)) {
        return !!parent.type && /\bEntity\b/.test(parent.type.getText(sourceFile));
    }
    return false;
}

function enclosingFunction(node: ts.Node): ts.SignatureDeclaration | null {
    let current: ts.Node | undefined = node.parent;
    while (current) {
        if (ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current) || ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
            return current;
        }
        current = current.parent;
    }
    return null;
}
