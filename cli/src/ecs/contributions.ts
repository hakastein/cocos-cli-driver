/**
 * What a call puts on an entity.
 *
 * Assembly hands an authored component the entity under construction and spreads what it answers:
 * `{ node, ...spot.read() }`. Read as syntax that is a spread of a call and names no key at all, so
 * every key the scene lays this way was missing from the census entirely — the `add` that made it
 * existed only inside `read()`, and the assembly that decided to place it was invisible.
 *
 * A contributor is a function or method whose returned object literal names component keys. Its
 * declared return type does not answer this: the kit annotates every one of them `Partial<Entity>`,
 * which is all 122 keys. The literal it returns is what says which.
 */
import * as ts from 'typescript';
import { receiverShape } from './receivers.ts';
import type { BindingTable, ParsedSource } from './receivers.ts';

export interface Contribution {
    keys: string[];
    /** A spread inside the contributor that could not be followed — the key list is short. */
    partial: boolean;
}

export interface ContributorIndex {
    /** `Occupiable.read`, or a bare function name when the class is not known. */
    keysOf(className: string | null, method: string): Contribution | undefined;
    /** `runProtocol` calls `read()` over `getComponents(Component)`, so such a site names no class. */
    keysOfMethod(method: string): { keys: string[]; owners: number };
    /** Parameter positions of a named function typed `Entity` or `Partial<Entity>`. */
    entityParameters(name: string): number[] | undefined;
}

export interface ContributionScope {
    index: ContributorIndex;
    table: BindingTable;
    classes: ReadonlySet<string>;
}

function stripWrappers(node: ts.Expression): ts.Expression {
    let current = node;
    while (ts.isParenthesizedExpression(current) || ts.isNonNullExpression(current) || ts.isAsExpression(current)) {
        current = current.expression;
    }
    return current;
}

function functionNameOf(node: ts.FunctionLikeDeclaration): string | null {
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name && ts.isIdentifier(node.name)) {
        return node.name.text;
    }
    const owner = node.parent;
    if (owner && ts.isVariableDeclaration(owner) && ts.isIdentifier(owner.name)) return owner.name.text;
    return null;
}

function enclosingClassName(node: ts.Node): string | null {
    let current: ts.Node | undefined = node.parent;
    while (current) {
        if (ts.isClassDeclaration(current) && current.name) return current.name.text;
        current = current.parent;
    }
    return null;
}

/** Every `return` of the function itself, with nested functions left to answer for themselves. */
function returnedExpressions(body: ts.Node): ts.Expression[] {
    const returned: ts.Expression[] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)
            || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return;
        if (ts.isReturnStatement(node) && node.expression) returned.push(node.expression);
        ts.forEachChild(node, visit);
    };
    if (ts.isBlock(body)) ts.forEachChild(body, visit);
    else if (ts.isExpression(body)) returned.push(body);
    return returned;
}

interface Draft {
    name: string;
    literals: ts.ObjectLiteralExpression[];
    table: BindingTable;
    contribution: Contribution;
}

function literalKeys(
    literal: ts.ObjectLiteralExpression,
    universe: ReadonlySet<string>,
    scope: ContributionScope
): Contribution {
    const keys: string[] = [];
    let partial = false;
    for (const property of literal.properties) {
        if (ts.isSpreadAssignment(property)) {
            const nested = resolveContribution(property.expression, universe, scope);
            if (!nested) { partial = true; continue; }
            keys.push(...nested.keys);
            if (nested.partial) partial = true;
            continue;
        }
        const name = property.name;
        if (!name || !(ts.isIdentifier(name) || ts.isStringLiteralLike(name))) { partial = true; continue; }
        if (universe.has(name.text)) keys.push(name.text);
    }
    return { keys: [...new Set(keys)], partial };
}

/**
 * A dynamic dispatch, or a class the sweep never saw, answers undefined — the caller reports the
 * blindness rather than guessing at a key list.
 */
