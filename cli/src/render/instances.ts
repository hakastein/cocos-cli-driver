import Table from 'cli-table3';
import type { Hello } from '@cocos-cli/shared';

/**
 * `surface` is a column rather than a field of a second output format: it moves with the driver's
 * method list, which is how a rebuild is checked to have reached the editor.
 */
export function renderInstances(instances: Hello[]): string {
    if (!instances.length) return 'no open Cocos editor found';
    const table = new Table({ head: ['project', 'path', 'pid', 'surface'] });
    for (const hello of instances) {
        table.push([hello.project, hello.projectPath, String(hello.pid), hello.surfaceChecksum]);
    }
    return table.toString();
}
