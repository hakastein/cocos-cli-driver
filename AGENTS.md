# AGENTS.md

Guidance for any agent working in this repository. Paths below are repository-root-relative.

## Loading instructions

- Read this file and `CONTEXT.md` before changing code. Read nested `AGENTS.md` for the
  subtree being changed, even if your agent does not discover it automatically.
- Before changing commands, primitives, rendering, properties, asset operations, builds or
  prefabs, read [driver-guide.md](docs/agents/driver-guide.md) in full: the key-file map,
  contracts and implementation procedures are there.
- Load `.agents/skills/cocos/SKILL.md` before any open-editor or serialized-asset work.
- Common personal skills are in `~/.agents/skills/`: `youtrack`, `writing-unit-tests`,
  `writing-code-comments`. Read the applicable `SKILL.md` before the task. If your skill
  tool cannot discover it, read it directly; a missing skill is a setup problem.
- Agent discovery and setup: [setup.md](docs/agents/setup.md).
- The live `cocos <group> --help` and current source outrank older command inventories.
  `ecs census` is retired: do not restore it or add a replacement audit script.
- Older tracker instructions below and in `docs/agents/issue-tracker.md` describe `yt`.
  This workspace uses `ytrack` and the shared `youtrack` skill. For the current CLI contract,
  read [the playables tracker guide](../cocos-playables/docs/agents/issue-tracker.md), while
  preserving this repository's ticket-closing requirements. Do not install `yt` for old examples.

## Project Overview

A Cocos Creator 3.8.x editor extension (`driver/`) paired with a command-line client (`cli/`): an
agent runs `cocos <command>` in a shell to drive an open editor's scenes, nodes and components. The
CLI and the extension talk to each other over a local channel private to one project's editor; there
is no server an outside process listens on, and the shell *is* the interface — there is no separate
call-and-response protocol layered on top of it for an agent to learn.

This replaced an editor extension that exposed the same capabilities over MCP directly from inside
the editor process. That transport, and everything that served it, is gone from this repository; the
reasoning that led to the replacement is recorded in `docs/specs/2026-08-18-cocos-cli-design.md`.
The MCP-era `source/` tree went with it — `docs/source-inventory.md` says where each of its twelve
modules landed, so a module buried on purpose does not get proposed back from git history.

Three npm workspaces, one repo:

- `shared/` — types and pure logic both sides need.
- `driver/` — the editor extension, `cocos-cli-driver`. That name is declared once, in
  `driver/src/extension-name.ts`, and the editor keys three separate things off it: the folder under
  `{project}/extensions/`, `Editor.Panel.open`/`Editor.Message.request`, and the `name` of the scene
  script. It holds native primitives and decides nothing, plus a small Vue settings panel that is
  unrelated to the primitive surface.
- `cli/` — the `cocos` binary. Command parsing, node-path resolution, undo brackets, verified writes,
  rendering — everything an agent-facing decision needs lives here.

## Build Commands

```bash
npm install                       # dependencies for all three workspaces
npm run build                     # tsc (+ tsup where a package has one) for shared, driver, cli, in that order
npm test                          # the same build, then `node --test` inside each workspace
npm run test:only --workspace cli # cli's own tests, no cli build — they import `src/`; needs shared/dist
npm run build --workspace cli     # rebuild only cli — fine once shared/dist is already current
npm run build --workspace driver  # rebuild only driver, likewise
npm link --workspace cli          # put the `cocos` binary (cli/bin/cocos.js) on PATH
```

`shared` must build before `driver` and `cli` type-check: both import straight from
`@cocos-cli/shared/dist/...`, and the root `workspaces` array (`shared`, `driver`, `cli`) is what
gives `npm run build`/`npm test` that order.

`driver` and `cli` tests import `../src/*.ts` directly — Node strips the types, so a red-green loop
costs no build. That is what `allowImportingTsExtensions` and the `.ts` suffix on every relative
import inside `driver/src` and `cli/src` are for, and `erasableSyntaxOnly` keeps the sources
strippable (an `enum`, a `namespace` or a constructor parameter property would stop compiling).
`shared`'s own tests stay on `../dist/*.js`: `shared/dist` is what the other two import anyway, so it
is built before anything else runs.

## Architecture

Four execution contexts:

```
agent
  │ shell — the only interface
CLI                    cli/src/            all the logic: commands, orchestration, undo, rendering
  │ JSON-RPC over a local channel (named pipe on Windows, unix socket elsewhere)
driver                 driver/src/         89 native primitives, no logic of its own
  ├ editor.*           58 methods over Editor.Message
  └ scene.*            31 methods over the scene script
scene script           driver/src/scene/   the only place `cc.*` exists
```

