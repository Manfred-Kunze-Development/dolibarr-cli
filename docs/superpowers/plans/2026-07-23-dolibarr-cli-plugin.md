# Dolibarr CLI Claude Code Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a skill-only Claude Code plugin, inside the `dolibarr-cli` repo, that makes Claude fluent in the published `@manfred-kunze-dev/dolibarr-cli` CLI, distributed via a marketplace named `mkd`.

**Architecture:** Two manifests and one Markdown skill. `.claude-plugin/marketplace.json` at the repo root is the catalog; `plugin/` is the plugin (`plugin.json` + `skills/dolibarr/SKILL.md` + `README.md`). No code, so no unit tests — validation is `claude plugin validate` plus a manual load. The skill restates the CLI's verified behaviour so it travels to machines without this repo.

**Tech Stack:** JSON manifests, Markdown skill. Claude Code plugin system.

**Spec:** `docs/superpowers/specs/2026-07-23-dolibarr-cli-plugin-design.md`

**Branding note:** This project stays under MKD during the org's 2kw rebrand (see the `org-rebrand-2kw` memory). Marketplace `mkd`, author "Manfred Kunze Dev", install path `@manfred-kunze-dev/dolibarr-cli`. Do not use 2kw branding here.

**Verified facts to rely on (do not re-derive):**
- `owner/repo` shorthand in `/plugin marketplace add` is **GitHub-only**. GitLab needs the full URL: `/plugin marketplace add https://gitlab.com/manfred-kunze-dev/customers/manfred-kunze/dolibarr-cli.git` (confirmed against the Claude Code marketplace docs).
- Only `plugin.json` lives in a `.claude-plugin/` directory; `skills/` sits at the plugin root.
- The CLI's real behaviour (auth/sync/modules flow, `--json` to stdout + warnings to stderr, `--sqlfilters`, local required-field checks, `delete --yes`, `--query-entity`, no list totals) is recorded in `CLAUDE.md` and `README.md` in this repo and was verified live during the CLI build.

---

## File Structure

| File | Responsibility |
|---|---|
| `.claude-plugin/marketplace.json` | Repo-root catalog; one plugin entry, `source: "./plugin"`. |
| `plugin/.claude-plugin/plugin.json` | Plugin manifest: name, version, description, author. |
| `plugin/skills/dolibarr/SKILL.md` | The entire payload — teaches Claude to drive the CLI. |
| `plugin/README.md` | Human-facing: what it is, verified install commands. |
| `CLAUDE.md` (modify) | One-line note that the plugin skill is a downstream copy to keep in sync. |

No `dist/`, no build step, nothing packaged into npm. The plugin is consumed straight from the git repo.

---

## Task 1: Plugin manifest

**Files:**
- Create: `plugin/.claude-plugin/plugin.json`

- [ ] **Step 1: Create `plugin/.claude-plugin/plugin.json`**

Minimal required fields plus light metadata. No version-gated fields (`displayName`, `defaultEnabled`, etc.) — `claude plugin validate` in Task 5 is the ground truth.

```json
{
  "name": "dolibarr",
  "version": "0.1.0",
  "description": "Drive the Dolibarr ERP/CRM CLI (@manfred-kunze-dev/dolibarr-cli) fluently — auth, per-instance sync, and the traps.",
  "author": {
    "name": "Manfred Kunze Dev"
  },
  "keywords": ["dolibarr", "erp", "crm", "cli"]
}
```

- [ ] **Step 2: Verify it is valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('plugin/.claude-plugin/plugin.json','utf8')); console.log('valid')"`
Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add plugin/.claude-plugin/plugin.json
git commit -m "feat(plugin): add plugin manifest

Refs: #3
Epic: &22"
```

---

## Task 2: The skill

**Files:**
- Create: `plugin/skills/dolibarr/SKILL.md`

This is the deliverable. Its `description` frontmatter is what makes Claude auto-invoke it on Dolibarr work.

- [ ] **Step 1: Create `plugin/skills/dolibarr/SKILL.md`**

```markdown
---
name: dolibarr
description: Use when working with a Dolibarr ERP/CRM instance from the terminal — listing, creating, updating or deleting thirdparties, invoices, orders, products, projects, or any Dolibarr entity via the `dolibarr` / `doli` CLI. Covers auth, the per-instance sync model, filtering, and the traps that bite.
---

# Driving the Dolibarr CLI

