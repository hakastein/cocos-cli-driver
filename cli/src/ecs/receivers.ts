/**
 * What sits to the left of the dot.
 *
 * The census recognises a component key by its name, so `X.velocity` reads as the `velocity`
 * component whatever `X` is. That is right for an entity and wrong for an engine component: an
 * `Emitter` has a `body`, an `InstrumentSlot` has a `node`, and a `CameraRig` has a `target` —
 * all of them names the kit also carries as component keys.
 *
 * There is no type checker to ask. `GameWorld` extends miniplex's `World` and every authored class
 * extends a `cc` one, and neither package resolves from the asset tree alone, so a `ts.Program`
 * over these sources answers `any` for exactly the receivers this file exists to classify. What it
 * does instead is follow the declaration: a local bound from `getComponent…()`, or annotated with a
 * class name, holds a class instance and not an entity.
 *
 * A receiver it cannot place stays unplaced, and the census keeps counting it — the blindness this
 * removes is a false read, and inventing a false silence in its place is no better.
 */
import * as ts from 'typescript';

export interface ParsedSource {
    path: string;
    sourceFile: ts.SourceFile;
}

const COMPONENT_LOOKUPS = new Set([
    'getComponent',
    'getComponents',
    'getComponentInChildren',
    'getComponentsInChildren',
    'getComponentInParent',
    'getComponentsInParent',
]);

/** `services.get(CameraRig)` — a container hands back an instance of the class it is asked for. */
const CLASS_KEYED_LOOKUPS = new Set(['get']);

/** `for (const component of node.components)`. */
const COMPONENT_ARRAYS = new Set(['components']);

export interface ReceiverShape {
    /** The class the sweep saw, or null when the lookup named none it could read. */
    className: string | null;
}

export interface BindingTable {
    /** The component a local holds at this position, or undefined when it holds something else. */
    componentAt(name: string, position: number): ReceiverShape | undefined;
}

function stripWrappers(node: ts.Expression): ts.Expression {
    let current = node;
    while (ts.isParenthesizedExpression(current) || ts.isNonNullExpression(current) || ts.isAsExpression(current)) {
        current = current.expression;
    }
    return current;
}

function calleeName(call: ts.CallExpression): string | null {
    const callee = stripWrappers(call.expression);
    if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
    if (ts.isIdentifier(callee)) return callee.text;
    return null;
}

/**
 * Every class name in reach: the kit's own declarations plus what it imports from `cc`. `Entity` is
 * an interface no class in the kit implements, so a receiver of any of these names is not one.
 */
export function collectClassNames(parsed: readonly ParsedSource[]): Set<string> {
    const names = new Set<string>();
    for (const { sourceFile } of parsed) {
        for (const statement of sourceFile.statements) {
            if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
            if (statement.moduleSpecifier.text !== 'cc') continue;
            const clause = statement.importClause;
            if (!clause) continue;
            if (clause.name) names.add(clause.name.text);
            if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
                for (const element of clause.namedBindings.elements) names.add(element.name.text);
            }
        }
        const visit = (node: ts.Node): void => {
            if (ts.isClassDeclaration(node) && node.name) names.add(node.name.text);
            ts.forEachChild(node, visit);
        };
        ts.forEachChild(sourceFile, visit);
    }
    return names;
}

/** The class a `getComponent…`-shaped call answers with, or undefined when the call is not one. */
export function componentLookup(call: ts.CallExpression, classes: ReadonlySet<string>): ReceiverShape | undefined {
    const name = calleeName(call);
    if (name === null) return undefined;
    const argument = call.arguments[0] === undefined ? null : stripWrappers(call.arguments[0]);
    const named = argument !== null && ts.isIdentifier(argument) ? argument.text : null;
    if (COMPONENT_LOOKUPS.has(name)) return { className: named };
    if (CLASS_KEYED_LOOKUPS.has(name) && named !== null && classes.has(named)) return { className: named };
    return undefined;
}

interface Binding {
    name: string;
    start: number;
    end: number;
    /** null where the name is re-declared to something else, so an outer binding stops applying. */
    shape: ReceiverShape | null;
}

