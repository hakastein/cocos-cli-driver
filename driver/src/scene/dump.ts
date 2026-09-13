import { siblingLabels } from '@cocos-cli/shared';
import type { SceneMethods, Vec3Like } from '@cocos-cli/shared';
import { componentClassName, findNodeByUuid, requireActiveScene } from './engine.ts';

function xyz(vector: any): Vec3Like {
    return { x: vector.x, y: vector.y, z: vector.z };
}

export const getNodeInfo: SceneMethods['getNodeInfo'] = (nodeUuid) => {
    try {
        const { Vec3 } = require('cc');
        const scene = requireActiveScene();
        const node = findNodeByUuid(scene, nodeUuid);
        return {
            success: true,
            data: {
                uuid: node.uuid,
                name: node.name,
                active: node.active,
                local: {
                    position: xyz(node.position),
                    rotation: xyz(node.eulerAngles),
                    scale: xyz(node.scale)
                },
                world: {
                    position: xyz(node.worldPosition),
                    rotation: xyz(node.worldRotation.getEulerAngles(new Vec3())),
                    scale: xyz(node.worldScale)
                },
                parent: node.parent?.uuid,
                children: node.children.map((child: any) => child.uuid),
                components: node.components.map((comp: any) => ({
                    className: componentClassName(comp),
                    enabled: comp.enabled
                }))
            }
        };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
};

function countDescendants(node: any): number {
    let count = 0;
    for (const child of node.children || []) {
        if (!child) continue;
        count += 1 + countDescendants(child);
    }
    return count;
}

export const getCurrentSceneInfo: SceneMethods['getCurrentSceneInfo'] = () => {
    try {
        const scene = requireActiveScene();
        return {
            success: true,
            data: {
                name: scene.name,
                uuid: scene.uuid,
                nodeCount: countDescendants(scene)
            }
        };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
};

/**
 * Flat inventory of every node in the scene. Engine-side because `activeInHierarchy` and real
 * component class names exist only on the live objects, not in the editor's node dump.
 */
export const dumpSceneNodes: SceneMethods['dumpSceneNodes'] = (options = {}) => {
    try {
        const scene = requireActiveScene();
        const withComps = options.includeComponents !== false;
        const withXform = options.includeTransform === true;
        const root = options.rootUuid ? findNodeByUuid(scene, options.rootUuid) : scene;
        const nodes: any[] = [];
        const walk = (parent: any, prefix: string) => {
            // Same-named siblings are common (crowds, bone rigs); without a suffix their paths
            // collide and a path-keyed diff goes blind to one of them. `siblingLabels` is the
            // same rule the path resolver indexes by, so every path printed here is one that
            // can be handed straight back as `nodePath`.
            const children = (parent.children || []).filter(Boolean);
            const labels = siblingLabels(children);
            children.forEach((child: any, i: number) => {
                const label = labels[i];
                const path = prefix ? `${prefix}/${label}` : label;
                const entry: any = {
                    uuid: child.uuid,
                    name: child.name,
                    path,
                    parentUuid: child.parent ? child.parent.uuid : null,
                    active: child.active,
                    activeInHierarchy: child.activeInHierarchy,
                    childCount: (child.children || []).length
                };
                if (withComps) {
                    entry.components = (child.components || []).map((c: any) => ({
                        className: componentClassName(c),
                        uuid: c && c.uuid,
                        enabled: c ? c.enabled !== false : false
                    }));
                }
                if (withXform) {
                    entry.position = xyz(child.position);
                    entry.rotation = xyz(child.eulerAngles);
                    entry.scale = xyz(child.scale);
                }
                nodes.push(entry);
                walk(child, path);
            });
        };
        walk(root, options.rootUuid ? root.name : '');
        return { success: true, data: { sceneName: scene.name, nodeCount: nodes.length, nodes } };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
};

/**
 * Every node in the open scene carrying a component of the given class.
 *
 * Answers "which node owns component X" directly. Reading it out of a prefab/scene file
 * instead means matching the 23-char compressed uuid the serializer writes, and the
 * usual shortcut — "the component appears in the file, so it must be on the root" — is
 * not something that check can actually distinguish, which has produced at least one
 * root-only-lookup runtime bug.
 */
export const findComponentOwners: SceneMethods['findComponentOwners'] = (options: any = {}) => {
    try {
        const className = typeof options === 'string' ? options : options.className;
        if (typeof className !== 'string' || !className.trim()) {
            return { success: false, error: "findComponentOwners requires a non-empty 'className'" };
        }
        const wanted = className.trim();
        const includeInactive = options.includeInactive !== false;
        const scene = requireActiveScene();

        const owners: any[] = [];
        let scanned = 0;
        const walk = (parent: any, prefix: string) => {
            const children = (parent.children || []).filter(Boolean);
            const labels = siblingLabels(children);
            children.forEach((child: any, i: number) => {
                const path = prefix ? `${prefix}/${labels[i]}` : labels[i];
                scanned++;
                if (includeInactive || child.activeInHierarchy) {
                    // match the registered name, the bare JS name and the `cc.`-qualified
                    // spelling, so 'Sprite' and 'cc.Sprite' both resolve
                    const hits = (child.components || []).filter((c: any) => {
                        if (!c) return false;
                        const registered = componentClassName(c);
                        const js = c.constructor ? c.constructor.name : '';
                        return registered === wanted
                            || js === wanted
                            || `cc.${js}` === wanted
                            || registered === `cc.${wanted}`;
                    });
                    for (const c of hits) {
                        owners.push({
                            nodePath: path,
                            nodeUuid: child.uuid,
                            nodeName: child.name,
                            active: child.active,
                            activeInHierarchy: child.activeInHierarchy,
                            componentUuid: c.uuid,
                            className: componentClassName(c),
                            enabled: c.enabled !== false
                        });
                    }
                }
                walk(child, path);
            });
        };
        walk(scene, '');

        return {
            success: true,
            data: {
                className: wanted,
                sceneName: scene.name,
                nodesScanned: scanned,
                ownerCount: owners.length,
                owners
            }
        };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
};
