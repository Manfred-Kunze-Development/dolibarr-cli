# Dolibarr plugin for Claude Code

Makes Claude fluent in the [`@manfred-kunze-dev/dolibarr-cli`](https://www.npmjs.com/package/@manfred-kunze-dev/dolibarr-cli)
CLI: the `auth → sync → modules → <module> <op>` workflow, server-side filtering, and the traps
that otherwise cost a round of trial and error.

It is a single skill. It does not bundle an MCP server (see the separate `dolibarr-mcp` for that),
slash commands, or hooks.

## Install

```
/plugin marketplace add Manfred-Kunze-Development/dolibarr-cli
/plugin install dolibarr@mkd
```

The marketplace is served from the public GitHub mirror at
[`Manfred-Kunze-Development/dolibarr-cli`](https://github.com/Manfred-Kunze-Development/dolibarr-cli);
`owner/repo` shorthand resolves to GitHub. The canonical source is a private GitLab repo that
push-mirrors to that GitHub repo, so the plugin files there are always current. Nothing is
downloaded as a release or package artifact — Claude Code clones the repo and reads the marketplace
straight from the git tree.

## What it does

The skill activates when you ask Claude to work with a Dolibarr instance. On first use it checks for
the `dolibarr` binary and installs it (`npm i -g @manfred-kunze-dev/dolibarr-cli`) if missing, then
drives it: authenticating, syncing the per-instance command tree, and applying the right flags —
`--sqlfilters` for server-side filtering, `--json` for piping to `jq`, `--yes` for deletes, and the
`api` passthrough for anything the synced tree does not cover.

## Local development

```
claude plugin validate ./plugin        # structural check
claude --plugin-dir ./plugin           # load without installing; then prompt Claude with a Dolibarr task
```

## Licence

Proprietary — see the repository LICENSE.