`@manfred-kunze-dev/dolibarr-cli` (`dolibarr`, also `doli`) surfaces the **complete** REST API of
whatever Dolibarr instance it is pointed at. The command tree is not fixed — it is derived from the
connected instance — so the workflow below is not optional ceremony, it is how the tool works.

## 0. Ensure it is installed

Run `dolibarr --version`. If the command is not found:

```bash
npm i -g @manfred-kunze-dev/dolibarr-cli
```

## The mental model — read this before anything else

Dolibarr registers a REST endpoint only when its module is enabled, so **no two instances expose
the same API**. The CLI therefore builds its command tree from the instance itself:

- Module commands (`invoices`, `thirdparties`, …) **do not exist until you `sync`**. Before that,
  only the built-ins exist: `auth`, `context`, `config`, `sync`, `modules`, `api`.
- The commands are named after **that instance's own module tags**. `dolibarr modules` lists them.
- Re-run `sync` after enabling/disabling a module or upgrading Dolibarr.

## The workflow

```bash
# 1. Authenticate. Base URL MUST end in /api/index.php.
dolibarr auth login --base-url https://erp.example.com/api/index.php --api-key <key>

# 2. Build the command tree for this instance.
dolibarr sync

# 3. See what this instance actually exposes.
dolibarr modules

# 4. Use it.
dolibarr thirdparties list --limit 10
dolibarr invoices get 42
```

Get an API key in Dolibarr under **Setup → Users & Groups → *user* → API key**.

### Several instances

Contexts are kubectl-style — one per customer instance. Each caches its own command tree, so
**`sync` once per context**.

```bash
dolibarr context create acme --base-url https://acme.example.com/api/index.php --api-key <key>
dolibarr context use acme
dolibarr sync
dolibarr context list
```

## The traps — each of these will bite if you don't know it

- **`sync` is per-context AND entity-scoped.** On a multi-company instance, pass `--entity <id>`
  *before* syncing, or the tree describes the wrong entity — and an unknown entity returns an
  almost-empty tree without erroring.
- **`--json` is pipe-safe.** Raw JSON goes to stdout; warnings and errors go to stderr. Pipe to
  `jq` freely:
  ```bash
  dolibarr thirdparties list --properties id,email --json | jq -r '.[].email'
  ```
- **`--sqlfilters` is the only server-side filter.** Syntax is `(t.field:operator:'value')`,
  combinable with `and`/`or`. Operators: `=`, `<`, `>`, `<=`, `>=`, `!=`, `like`.
  ```bash
  dolibarr thirdparties list --sqlfilters "(t.nom:like:'ACME%')"
  dolibarr invoices list --sqlfilters "(t.paye:=:0) and (t.fk_statut:=:1)"
  ```
- **`--properties id,name,email`** narrows the fields the server returns — use it on wide entities.
- **Create validates required fields locally.** A missing field errors immediately and names
  itself, before any HTTP request. Supply fields with repeatable `--set key=value` (dot paths
  nest, e.g. `--set lines.0.qty=2`) or `--data @file.json`. Custom fields: `--extrafield k=v`.
  ```bash
  dolibarr thirdparties create --set name="ACME GmbH" --set client=1
  ```
- **`delete` refuses without consent.** It prompts interactively; when scripting or running
  non-interactively you MUST pass `--yes`, or it aborts.
  ```bash
  dolibarr thirdparties delete 42 --yes
  ```
- **Lists have no total count.** Dolibarr returns a bare array; the CLI reports only what it
  received. Paginate with `--limit` / `--page` until a short page comes back. Never expect a grand
  total.
- **`--entity <id>`** selects the entity on multi-company instances. Two endpoints have their own
  query parameter literally named `entity`, exposed as **`--query-entity`** so it stays distinct
  from the global flag. Global options may go before or after the subcommand.

## The escape hatch

For anything the synced tree does not cover — a path a stale manifest missed, or a custom module's
endpoint — call it directly:

```bash
dolibarr api GET /status --json
dolibarr api POST /thirdparties --data '{"name":"ACME"}'
```

## Discovering an operation

