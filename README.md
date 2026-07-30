# Dolibarr CLI

A command-line interface for the [Dolibarr](https://www.dolibarr.org/) ERP/CRM REST API.

The command tree is built from **your** instance's own API description, so the CLI shows exactly
the modules that instance exposes — including endpoints from custom modules you wrote yourself.

## Install

```bash
npm install -g @manfred-kunze-dev/dolibarr-cli
```

Also available as `doli`.

### From Claude Code

A [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) plugin makes Claude fluent in this CLI — the
`auth → sync → modules → <module> <op>` workflow, `--sqlfilters`, `--json`, and the traps that
otherwise cost a round of trial and error. Type both lines inside a Claude Code session:

```
/plugin marketplace add Manfred-Kunze-Development/dolibarr-cli
/plugin install dolibarr@mkd
```

The plugin ships instructions, not a binary: on first use it checks for `dolibarr` and runs the npm
install above if it is missing. See [`plugin/README.md`](plugin/README.md) for what it contains and
how to load it without installing.

## Quick start

```bash
# Base URL must end in /api/index.php
dolibarr auth login --base-url https://erp.example.com/api/index.php --api-key <key>

# Fetch this instance's API description and build the command tree
dolibarr sync

# See what this instance actually exposes
dolibarr modules

dolibarr thirdparties list --limit 10
dolibarr invoices get 42
```

Get an API key from Dolibarr under **Setup → Users & Groups → *user* → API key**.

Until you run `sync`, only the built-in commands (`auth`, `context`, `config`, `sync`, `modules`,
`api`) exist — there is nothing to derive module commands from yet.

## Why sync?

Dolibarr only registers a REST endpoint when its module is enabled, so no two instances expose the
same API. Two real examples measured during development: one exposes 30 modules and 428 operations,
another 38 and 440 — and neither is a subset of the other. A hardcoded command tree would
misrepresent both, so the CLI reads the instance instead.

Re-run `sync` after enabling or disabling modules, or after a Dolibarr upgrade.

## Working with several instances

Contexts work like kubectl's, which matters if you operate Dolibarr for more than one customer.

```bash
dolibarr context create acme --base-url https://acme.example.com/api/index.php --api-key <key>
dolibarr context use acme
dolibarr sync            # each context caches its own command tree
dolibarr context list
```

## Reading and writing data

```bash
# Server-side filtering with Dolibarr's own filter syntax
dolibarr thirdparties list --sqlfilters "(t.nom:like:'ACME%')"

# Narrow the fields the server returns
dolibarr thirdparties list --properties id,name,email

# Choose table columns locally
dolibarr invoices list --columns ref,total_ttc,date

# Create: --set repeats, dot paths nest, --data takes JSON or @file.json
dolibarr thirdparties create --set name="ACME GmbH" --set client=1 --set code_client=auto
dolibarr thirdparties create --data @acme.json --set name="Override"

# Custom fields land in array_options
dolibarr thirdparties create --set name="ACME" --extrafield colour=red
```

Dolibarr create/update endpoints accept any property of the underlying record, so the CLI does not
restrict which fields you may send. Fields that are mandatory on create are checked locally first,
giving an immediate error instead of a server round trip.

A few fields are mandatory only in combination with another — setting `client` on a thirdparty
requires `code_client`, and `fournisseur=1` requires `code_fournisseur`. Dolibarr enforces these
inside the entity's `verify()`, where neither the API description nor the extracted required-field
list can see them, so they are curated by hand in `src/data/conditional-fields.json` and checked
the same way. Pass the literal `auto` to have Dolibarr generate the code.

### Anything not covered

`api` reaches any endpoint directly — useful for a path a stale manifest does not know about:

```bash
dolibarr api GET /status --json
dolibarr api POST /thirdparties --data '{"name":"ACME"}'
```

## Global options

| Flag | Description |
|---|---|
| `--api-key <key>` | Override the API key |
| `--base-url <url>` | Override the base URL (must end in `/api/index.php`) |
| `--entity <id>` | Entity id for multi-company instances (`DOLAPIENTITY`) |
| `--timeout <seconds>` | Request timeout, default 60 |
| `--json` | Raw JSON on stdout |
| `--no-color` | Disable colour |

Global options work before or after the subcommand. Two Dolibarr endpoints have their own query
parameter named `entity`, which is exposed as `--query-entity` so it stays distinct from the global
`--entity`.

Deletions prompt for confirmation. Pass `--yes` to skip it; without a terminal, `--yes` is required
rather than assumed.

Configuration resolves in this order: CLI flags → environment (`DOLIBARR_API_KEY`,
`DOLIBARR_BASE_URL`, `DOLIBARR_ENTITY`) → a `.dolibarr` JSON file in the working directory → the
active context.

## Scripting

`--json` prints unmodified JSON on stdout; warnings and errors always go to stderr, so pipelines
stay clean. Commands exit non-zero on failure.

```bash
dolibarr thirdparties list --properties id,email --json | jq -r '.[].email'
```

One Dolibarr quirk worth knowing when scripting: list endpoints return a bare array with **no total
count**, so the CLI reports only what it received and never invents a total. Paginate with
`--limit` and `--page` until you get a short page.

## Custom modules

Endpoints from your own Dolibarr modules appear automatically — run `sync` after enabling the
module. Nothing needs to be added to this CLI. The command group is named after the module's API
class, so a class `WidgetsApi` becomes `dolibarr widgetsapi`.

## Supported Dolibarr versions

Three majors at a time: **previous, current, next** — currently 22, 23 and 24 (`develop`). When a
new major ships stable the window rolls and the oldest is dropped. Other versions may well work,
since the CLI adapts to whatever the instance reports, but they are not tested.

## Local development

```bash
npm install
npm run build

docker compose --profile current up -d    # Dolibarr 23 on http://localhost:8023
npm run test:run                          # unit + contract tests
npm run test:unit                         # unit only, no Docker needed
```

The compose stack provides all three supported versions (`--profile previous|current|next|all`),
each seeded with the API module enabled and a fixed dev API key, so no UI clicks are needed.

Contract tests create and delete records. They refuse to run against a non-local target unless
`DOLIBARR_ALLOW_CONTRACT_TESTS=1` is set, and skip cleanly when no instance is reachable.

## Licence

Proprietary.
