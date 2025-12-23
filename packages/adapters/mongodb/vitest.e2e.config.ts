import sharedConfig from "@outbox-event-bus/config/vitest.e2e"
import { defineConfig, mergeConfig } from "vitest/config"

export default mergeConfig(sharedConfig, defineConfig({}))
