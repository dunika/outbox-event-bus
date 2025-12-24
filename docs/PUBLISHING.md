# Publishing Guide

## Quick Start

```bash
# Local
pnpm publish:interactive --dry-run  # test first
pnpm publish:interactive            # publish (handles auth automatically)

# CI/CD
# Automated via "Version Packages" PR and GitHub Actions
```

## Prerequisites

- Access to `@outbox-event-bus` npm organization
- `NPM_TOKEN` configured (for CI) or logged in locally

> The publish script automatically runs build, lint, and test across the workspace.

## Versioning

Before publishing, you need to version your packages using Changesets.

1. **Create a Changeset**
   Run this command and follow the prompts to select packages and bump types (patch, minor, major).
   ```bash
   pnpm changeset
   ```

2. **Apply Versions**
   This consumes the changesets and updates `package.json` versions and `CHANGELOG.md` files.
   ```bash
   pnpm version-packages
   ```

## Local Publishing

**Step 1: Test with Dry-run**

```bash
pnpm publish:interactive --dry-run
```

This will:
- ✓ Check authentication
- ✓ Show what would be built, linted, tested, and published
- ✗ Not actually publish to npm

**Step 2: Publish**

```bash
pnpm publish:interactive
```

The script will:
1. **Check authentication** - If not logged in, it will prompt you to choose:
   - **Interactive Login**: Runs `npm login`
   - **Environment Variable**: Checks `NPM_TOKEN`
2. **Build** all packages (`pnpm -r build`)
3. **Lint** all packages (`pnpm -r lint`)
4. **Test** all packages (`pnpm -r test`)
5. **E2E Test** all packages (`pnpm -r test:e2e`)
6. **Publish** using Changesets (`pnpm release`)

**Two-Factor Authentication (2FA)**

Since this project uses Changesets for publishing, the underlying `npm publish` command handles 2FA. You will be prompted for your OTP code if required during the `pnpm release` step.

> [!NOTE]
> If you don't have 2FA enabled yet, run `npm profile enable-2fa auth-and-writes` to set it up.

## CI/CD Setup

The project is configured to use **npm Trusted Publishing** for secure, passwordless publishing via GitHub Actions.

> **Important**: You must publish the packages **manually** at least once before you can configure Trusted Publishing. Use the [Local Publishing](#local-publishing) steps below for the initial release.

1. **Configure Trusted Publishing on npm**:
   - Log in to [npmjs.com](https://www.npmjs.com/)
   - Navigate to your package settings (e.g., `https://www.npmjs.com/package/@outbox-event-bus/core/access`)
   - Go to **Publishing Access**
   - Click **Connect GitHub**
   - Select this repository: `dunika/outbox-event-bus`
   - Workflow filename: `release.yml`
   - Environment: Leave empty (unless you configured one in GitHub)
   - *Repeat this for each package in the monorepo.*

2. **Check Permissions**:
   - Go to **Settings** > **Actions** > **General**
   - Ensure **Workflow permissions** is set to **Read and write permissions**
     - This is required for the Changesets action to push version commits and tags back to the repo.

> **Note**: The `release.yml` workflow is already configured with `permissions: id-token: write` to support Trusted Publishing.

## CI/CD Publishing

Publishing is automated via GitHub Actions and Changesets.

**Step 1: Create Changeset**

When making changes, run:
```bash
pnpm changeset
```
Follow the prompts to select packages and bump types (patch/minor/major).

**Step 2: Push Changes**

Commit the `package.json` updates and the new changeset file.

**Step 3: Version Packages (Automated)**

When changes are merged to `main`, the "Version Packages" PR will be automatically created/updated by the Changesets bot.
- This PR consumes changesets and updates versions/changelogs.

**Step 4: Release (Automated)**

Merging the "Version Packages" PR triggers the release workflow which runs `pnpm release` to publish the updated packages to npm.

## Troubleshooting

### Authentication Failed

**Local:**
- Check: `npm whoami`
- Login: `npm login`

**CI:**
- Set `NPM_TOKEN` secret in: Repository → Settings → Secrets and variables → Actions

### Build/Lint/Test Failures

Run the workspace commands manually to debug:
```bash
pnpm -r build
pnpm -r lint
pnpm -r test
```

### Version Already Published

- Check currently published versions on npm under the `@outbox-event-bus` scope.
- Ensure you have a new changeset defined if you intend to publish a new version.

## Scripts Reference

| Script | Description |
|--------|-------------|
| `pnpm publish:interactive` | Full publish pipeline wrapper (auth → build → lint → test → publish) |
| `pnpm release` | Alias for `pnpm publish:interactive` |
| `pnpm changeset` | Create a new changeset |
| `pnpm version-packages` | Consume changesets and update versions |

## Checklist

- [ ] Changeset created (`pnpm changeset`)
- [ ] Changes merged to `main`
- [ ] "Version Packages" PR reviewed and merged
- [ ] Release workflow succeeded
