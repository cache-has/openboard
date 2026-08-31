# 14 — Packaging & Distribution

## Goal

Make Orrery installable and deployable with minimal friction. Ship as an npm package, a Docker image, and provide a scaffolding tool for new projects.

## npm Package

### Main Package: `orrery`

```bash
npm install orrery
# or globally
npm install -g orrery
```

Provides:
- `orrery dev` — dev server
- `orrery build` — static export
- `orrery validate` — validation
- `orrery diff` — git diff for dashboards
- `orrery preview` — generate preview artifacts

### Scaffolding: `create-orrery`

```bash
npm create orrery my-dashboards
# or
npx create-orrery my-dashboards
```

Interactive scaffolding:

```
? Project name: my-dashboards
? Database type: PostgreSQL
? Include GitHub Actions workflows? Yes
? Theme: Dark
? Include example dashboard? Yes

Creating project in ./my-dashboards...
  ✓ Created dashboards/example.board
  ✓ Created connections/database.yaml
  ✓ Created .env.example
  ✓ Created .github/workflows/validate.yml
  ✓ Created .github/workflows/deploy.yml
  ✓ Created .gitignore
  ✓ Created package.json
  ✓ Installed dependencies

Done! Run:
  cd my-dashboards
  cp .env.example .env   # add your database credentials
  npx orrery dev
```

### Package Contents

The npm package includes:
- Compiled JS (ESM)
- Type definitions
- CLI entry point
- Built CSS (default themes)
- Built client-side JS bundle
- GitHub Actions workflow template files

### package.json Setup

```json
{
  "name": "orrery",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "orrery": "./dist/cli/index.js"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": [
    "dist/",
    "actions/",
    "templates/"
  ],
  "engines": {
    "node": ">=18"
  }
}
```

## Docker Image

```dockerfile
FROM node:20-slim
WORKDIR /app
RUN npm install -g orrery
EXPOSE 3000
ENTRYPOINT ["orrery"]
CMD ["dev", "--host", "0.0.0.0"]
```

Usage:

```bash
# Run dev server
docker run -p 3000:3000 \
  -v $(pwd)/dashboards:/app/dashboards \
  -v $(pwd)/connections:/app/connections \
  --env-file .env \
  orrery/orrery dev

# Build static export
docker run \
  -v $(pwd):/app \
  --env-file .env \
  orrery/orrery build --output /app/dist
```

Published to Docker Hub and GitHub Container Registry (ghcr.io).

## User's Project Structure

After `create-orrery`, a user's project looks like:

```
my-dashboards/
  dashboards/
    example.board
  connections/
    database.yaml
  queries/                    # optional: external SQL files
  assets/                     # optional: logo, favicon
  theme.css                   # optional: custom theme
  orrery.config.yaml       # optional: project config
  .env                        # credentials (gitignored)
  .env.example                # template (committed)
  .github/
    workflows/
      validate.yml
      deploy.yml
  .gitignore
  package.json
```

The `package.json` is minimal:

```json
{
  "name": "my-dashboards",
  "private": true,
  "scripts": {
    "dev": "orrery dev",
    "build": "orrery build --output dist",
    "validate": "orrery validate"
  },
  "devDependencies": {
    "orrery": "^0.1.0"
  }
}
```

## Release Process

> **Current state (2026-08-30):** a `v*` tag triggers
> `.github/workflows/release.yml`, which now runs three jobs: GitHub Release,
> Docker build/push (single-platform `linux/amd64`), and **npm publish via OIDC
> trusted publishing** (no `NPM_TOKEN`; requires the trusted publisher to be
> registered on npmjs.com first).
>
> **The package is published as `@horizon-analytic/orrery`, not `orrery`.** The
> unscoped `orrery` name is held by an empty `0.0.0` placeholder published by
> user `wighawag` on 2023-11-23. npm's disputes policy does not transfer names
> for squatting — only for trademark claims — so the scoped name is the path
> that does not depend on trademark clearance landing first. The `bin` is still
> named `orrery`, so `npx orrery <cmd>` continues to work unchanged once the
> package is a dependency.
>
> Publishing under the Orrery name at all remains gated on trademark clearance
> (see `planning/rename-to-orrery.md`).
>
> Still outstanding: `create-orrery`, and `orrery create` is a stub
> (`src/cli/create.ts`) even though `templates/default/` ships in the tarball.

The intended full pipeline once npm publishing is set up:

1. Changeset-based versioning (`npx changeset` to add a changeset per change)
2. CI builds and tests on every push
3. Merge to main triggers changeset version bump
4. Tag + GitHub Release + npm publish + Docker build/push
5. Changelog auto-generated from changesets

## Version Strategy

- **0.x.y** — Pre-1.0 development. Breaking changes expected.
- **1.0.0** — When the DSL is stable and we're confident in the API
- Semver after 1.0: breaking DSL changes = major, new features = minor, fixes = patch
- A drop in the supported Node.js floor (`engines.node`) is also a **major**, even
  with no DSL change — it breaks installs for existing users. 2.0.0 was cut for
  exactly this reason: `>=18` -> `>=22`.

## License

MIT — maximum adoption, no barriers.

## Acceptance Criteria

- [x] `npm install @horizon-analytic/orrery` works and provides CLI commands
- [ ] `npm create orrery` scaffolds a working project
- [ ] Scaffolded project runs with `npx orrery dev` immediately
- [ ] Docker image builds and runs correctly
- [ ] `orrery` works as both local devDependency and global install
- [ ] Package size is reasonable (< 50MB installed)
- [ ] GitHub Actions workflows are included in the npm package
- [x] Release pipeline: version bump → tag → GitHub Release + npm publish + Docker push (changesets still not used)
- [ ] .gitignore in scaffolded projects excludes `.env`, `node_modules/`, `dist/`
- [ ] `create-orrery` offers to scaffold GitHub Actions workflow files (deferred from phase 10)
