---
description: how to publish packages to npm
---

# Publishing Packages

This monorepo uses [Changesets](https://github.com/changesets/changesets) for version management and publishing.

## Automated Publishing (Recommended)

The repository is configured with GitHub Actions to automatically handle versioning and publishing:

1. **Make changes** and add a changeset using `pnpm changeset`
2. **Merge your PR** to the `main` branch
3. **Changesets bot creates a "Version Packages" PR** that:
   - Bumps versions in package.json files
   - Updates CHANGELOG.md files
   - Consumes all pending changesets
4. **Review and merge the "Version Packages" PR**
5. **Packages are automatically published to npm** after the PR is merged

## Manual Publishing (Local)

If you need to publish manually:

// turbo
1. Ensure all packages build successfully:
   ```bash
   pnpm build
   ```

// turbo
2. Version the packages (this consumes changesets and updates versions):
   ```bash
   pnpm version-packages
   ```

3. Review the changes to package.json and CHANGELOG.md files

4. Commit the version changes:
   ```bash
   git add .
   git commit -m "chore: version packages"
   git push
   ```

5. Publish to npm (requires NPM_TOKEN):
   ```bash
   pnpm release
   ```

## Prerequisites

### For Automated Publishing

- Add `NPM_TOKEN` secret to GitHub repository settings
  - Go to Settings → Secrets and variables → Actions
  - Add a new secret named `NPM_TOKEN`
  - Use an npm automation token (create at https://www.npmjs.com/settings/YOUR_USERNAME/tokens)

### For Manual Publishing

- Be logged in to npm: `npm login`
- Have publish access to the `@outbox-event-bus` organization

## Package Scope

All packages are published under the `@outbox-event-bus` scope:
- `outbox-event-bus` (core package)
- `@outbox-event-bus/redis-ioredis-outbox`
- `@outbox-event-bus/dynamodb-aws-sdk-outbox`
- `@outbox-event-bus/mongodb-outbox`
- `@outbox-event-bus/postgres-drizzle-outbox`
- `@outbox-event-bus/postgres-prisma-outbox`
- `@outbox-event-bus/sqlite-better-sqlite3-outbox`
- `@outbox-event-bus/sqs-publisher`
- `@outbox-event-bus/eventbridge-publisher`
- `@outbox-event-bus/kafka-publisher`
- `@outbox-event-bus/rabbitmq-publisher`
- `@outbox-event-bus/sns-publisher`
- `@outbox-event-bus/redis-streams-publisher`