`shared/` holds the types and pure logic both sides need: the whole driver seam (`Driver` =
`EditorMethods` + `SceneFacade`, in `driver.ts` over `editor-contract.ts` and `scene-contract.ts`),
`WriteReport` and `SceneResult`, the list of all 89 methods and the check that gates them
(`protocol.ts`), the handshake shape (`Hello`), the channel address (`pipe-name.ts`), node-path
parsing, and serialized-value comparison (`serialized-diff.ts`, `reference-projection.ts`).
Three adapters satisfy `Driver`: `driver/src/editor-api.ts` over `Editor.Message`,
`cli/src/driver/client.ts` over JSON-RPC, and `cli/src/driver/memory.ts` over a scene held as data.
Everything in `cli/src` that takes a driver takes `Driver`, never the concrete `DriverClient` —
that is what lets the memory adapter drive a command body.

**Key constraint:** engine APIs (`cc.*`) exist only in the scene script context. Anything that needs
them goes through `scene.*`, never through `editor.*`.

Command groups implemented in `cli/src/commands/` today: `scene`, `node`, `component`, `prefab`,
`asset`, `ecs`, `build`, `log`, plus the top-level `instances`. Two listings there answer questions that look like one and
are not: `component types` is the editor's Add Component menu (`scene:query-components`), and
`scene classes <base>` is the engine's class registry under a base (`scene:query-classes`). Measured
live 2026-08-21: 203 offered against 260 registered under `cc.Component`, the extra ones being
abstract bases and deprecated aliases; `query-classes` with no `extends` answers `[]`, so the base is
an argument rather than a filter, and `cc.Asset` is a legal base whose answers are no components at
all. That is why they are two subcommands in two groups rather than one flag. A `project` group is future
work; the raw `evalInScene` escape hatch is implemented in the scene script and reachable from no
command on purpose — [ADR-0002](docs/adr/0002-eval-in-scene-stays-unreachable.md).

Three commands ask the driver nothing and open no connection: `ecs census`, `log tail` and
`log search` resolve through `resolveProject`/`withProject`, which answers which project is open
without connecting to it. Their questions are about files the editor does not answer for — the
project's TypeScript, and `{projectPath}/temp/logs/project.log`.

`ecs census`'s question — which component key a
system reads and nothing writes — is about the project's TypeScript, which the editor does not
answer. Three further readings come off the same sweep, each standing for a rule of the playables'
`docs/ecs.md`: a system whose name is also a key (§6), a key read from outside the folder that
declares it (§2), and a key one system fills and one system reads (§4a.2). None of them changes the
verdict — the renamings they argue for are the capability tickets' work, and a census that exited 1
on the standing 20 collisions would fail on every run until the last of them lands.
Its verdict is `ok` or `UNVERIFIED` only, because a census is not a write
and cannot fail halfway: `UNVERIFIED` is what a sweep that did not read the whole kit answers, and a
`--kit` narrower than `db://assets` counts as exactly that — the writer the census did not look for
leaves a key reading as starved, and the caller having asked for the narrowing does not confirm it.
`assets/framework` in `CyberCore` is a directory junction onto a shared kit, so `readKit` follows
links: the first live run stopped at it and answered `keys 0 in 3 files`.

The sweep places a receiver by its declaration, never by a type checker: `GameWorld` extends
miniplex's `World` and every authored class extends a `cc` one, and neither package resolves from
the asset tree, so a `ts.Program` over these sources answers `any` for the very receivers that
decide the question. `receivers.ts` follows the declaration instead — a local bound from
`getComponent…()`, from a container `get(Class)`, or annotated with a class name holds a class
instance and not an entity, which is what tells `slot.node` from `entity.node` and `rig.target`
from `entity.target`. Measured 2026-08-23 over `thuglife`: 80 of the 346 readers of `node` were
engine components. `contributions.ts` answers the other half — `{ node, ...spot.read() }` names no
key in syntax at all, and the declared return type is `Partial<Entity>`, which is all 122 of them;
the object literal the method returns is what says which, so a contributor is indexed by the keys of
that literal and a spread expands to them.

