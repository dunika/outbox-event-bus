---
description: how to add a changeset when making changes
---

# Adding a Changeset

When you make changes to any package in this monorepo, you should add a changeset to document what changed and how it should be versioned.

## When to Add a Changeset

Add a changeset when you:
- Add a new feature
- Fix a bug
- Make a breaking change
- Update dependencies that affect package behavior

**You don't need a changeset for:**
- Documentation updates
- Internal refactoring that doesn't change the API
- Test changes
- CI/CD configuration changes

## How to Add a Changeset

// turbo
1. Run the changeset command:
   ```bash
   pnpm changeset
   ```

2. Select the packages that changed (use space to select, enter to confirm)

3. Choose the version bump type:
   - **patch**: Bug fixes, minor updates (0.0.X)
   - **minor**: New features, backwards-compatible (0.X.0)
   - **major**: Breaking changes (X.0.0)

4. Write a summary of the changes (this will appear in the changelog)

5. Commit the generated changeset file along with your code changes

## Example

```bash
$ pnpm changeset
🦋  Which packages would you like to include? 
  ◯ outbox-event-bus
  ◉ @outbox-event-bus/redis-outbox
  ◯ @outbox-event-bus/dynamodb-outbox

🦋  What kind of change is this for @outbox-event-bus/redis-outbox?
  ◯ patch
  ◉ minor
  ◯ major

🦋  Please enter a summary for this change:
  Added support for Redis Streams
```

This creates a markdown file in `.changeset/` that will be used during the next release.
