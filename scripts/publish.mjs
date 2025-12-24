#!/usr/bin/env zx
import "zx/globals"

// Parse command line arguments
const isDryRun = Boolean(argv["dry-run"] ?? argv.dryRun ?? false)
const IS_CI = process.env.CI === "true"

echo(chalk.blue("\n📦 Publishing outbox-event-bus packages...\n"))

if (isDryRun) {
  echo(chalk.yellow("🔍 DRY RUN MODE - No actual publishing will occur\n"))
}

// Check authentication
if (!IS_CI) {
  echo(chalk.cyan("Step 1: Checking authentication...\n"))
  try {
    const { stdout } = await $`npm whoami`
    echo(chalk.green(`✓ Logged in as: ${stdout.trim()}\n`))
  } catch (_error) {
    const hasNpmrc = await fs.pathExists(".npmrc")
    const npmrcContent = hasNpmrc ? await fs.readFile(".npmrc", "utf8") : ""

    if (process.env.NPM_TOKEN) {
      echo(chalk.green("✓ NPM_TOKEN is set\n"))
    } else if (hasNpmrc && npmrcContent.includes("_authToken")) {
      echo(chalk.green("✓ .npmrc file with auth token found\n"))
    } else {
      echo(chalk.red("✗ Authentication failed\n"))

      if (isDryRun) {
        echo(chalk.yellow("⚠ Skipping interactive login because this is a dry run.\n"))
        echo(chalk.bold("In a real run, you would need to authenticate using one of these methods:\n"))
        echo(`  1. ${chalk.cyan("Interactive Login")}: Run ${chalk.yellow("npm login")}`)
        echo(`  2. ${chalk.cyan("Environment Variable")}: Set ${chalk.yellow("export NPM_TOKEN=your_token_here")}\n`)
      } else {
        echo(chalk.bold("Choose an authentication method:\n"))
        echo(`  1. ${chalk.cyan("Interactive Login")} (persists across sessions)`)
        echo(`     Run: ${chalk.yellow("npm login")}\n`)
        echo(`  2. ${chalk.cyan("Environment Variable")} (for automation or temporary use)`)
        echo(`     Set: ${chalk.yellow("export NPM_TOKEN=your_token_here")}`)
        echo(`     Get token from: ${chalk.blue("https://www.npmjs.com/")} → Access Tokens\n`)

        const response = await question(chalk.bold("Would you like to run npm login now? (y/n): "))

        if (["y", "yes"].includes(response.toLowerCase())) {
          echo(chalk.cyan("\n🔐 Starting npm login...\n"))
          await $`npm login`

          // Verify login succeeded
          try {
            const { stdout } = await $`npm whoami`
            echo(chalk.green(`\n✓ Successfully logged in as: ${stdout.trim()}\n`))
          } catch (_error) {
            echo(chalk.red("\n✗ Login failed. Please try again.\n"))
            process.exit(1)
          }
        } else {
          echo(chalk.yellow("\n⚠ Skipping authentication. Please authenticate and try again.\n"))
          process.exit(1)
        }
      }
    }
  }
} else {
  echo(chalk.cyan("Step 1: Running in CI environment\n"))
  if (process.env.NODE_AUTH_TOKEN || process.env.NPM_TOKEN) {
    echo(chalk.green("✓ NPM authentication token is configured\n"))
  } else {
    echo(chalk.red("✗ No NPM authentication token found in CI\n"))
    process.exit(1)
  }
}

// Build
echo(chalk.cyan("Step 2: Building workspace...\n"))
await $`pnpm -r build`
echo(chalk.green("✓ Build completed\n"))

// Lint
echo(chalk.cyan("Step 3: Running linter...\n"))
await $`pnpm -r lint`
echo(chalk.green("✓ Linting passed\n"))

// Test
echo(chalk.cyan("Step 4: Running tests...\n"))
await $`pnpm -r test`
echo(chalk.green("✓ Tests passed\n"))

// E2E Test
echo(chalk.cyan("Step 5: Running e2e tests...\n"))
await $`pnpm -r test:e2e`
echo(chalk.green("✓ E2E Tests passed\n"))

// Publish
echo(chalk.cyan("Step 6: Publishing packages...\n"))
if (!isDryRun) {
  try {
    // Check if there are changesets to publish
    // changeset status or just running release and letting it handle it

    // Using changeset publish directly to avoid recursion
    // The package.json release script now points to this script for a safe, comprehensive release process.
    await $`changeset publish`

    echo(chalk.green("\n✓ Packages published successfully! 🎉\n"))
  } catch (error) {
    echo(chalk.red("\n✗ Publish command threw an error:"))
    echo(error)
    if (error.exitCode) {
      echo(chalk.red(`Exit code: ${error.exitCode}`))
    }
    process.exit(1)
  }
} else {
  echo(chalk.yellow("⊘ Skipped (dry-run)\n"))
  echo(chalk.blue("\nDry run completed. Run without --dry-run to actually publish.\n"))
}
