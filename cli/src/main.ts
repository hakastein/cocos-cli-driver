import { Command, CommanderError } from 'commander';
import { discover, probeAddress } from './discovery.ts';
import { present } from './render/present.ts';
import { emit } from './commands/shared.ts';
import { numberFlag } from './commands/flags.ts';
import { DEFAULT_REPLY_TIMEOUT_MS } from './reply-deadline.ts';
import { resolveClient, resolveProject } from './resolve.ts';
import { registerScene } from './commands/scene.ts';
import { registerNode } from './commands/node.ts';
import { registerComponent } from './commands/component.ts';
import { registerPrefab } from './commands/prefab.ts';
import { registerAsset } from './commands/asset.ts';
import { registerBuild } from './commands/build.ts';
import { registerLog } from './commands/log.ts';
import { EXIT } from './exit.ts';

/** Seconds, as `asset`'s own waits are: everything below this line is in milliseconds. */
function replyTimeoutMs(options: { replyTimeout?: string }): number | undefined {
    const seconds = numberFlag('--reply-timeout', options.replyTimeout);
    return seconds === undefined ? undefined : seconds * 1000;
}

export function buildProgram(): Command {
    const program = new Command('cocos');
    program
        .description('drives open Cocos Creator editors')
        .option('-p, --project <substring>', 'which editor, when several are open')
        .option('--reply-timeout <seconds>', 'how long to wait for the editor to answer one '
            + `request (default ${DEFAULT_REPLY_TIMEOUT_MS / 1000})`)
        .exitOverride();

    const client = () => resolveClient(program.opts().project, replyTimeoutMs(program.opts()));

    program
        .command('instances')
        .description('list the open editors')
        .action(async () => {
            const found = await discover(probeAddress);
            if (!found.length) {
                process.stderr.write('FAILED  no open Cocos editor found\n');
                process.exitCode = EXIT.NO_EDITOR;
                return;
            }
            emit(present({ kind: 'instances', instances: found }));
        });

    registerScene(program, client);
    registerNode(program, client);
    registerComponent(program, client);
    registerPrefab(program, client);
    registerAsset(program, client);
    registerBuild(program, client);
    registerLog(program, () => resolveProject(program.opts().project));

    return program;
}

if (require.main === module) {
    buildProgram().parseAsync(process.argv).catch((error: unknown) => {
        if (error instanceof CommanderError) {
            process.exitCode = error.exitCode === 0 ? EXIT.OK : EXIT.USAGE;
            return;
        }
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`FAILED  ${message}\n`);
        process.exitCode = EXIT.FAILED;
    });
}
