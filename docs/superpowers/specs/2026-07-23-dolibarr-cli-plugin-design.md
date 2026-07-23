# Dolibarr CLI Claude Code Plugin — Design

**Date:** 2026-07-23
**Status:** Approved (design); implementation not started
**Repo:** `manfred-kunze-dev/customers/manfred-kunze/dolibarr-cli`

## Goal

Package the published `@manfred-kunze-dev/dolibarr-cli` npm CLI as a Claude Code plugin, so
that Claude is *fluent* in the tool — it drives the `auth → sync → modules → <module> <op>`
workflow correctly and avoids the traps — instead of grepping `--help` and guessing.

## Non-goals

- **No MCP server.** `../dolibarr-mcp` already exposes all 440 endpoints as MCP tools; wrapping
  the CLI in MCP would duplicate it. Claude runs the CLI through Bash, as a human would.
- **No slash commands.** The value is knowing *how* to use the tool, not shortcutting individual
  operations. Add them later only if a genuinely repeated task appears.
- **No hooks.** Nothing needs to run on a lifecycle event; the skill handles its own prerequisites.
- **No new CLI behaviour.** The plugin documents the CLI as it is; it does not change it.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| What it provides | A single skill | Claude can already run the CLI via Bash; what it lacks is fluency. |
| Home | Inside the `dolibarr-cli` repo | One source of truth; the skill cannot drift from a CLI it ships beside. |
| Distribution | A marketplace at the repo root | Anyone installs with `/plugin marketplace add <repo>` then `/plugin install`. |
| CLI bootstrap | The skill checks and installs on demand | No hook, no lifecycle code; installs only when the skill is actually used. |
| Skill versioning | Explicit `version`, decoupled from the CLI | The skill changes when the *guidance* changes, not on every CLI patch. |

## File layout

```
dolibarr-cli/
├─ .claude-plugin/
│  └─ marketplace.json           # catalog: one plugin, source "./plugin"
└─ plugin/
   ├─ .claude-plugin/
   │  └─ plugin.json             # name, version, description, author
   ├─ skills/
   │  └─ dolibarr/
   │     └─ SKILL.md             # the entire payload
   └─ README.md                  # install + what it does
```

Only `plugin.json` lives in `plugin/.claude-plugin/`; the `skills/` directory sits at the plugin
root. The marketplace's `.claude-plugin/marketplace.json` is a separate file at the *repo* root,
pointing at the plugin with a relative `source: "./plugin"`.

## Manifests

Both manifests are kept to the minimal fields the docs mark required, plus a small amount of
descriptive metadata. Fields that are gated on specific Claude Code versions are avoided;
`claude plugin validate` is the ground truth, not this document.

**`plugin/.claude-plugin/plugin.json`:**

```json
{
  "name": "dolibarr",
  "version": "0.1.0",
  "description": "Drive the Dolibarr ERP/CRM CLI (@manfred-kunze-dev/dolibarr-cli) fluently.",
  "author": { "name": "Manfred Kunze Dev" }
}
```

**`.claude-plugin/marketplace.json`** (repo root):

```json
{
  "name": "mkd-tools",
  "owner": { "name": "Manfred Kunze Dev" },
  "plugins": [
    {
      "name": "dolibarr",
      "source": "./plugin",
      "description": "Drive the Dolibarr ERP/CRM CLI fluently."
    }
  ]
}
```

The marketplace is named `mkd-tools` so it does not collide with any marketplace already
registered under the same account (names are unique per user), and so future MKD tool plugins can
be added to the same catalog.

## What SKILL.md contains

The skill is the whole deliverable. Its frontmatter `description` is tuned so Claude
auto-invokes it on Dolibarr / ERP tasks without the user naming it. Body sections:

1. **Ensure installed (step 0).** Run `dolibarr --version`; if the command is not found,
   `npm i -g @manfred-kunze-dev/dolibarr-cli`, then continue. Also available as `doli`.

2. **The mental model.** The command tree is *derived from the connected instance* by `sync`, so:
   module commands do not exist until an instance is synced; they are named after that instance's
   own module tags; and no two instances necessarily expose the same commands.

3. **The workflow.** `auth login` (base URL ends in `/api/index.php`) → `sync` → `modules` to see
   what exists → `<module> <op>`. Contexts (`context create/use/list`) switch between instances;
   each caches its own command tree, so `sync` per context.

4. **The traps, each stated once with the remedy:**
   - `sync` is per-context **and entity-scoped** — pass `--entity` before syncing a multi-company
     instance, or the tree describes the wrong entity.
   - `--json` prints raw JSON to stdout; warnings and errors go to stderr — safe to pipe to `jq`.
   - `--sqlfilters "(t.field:op:'value')"` is the only server-side filter; give the DSL syntax and
     a worked example.
   - `--properties id,name,email` narrows the fields the server returns.
   - Create validates required fields locally, so a missing-field error is immediate and names the
     field — supply them with repeatable `--set key=value` (dot paths nest) or `--data @file.json`.
   - **`delete` prompts for confirmation; pass `--yes` when non-interactive** or it refuses.
   - Lists return a bare array with **no total count** — paginate with `--limit`/`--page` until a
     short page comes back; never expect a grand total.
   - `--entity <id>` selects the entity on multi-company instances; two endpoints expose their own
     `entity` query parameter as `--query-entity`.

5. **The escape hatch.** `dolibarr api <METHOD> <path>` reaches any endpoint directly — for a path
   a stale manifest does not know, or a custom module's endpoint.

The section content is drawn from `CLAUDE.md` and the CLI README, which are the verified record of
this behaviour.

## Duplication, acknowledged

The skill restates behaviour that also lives in `CLAUDE.md` and the CLI README. This is deliberate:
the plugin travels to machines that do not have this repo. The cost is that CLI behaviour changes
must be reflected in the skill too. A one-line note is added to `CLAUDE.md` recording that the
plugin skill is a downstream copy to keep in sync.

## Testing

No code, so no unit tests. Two gates, both runnable:

- `claude plugin validate ./plugin` — structural validation of the manifest and layout. Must pass.
- `claude --plugin-dir ./plugin` — load locally and confirm the skill appears and fires on a
  Dolibarr prompt (e.g. "list thirdparties on my Dolibarr instance").

Neither can be run in CI without the Claude Code binary, so they are manual acceptance steps
recorded in the plan, not pipeline jobs.

## Delivery

- Branch `feat/claude-plugin`, MR into `main`, following the repo's existing hygiene rules.
- Issue on the GitLab project, attached to epic `&22`, referenced from every commit.
- No npm publish and no version bump of the CLI — the plugin is installed from the git repo via
  the marketplace, not from a registry.

## Risks

| Risk | Mitigation |
|---|---|
| Skill drifts from CLI behaviour | Note in `CLAUDE.md`; the skill lives in the same repo so a CLI change and its skill update are one MR. |
| Plugin-manifest fields are version-gated | Keep to minimal required fields; rely on `claude plugin validate`. |
| Marketplace name collision | Named `mkd-tools`, distinct from any existing marketplace. |
| Skill does not auto-invoke | Tune the `description` frontmatter; the manual load test confirms it fires. |
