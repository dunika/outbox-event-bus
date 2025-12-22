import sharedConfig from "@outbox-event-bus/config/vitest"
import { defineConfig, mergeConfig } from "vitest/config"

export default mergeConfig(sharedConfig, defineConfig({}))
