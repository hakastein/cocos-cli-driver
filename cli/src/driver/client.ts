import * as net from 'net';
import split2 from 'split2';
import { JSONRPCClient } from 'json-rpc-2.0';
import { EDITOR_METHODS } from '@cocos-cli/shared';
import type { Driver, EditorMethods, SceneFacade, SceneMethods } from '@cocos-cli/shared';
import { raceTimeout } from '../settle.ts';
import { ReplyTimeout, replyBudgetMs } from '../reply-deadline.ts';
import type { MissedReply, ReplyWatch } from '../reply-deadline.ts';

export type { EditorMethods, SceneFacade };

export interface ClientOptions {
    /** Named in the refusal, so a shell holding several editors says which one went quiet. */
    project: string;
    replyTimeoutMs: number;
}

export class DriverClient implements Driver, ReplyWatch {
    readonly editor: EditorMethods;
    readonly scene: SceneFacade;
    private isClosed = false;

    private readonly socket: net.Socket;
    private readonly rpc: JSONRPCClient;
    private readonly options: ClientOptions;
    private missedReply: MissedReply | null = null;

    private constructor(socket: net.Socket, rpc: JSONRPCClient, options: ClientOptions) {
        this.socket = socket;
        this.rpc = rpc;
        this.options = options;
        const groups: Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>> = {};
        for (const name of EDITOR_METHODS) {
            const [group, method] = name.split('.');
            groups[group] = groups[group] || {};
            groups[group][method] = (...args: unknown[]) => this.request(`editor.${name}`, args);
        }
        // The loop covers every member: protocol.ts stops compiling if list and interface diverge.
        this.editor = groups as unknown as EditorMethods;
        this.scene = {
            call: <K extends keyof SceneMethods>(method: K, ...args: Parameters<SceneMethods[K]>) =>
                this.request(`scene.${method}`, args) as
                    Promise<Awaited<ReturnType<SceneMethods[K]>>>
        };
    }

    /**
     * The driver serves one request at a time, so once a reply has been given up on, the next
     * request queues behind the one that was abandoned and cannot be answered before it — waiting
     * the budget again would only spend it. It rejects with the request nobody answered, which is
     * the one that says what the editor is stuck on.
     */
    private async request(method: string, args: unknown[]): Promise<unknown> {
        if (this.missedReply) throw new ReplyTimeout(this.missedReply);

        const budgetMs = replyBudgetMs(method, this.options.replyTimeoutMs);
        const answer = Promise.resolve(this.rpc.request(method, args));
        if (budgetMs === null) return answer;

        const settled = await raceTimeout(answer, budgetMs);
        if (settled !== 'timed out') return settled;
        this.missedReply = { method, project: this.options.project, waitedMs: budgetMs };
        throw new ReplyTimeout(this.missedReply);
    }

    missed(): MissedReply | null {
        return this.missedReply;
    }

    static connect(address: string, options: ClientOptions): Promise<DriverClient> {
        return new Promise((resolve, reject) => {
            const socket = net.connect(address);
            const rpc = new JSONRPCClient(request => {
                if (socket.destroyed) {
                    return Promise.reject(new Error('the connection to the editor is closed'));
                }
                socket.write(JSON.stringify(request) + '\n');
                return Promise.resolve();
            });
            socket.pipe(split2()).on('data', (line: string) => {
                if (!line.trim()) return;
                try { rpc.receive(JSON.parse(line)); } catch { }
            });
            socket.once('error', reject);
            socket.on('close', () =>
                rpc.rejectAllPendingRequests('the connection to the editor closed'));
            socket.once('connect', () => resolve(new DriverClient(socket, rpc, options)));
        });
    }

    close(): void {
        this.isClosed = true;
        this.socket.destroy();
    }
}