export function resolveContribution(
    expression: ts.Expression,
    universe: ReadonlySet<string>,
    scope: ContributionScope
): Contribution | undefined {
    const target = stripWrappers(expression);

    if (ts.isBinaryExpression(target) && target.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
        return resolveContribution(target.left, universe, scope);
    }
    if (ts.isConditionalExpression(target)) {
        const whenTrue = resolveContribution(target.whenTrue, universe, scope);
        const whenFalse = resolveContribution(target.whenFalse, universe, scope);
        if (!whenTrue || !whenFalse) return undefined;
        return { keys: [...new Set([...whenTrue.keys, ...whenFalse.keys])], partial: whenTrue.partial || whenFalse.partial };
    }
    if (ts.isObjectLiteralExpression(target)) return literalKeys(target, universe, scope);
    if (!ts.isCallExpression(target)) return undefined;

    const callee = stripWrappers(target.expression);
    if (ts.isIdentifier(callee)) return scope.index.keysOf(null, callee.text);
    if (!ts.isPropertyAccessExpression(callee)) return undefined;
    const owner = receiverShape(callee.expression, scope.table, scope.classes);
    if (!owner || owner.className === null) return undefined;
    return scope.index.keysOf(owner.className, callee.name.text);
}

const ENTITY_PARTS = new Set(['Entity', 'Partial<Entity>', 'Readonly<Entity>', 'Readonly<Partial<Entity>>']);

/** `NonNullable<Entity[K]>` on `commands.add` is one component's value, not a bag of parts. */
function takesEntityParts(type: ts.TypeNode, sourceFile: ts.SourceFile): boolean {
    const alternatives = type.getText(sourceFile)
        .replace(/\s+/g, '')
        .split('|')
        .filter((alternative) => alternative !== 'null' && alternative !== 'undefined');
    return alternatives.length > 0 && alternatives.every((alternative) => ENTITY_PARTS.has(alternative));
}

/** A spread inside a contributor may name another contributor, so the key lists settle by iteration. */
export function collectContributors(
    parsed: readonly ParsedSource[],
    universe: ReadonlySet<string>,
    classes: ReadonlySet<string>,
    tables: ReadonlyMap<string, BindingTable>
): ContributorIndex {
    const contributions = new Map<string, Contribution>();
    const entityParameters = new Map<string, number[]>();
    const drafts: Draft[] = [];

    for (const { path, sourceFile } of parsed) {
        const table = tables.get(path)!;
        const visit = (node: ts.Node): void => {
            if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)
                || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
                const name = functionNameOf(node);
                if (name) {
                    const taking: number[] = [];
                    node.parameters.forEach((parameter, index) => {
                        if (parameter.type && takesEntityParts(parameter.type, sourceFile)) taking.push(index);
                    });
                    if (taking.length) entityParameters.set(name, taking);

                    if (node.body) {
                        const literals = returnedExpressions(node.body)
                            .map(stripWrappers)
                            .filter(ts.isObjectLiteralExpression);
                        if (literals.length) {
                            const owner = ts.isMethodDeclaration(node) ? enclosingClassName(node) : null;
                            const label = owner === null ? name : `${owner}.${name}`;
                            const contribution: Contribution = { keys: [], partial: false };
                            contributions.set(label, contribution);
                            drafts.push({ name: label, literals, table, contribution });
                        }
                    }
                }
            }
            ts.forEachChild(node, visit);
        };
        ts.forEachChild(sourceFile, visit);
    }

    const index: ContributorIndex = {
        keysOf(className: string | null, method: string): Contribution | undefined {
            return className === null
                ? contributions.get(method)
                : contributions.get(`${className}.${method}`);
        },
        keysOfMethod(method: string): { keys: string[]; owners: number } {
            const keys = new Set<string>();
            let owners = 0;
            for (const [label, contribution] of contributions) {
                if (label !== method && !label.endsWith(`.${method}`)) continue;
                owners += 1;
                for (const key of contribution.keys) keys.add(key);
            }
            return { keys: [...keys].sort(), owners };
        },
        entityParameters(name: string): number[] | undefined {
            return entityParameters.get(name);
        },
    };

    for (let round = 0; round < 4; round += 1) {
        let grew = false;
        for (const draft of drafts) {
            const scope: ContributionScope = { index, table: draft.table, classes };
            const keys = new Set<string>();
            let partial = false;
            for (const literal of draft.literals) {
                const found = literalKeys(literal, universe, scope);
                for (const key of found.keys) keys.add(key);
                if (found.partial) partial = true;
            }
            if (keys.size !== draft.contribution.keys.length || partial !== draft.contribution.partial) grew = true;
            draft.contribution.keys = [...keys];
            draft.contribution.partial = partial;
        }
        if (!grew) break;
    }

    return index;
}
