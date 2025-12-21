# Contributing

This repository is a monorepo managed with [pnpm](https://pnpm.io/) workspaces.

## Setup

1.  **Install Node.js**: Ensure you have Node.js (version 18 or higher) installed.
    ```bash
    npm install -g pnpm
    ```
3.  **Install dependencies**:
    ```bash
    pnpm install
    ```

## Development Workflow

-   **Build**: `pnpm build` - Builds all packages.
-   **Test**: `pnpm test` - Runs unit tests.
-   **E2E Test**: `pnpm test:e2e` - Runs end-to-end tests (requires local DBs).
-   **Lint/Format**: `pnpm format` - Runs Biome to check and fix code style.

## Project Structure

-   `core`: The main event bus logic.
-   `adapters/*`: Database persistence adapters (Postgres, Mongo, DynamoDB, etc.).
-   `publishers/*`: Event transport publishers (SQS, SNS, Kafka, etc.).

## Pull Request Process

1.  **Branch**: Create a feature branch from `main`.
2.  **Code**: Implement your changes. Ensure tests pass and code is formatted.
3.  **Changeset**: If your changes affect published packages, you **must** create a changeset:
    ```bash
    pnpm changeset
    ```
    Follow the prompts to select packages and describe the change (major/minor/patch).
4.  **Commit**: Commit your changes and the generated `.changeset` file.
5.  **Submit**: Open a Pull Request against `main`.

## Reporting Issues

Use the [GitHub Issues](https://github.com/dunika/outbox-event-bus/issues) tracker to report bugs or suggest features.