`dolibarr <module> --help` lists a module's commands; `dolibarr <module> <command> --help` shows a
command's arguments and flags (Dolibarr's own parameter descriptions come through). Command names
derive from the API operation: `list`, `get`, `create`, `update`, `delete`, plus sub-resource verbs
like `create-line` or `get-by-email`.
```

- [ ] **Step 2: Verify the frontmatter parses (name + description present, well-formed)**

Run:
```bash
node -e "
const fs=require('fs');
const s=fs.readFileSync('plugin/skills/dolibarr/SKILL.md','utf8');
const m=s.match(/^---\n([\s\S]*?)\n---/);
if(!m){console.error('NO FRONTMATTER');process.exit(1);}
const fm=m[1];
if(!/^name:\s*dolibarr\s*$/m.test(fm)){console.error('bad name');process.exit(1);}
if(!/^description:\s*\S/m.test(fm)){console.error('bad description');process.exit(1);}
console.log('frontmatter ok');
"
```
Expected: `frontmatter ok`

- [ ] **Step 3: Verify every CLI claim in the skill matches the repo's own docs**

The skill must not invent behaviour. Cross-check the load-bearing claims against `CLAUDE.md` / `README.md`, which are the verified record.

Run (note the `--` before `"$term"`: without it, grep parses a value like `--yes` as one of its own flags and reports a false MISSING):
```bash
for term in "api/index.php" "sqlfilters" "query-entity" "--yes" "total"; do
  if grep -qi -- "$term" README.md CLAUDE.md 2>/dev/null; then echo "OK  $term"; else echo "MISSING $term"; fi
done
```
Expected: every line `OK`. (Verified while writing this plan: all five are present — `--yes` is on README.md line 105, `total` in its scripting section.) If any load-bearing term is genuinely absent from the docs, the claim is unverified: fix the skill to match the docs, do not fix the docs to match the skill.

- [ ] **Step 4: Commit**

```bash
git add plugin/skills/dolibarr/SKILL.md
git commit -m "feat(plugin): add the dolibarr skill

The whole payload: install-on-demand, the sync-derived mental model, the
workflow, the traps, and the api escape hatch. Content mirrors the CLI's
verified behaviour recorded in CLAUDE.md and README.md.

Refs: #3
Epic: &22"
```

---

## Task 3: Marketplace catalog

**Files:**
- Create: `.claude-plugin/marketplace.json`

- [ ] **Step 1: Create `.claude-plugin/marketplace.json` at the repo root**

```json
{
  "name": "mkd",
  "owner": {
    "name": "Manfred Kunze Dev"
  },
  "description": "Manfred Kunze Dev tools for Claude Code.",
  "plugins": [
    {
      "name": "dolibarr",
      "source": "./plugin",
      "description": "Drive the Dolibarr ERP/CRM CLI fluently."
    }
  ]
}
```

- [ ] **Step 2: Verify JSON and that the source path resolves**

Run:
```bash
node -e "
const fs=require('fs');
const m=JSON.parse(fs.readFileSync('.claude-plugin/marketplace.json','utf8'));
if(m.name!=='mkd'){console.error('wrong marketplace name');process.exit(1);}
const src=m.plugins[0].source;
if(!fs.existsSync(src+'/.claude-plugin/plugin.json')){console.error('source does not point at the plugin');process.exit(1);}
console.log('marketplace ok, source resolves to', src);
"
```
Expected: `marketplace ok, source resolves to ./plugin`

- [ ] **Step 3: Commit**

```bash
git add .claude-plugin/marketplace.json
git commit -m "feat(plugin): add the mkd marketplace catalog

Refs: #3
Epic: &22"
```

---

## Task 4: Plugin README

**Files:**
- Create: `plugin/README.md`

The install commands here are the *verified* forms. `owner/repo` shorthand is GitHub-only; this repo is on GitLab, so the full URL is required.

- [ ] **Step 1: Create `plugin/README.md`**

```markdown
# Dolibarr plugin for Claude Code

