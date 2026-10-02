# Agent setup

Project instructions: [AGENTS.md](../../AGENTS.md). The local `cocos` skill lives at
`.agents/skills/cocos/SKILL.md` relative to this repository root.

The shared workspace setup runbook lives in the sibling playables checkout:
[Agent setup](../../../cocos-playables/docs/agents/setup.md). If it is absent, trust this
checkout with `hermes skills trust <checkout-path>` and register `~/.agents/skills`
in `skills.external_dirs` for common personal skills. Do not copy project skill bodies
into the Hermes profile.