export function boundNames(name: ts.BindingName): ts.Identifier[] {
    if (ts.isIdentifier(name)) return [name];
    const found: ts.Identifier[] = [];
    for (const element of name.elements) {
        if (ts.isOmittedExpression(element)) continue;
        found.push(...boundNames(element.name));
    }
    return found;
}

export function scopeRange(declaration: ts.Node): { start: number; end: number } {
    let current: ts.Node | undefined = declaration;
    while (current) {
        if (ts.isForOfStatement(current) || ts.isForInStatement(current) || ts.isForStatement(current)) {
            return { start: current.pos, end: current.end };
        }
        if (ts.isBlock(current) || ts.isSourceFile(current) || ts.isCaseBlock(current)) {
            return { start: declaration.end, end: current.end };
        }
        if (ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)
            || ts.isArrowFunction(current) || ts.isFunctionExpression(current)
            || ts.isConstructorDeclaration(current)) {
            return { start: current.pos, end: current.end };
        }
        current = current.parent;
    }
    return { start: declaration.pos, end: declaration.end };
}

export function collectBindings(sourceFile: ts.SourceFile, classes: ReadonlySet<string>): BindingTable {
    const bindings: Binding[] = [];

    const bind = (name: ts.BindingName, shape: ReceiverShape | undefined, declaration: ts.Node): void => {
        const range = scopeRange(declaration);
        for (const bound of boundNames(name)) {
            bindings.push({ name: bound.text, shape: ts.isIdentifier(name) ? shape ?? null : null, ...range });
        }
    };

    const shapeOfInitializer = (initializer: ts.Expression): ReceiverShape | undefined => {
        const target = stripWrappers(initializer);
        if (ts.isCallExpression(target)) return componentLookup(target, classes);
        if (ts.isElementAccessExpression(target) && ts.isCallExpression(stripWrappers(target.expression))) {
            return componentLookup(stripWrappers(target.expression) as ts.CallExpression, classes);
        }
        if (ts.isPropertyAccessExpression(target) && COMPONENT_ARRAYS.has(target.name.text)) return { className: null };
        if (ts.isBinaryExpression(target) && target.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
            return shapeOfInitializer(target.left);
        }
        return undefined;
    };

    const shapeOfType = (type: ts.TypeNode | undefined): ReceiverShape | undefined => {
        if (!type) return undefined;
        const alternatives = type.getText(sourceFile)
            .replace(/\s+/g, '')
            .split('|')
            .filter((alternative) => alternative !== 'null' && alternative !== 'undefined');
        if (!alternatives.length || !alternatives.every((alternative) => classes.has(alternative))) return undefined;
        return { className: alternatives[0] };
    };

    const iteratedShape = (node: ts.VariableDeclaration): ReceiverShape | undefined => {
        const list = node.parent;
        if (!list || !ts.isVariableDeclarationList(list) || !list.parent) return undefined;
        return ts.isForOfStatement(list.parent) ? shapeOfInitializer(list.parent.expression) : undefined;
    };

    const visit = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node)) {
            const shape = shapeOfType(node.type)
                ?? (node.initializer ? shapeOfInitializer(node.initializer) : iteratedShape(node));
            bind(node.name, shape, node);
        }
        if (ts.isParameter(node)) bind(node.name, shapeOfType(node.type), node);
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);

    return {
        componentAt(name: string, position: number): ReceiverShape | undefined {
            let best: Binding | undefined;
            for (const binding of bindings) {
                if (binding.name !== name || position < binding.start || position > binding.end) continue;
                if (!best || binding.end - binding.start < best.end - best.start) best = binding;
            }
            return best?.shape ?? undefined;
        },
    };
}

export function receiverShape(
    expression: ts.Expression,
    table: BindingTable,
    classes: ReadonlySet<string>
): ReceiverShape | undefined {
    const target = stripWrappers(expression);
    if (ts.isIdentifier(target)) return table.componentAt(target.text, target.getStart());
    if (ts.isCallExpression(target)) return componentLookup(target, classes);
    if (ts.isPropertyAccessExpression(target) && COMPONENT_ARRAYS.has(target.name.text)) return { className: null };
    return undefined;
}
