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
- **Failures print Dolibarr's own diagnosis, indented under the error.** Dolibarr puts the real
  cause in keys *beside* `message`, plus the PHP `file:line` that threw. Read the indented lines —
  they name the actual problem:
  ```
  Error 500: Internal Server Error: Error creating thirdparty
    ErrorCustomerCodeRequired
    (api_thirdparties.class.php:324 at call stage)
  ```
  Under `--json` these arrive as `details[]` and `source`. If instead you get the hint *"the server
  returned no detail"*, Dolibarr sent nothing usable — that is common on `update`, which discards
  its own validation errors. **`--verbose` dumps the raw response body**; reach for it before
  falling back to `curl`.
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
  dolibarr thirdparties create --set name="ACME GmbH" --set client=1 --set code_client=auto
  ```
  This covers **conditionally** required fields too — ones Dolibarr demands only because of
  another field's value. Setting `client` (1=customer, 2=prospect, 3=both) requires `code_client`,
  and `fournisseur=1` requires `code_fournisseur`; pass the literal **`auto`** and Dolibarr
  generates the next code in the sequence. The check is create-only: on `update` the record may
  already carry a code, which the CLI cannot know without a round trip.
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