Makes Claude fluent in the [`@manfred-kunze-dev/dolibarr-cli`](https://www.npmjs.com/package/@manfred-kunze-dev/dolibarr-cli)
CLI: the `auth → sync → modules → <module> <op>` workflow, server-side filtering, and the traps
that otherwise cost a round of trial and error.

It is a single skill. It does not bundle an MCP server (see the separate `dolibarr-mcp` for that),
slash commands, or hooks.

## Install

This marketplace is hosted on GitLab, so use the full repository URL — the `owner/repo` shorthand
resolves to GitHub only.

```
/plugin marketplace add https://gitlab.com/manfred-kunze-dev/customers/manfred-kunze/dolibarr-cli.git
/plugin install dolibarr@mkd
```

Private repo? Claude Code reuses your existing git credentials, so HTTPS via `gh`/keychain or a
loaded SSH key works the same as in your terminal.

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
```

- [ ] **Step 2: Verify the install command is the GitLab (not GitHub-shorthand) form**

Run:
```bash
grep -q "gitlab.com/manfred-kunze-dev/customers/manfred-kunze/dolibarr-cli.git" plugin/README.md && echo "gitlab url present" || echo "MISSING gitlab url"
grep -qE "marketplace add [a-z0-9-]+/[a-z0-9-]+$" plugin/README.md && echo "WARN: github shorthand present" || echo "no github shorthand"
```
Expected: `gitlab url present` and `no github shorthand`.

- [ ] **Step 3: Commit**

```bash
git add plugin/README.md
git commit -m "docs(plugin): plugin README with the verified GitLab install command

owner/repo shorthand is GitHub-only, so the GitLab install needs the full URL.

Refs: #3
Epic: &22"
```

---

## Task 5: Validate and load-test

**Files:** none (verification only)

- [ ] **Step 1: Structural validation**

Run: `claude plugin validate ./plugin`
Expected: passes with no errors. If `claude plugin validate` is unavailable in this environment, record that and fall back to the manual JSON checks from Tasks 1–3 (which already passed), and note in the report that structural validation was done by hand.

- [ ] **Step 2: Validate the marketplace too**

Run: `claude plugin validate . 2>/dev/null || claude plugin marketplace validate . 2>/dev/null || echo "no marketplace validator subcommand; relying on the JSON check from Task 3"`
Expected: passes, or the fallback line. Record whichever occurred.

- [ ] **Step 3: Manual load test**

Run: `claude --plugin-dir ./plugin`
Then, in the session, give a Dolibarr prompt such as: *"list the thirdparties on my Dolibarr instance"*.

Expected: the `dolibarr` skill activates (Claude announces using it, or its guidance visibly shapes the response — e.g. it reaches for `dolibarr sync` / `--sqlfilters` rather than guessing). Confirm `/help` or the plugin listing shows the plugin.

Record the observed behaviour verbatim. If the skill does NOT auto-invoke, the `description` frontmatter needs sharpening — that is the one field that controls invocation. Do not proceed to Task 6 until it fires.

- [ ] **Step 4: No commit**

Verification only; nothing to commit.

---

## Task 6: Note the duplication in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

The skill copies behaviour also documented in `CLAUDE.md`. Record that so a future CLI change updates both.

- [ ] **Step 1: Add a note to `CLAUDE.md`**

Append this to the end of `CLAUDE.md`:

```markdown
## The Claude Code Plugin Skill Is a Downstream Copy

`plugin/skills/dolibarr/SKILL.md` restates the CLI's user-facing behaviour (the auth/sync/modules
workflow, `--sqlfilters`, `--json` streams, local required-field checks, `delete --yes`,
`--query-entity`, no list totals) so the plugin works on machines that do not have this repo.

**When you change CLI behaviour that a user sees, update the skill in the same MR.** It is the same
repo on purpose — the skill and the CLI it documents cannot be allowed to drift. The plugin stays
under MKD branding (marketplace `mkd`, install `@manfred-kunze-dev/dolibarr-cli`) even as the org
rebrands to 2kw; that carve-out is deliberate.
```

- [ ] **Step 2: Verify the note landed**

Run: `grep -q "Downstream Copy" CLAUDE.md && echo "note present" || echo "MISSING"`
Expected: `note present`

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note that the plugin skill is a downstream copy to keep in sync

Refs: #3
Epic: &22"
```

---

## Self-Review Notes

Checked against the spec:

- **Spec coverage:** file layout (Tasks 1–4), both manifests (1, 3), the skill with all five body sections (2), README with verified install (4), validation + load test (5), the CLAUDE.md duplication note (6). All spec sections map to a task.
- **Non-goals honoured:** no MCP, no slash commands, no hooks, no CLI change, no npm publish — nothing in any task adds these.
- **The one real risk — auto-invocation — has an explicit gate** (Task 5 Step 3) rather than being assumed.
- **The GitLab-vs-GitHub install trap is resolved with a doc-verified command,** not a guess, and Task 4 Step 2 asserts the shorthand form is absent.
- **Branding carve-out is enforced** in the manifest (Task 1), the CLAUDE.md note (Task 6), and the plan header.
- **No unit tests, by design** — there is no code. Verification is validation + manual load, which the spec's Testing section prescribes. This is a deliberate departure from the usual TDD structure and is called out here so it is not mistaken for an omission.
