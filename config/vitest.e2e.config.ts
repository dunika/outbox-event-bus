import { defineConfig, mergeConfig } from "vitest/config"
import sharedConfig from "./vitest.config.ts"

const baseConfig = { ...sharedConfig }

if (baseConfig.test) {
  baseConfig.test = { ...baseConfig.test }
  baseConfig.test.exclude = ["**/node_modules/**", "**/dist/**"]
  baseConfig.test.include = []
}

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ["**/*.e2e.ts"],
    },
  })
)