`driver/` also carries a small subsystem outside this diagram entirely: a Vue settings panel
(`driver/src/panels/default/index.ts`, its own `tsup` entry) that shows `PipeServer` status and
edits `enableDebugLog`, wired to `driver/src/main.ts` through three `Editor.Message` IPC methods
(`openPanel`, `getDriverStatus`, `updateSettings`) declared in `driver/package.json`'s
`contributions.messages`. It does not go through the pipe or `EDITOR_METHODS`/`SCENE_METHODS` at
all — it is the editor UI talking to its own extension, not the CLI talking to the driver.

## Checkpoint Procedure

A change in `cli/`:

1. `npm run test:only --workspace cli` for the red-green loop — it needs no build. `npx tsc -p
   cli/tsconfig.json` type-checks, and `npm test` runs the whole thing before a commit.
2. Run the affected command(s) against a real open editor and read the answer — don't assume it.

A change in `driver/` (this includes a change to `shared/`, since `driver`'s `tsup` build inlines
`@cocos-cli/shared` into its bundle) needs one more step: **restart the editor by hand**. Toggling
the extension off and on in the Extension Manager leaves the old bundle running — checked live
2026-08-20 (PLY-9): after `npm run build` and a toggle, `hello`'s `surfaceChecksum` still answered
the old value and a freshly added method answered `Method not found`. The scene worker caches
`driver/src/scene/` the same way, and neither the rebuild nor the toggle busts that one either. The
driver process is what has to reload, and only a restart of the editor reloads it.

Then check that the restart carried the new bundle. `cocos instances` prints the editor's pid, which
is a different number after a restart; when the change adds or removes a method,
`cocos instances` also prints a `surface` column carrying `surfaceChecksum`, which moves with the
method list. When the change touches neither list, the changed behaviour itself is the check.

A write-path change is only checked once the scene has been saved and Ctrl+Z tried.

## Conventions

- **Tests on pure functions and on command bodies through one in-memory adapter**
  (`cli/src/driver/memory.ts`). No Commander-wiring and no UI tests. A command's own double does not
  get written: a fifth hand-rolled fake is what this rule replaced. Load the `writing-unit-tests`
  skill before writing one. A case earns its place only if a mutation of production code fails it.
- **Comments are the exception, not the default.** Load `writing-code-comments` before writing one.
  What is visible from the code and the names does not get restated.
- One command group per `cli/src/commands/<group>.ts`; one concern per `driver/src/scene/<concern>.ts`.
- Each of `shared/`, `driver/`, `cli/` carries its own `tsconfig.json` and `strict: true`; there is
  no config file above the package level, so `npm run build` over the three workspaces is the whole
  type-check. `shared` emits `dist/`, which the other two import. `driver` and `cli` emit nothing
  from `tsc` (`noEmit`) — it is their type-check — and ship a `tsup` bundle instead: `driver` into
  `dist/` (the extension's actual `main`), `cli` into `bin/cocos.js` (the actual `cocos` binary),
  both built from `src/` directly. `typescript` is the one dependency `cli`'s bundle leaves outside
  itself (`external` plus the negative lookahead in `noExternal`, which tsup consults first).
  Measured 2026-08-21: bundling it took `bin/cocos.js` from 1.44 MB to 28.85 MB, and `require`ing it
  costs 85 ms. Only `ecs census` parses anything, so `commands/ecs.ts` reaches `ecs/census.ts`
  through a dynamic `import()` and no other command loads a parser it does not use.

## Settings

`{project}/settings/cocos-cli-driver.json`: `enableDebugLog` only. Every driver primitive and every
CLI command is always reachable — there is no per-primitive or per-command enable/disable.

## Agent skills

### Issue tracker

Issues live in YouTrack project `PLY`, driven with `ytrack` and the shared `youtrack` skill.
The current CLI contract is in `../cocos-playables/docs/agents/issue-tracker.md`;
`docs/agents/issue-tracker.md` preserves the older workflow and ticket-closing requirements.

**A ticket you implemented gets closed in the same run** — comment, `--state Done`, and a pointer in
the parent map. `/implement` stops at the commit and says nothing about the tracker, so this step
belongs to whoever ran it. The procedure is `docs/agents/issue-tracker.md`, *Closing a ticket you
implemented*; it is not optional and does not need asking.

### Triage labels

The seven canonical triage roles are YouTrack tags under their default names.
See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
`CONTEXT.md` is the glossary: the term it defines is the term to use in an issue title, a test name
or a report. `docs/adr/` holds what would otherwise be reopened — the burial of offline `.prefab` /
`.meta` parsing (0001) and the deliberately unreachable `evalInScene` (0002).
