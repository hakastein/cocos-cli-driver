import type { NodeInfo, NodeTransform, Vec3Like } from '@cocos-cli/shared';

export function nodeHead(info: NodeInfo): string {
    const components = info.components
        .map(component => component.enabled === false ? `${component.className}(off)` : component.className)
        .join(',');
    return `${info.name}${info.active ? '' : '  (off)'}`
        + (components ? `  [${components}]` : '')
        + `  ${info.uuid}`;
}

/**
 * Six decimals drop the noise the engine's float math leaves in a composed value — a world rotation
 * of 90 degrees comes back as 89.99999999999999.
 */
function axis(value: number): string {
    return String(Number(value.toFixed(6)));
}

/** Spelled `x,y,z`, which `node set` takes back as it stands. */
function vector(value: Vec3Like): string {
    return [value.x, value.y, value.z].map(axis).join(',');
}

function transformLine(label: string, transform: NodeTransform): string {
    return `${label}  position ${vector(transform.position)}  rotation ${vector(transform.rotation)}`
        + `  scale ${vector(transform.scale)}`;
}

export function renderNodeTransforms(info: NodeInfo): string {
    return [transformLine('local', info.local), transformLine('world', info.world)].join('\n');
}
