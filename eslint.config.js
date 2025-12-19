import js from "@eslint/js"
import importPlugin from "eslint-plugin-import"
import vitest from "eslint-plugin-vitest"
import tseslint from "typescript-eslint"

const testRules = {
  ...vitest.configs.recommended.rules,
  "@typescript-eslint/no-explicit-any": "off",
  "@typescript-eslint/no-unsafe-assignment": "off",
  "@typescript-eslint/no-unsafe-member-access": "off",
  "@typescript-eslint/no-unsafe-call": "off",
  "@typescript-eslint/no-unsafe-return": "off",
  "@typescript-eslint/no-unsafe-argument": "off",
  "@typescript-eslint/no-empty-function": "off",
  "@typescript-eslint/unbound-method": "off",
  "@typescript-eslint/require-await": "off",
  "@typescript-eslint/prefer-nullish-coalescing": "off",
  "no-console": "off",
}

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/out/**",
      "**/*.config.js",
      "**/*.config.mjs",
      "**/coverage/**",
      "**/*.tsbuildinfo",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["scripts/*.mjs"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      import: importPlugin,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
          fixStyle: "inline-type-imports",
        },
      ],
      "import/order": "off",
      "import/no-cycle": [
        "error",
        {
          maxDepth: 3,
          ignoreExternal: true,
        },
      ],
      "no-console": [
        "error",
        {
          allow: ["warn", "error"],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "SpreadElement > LogicalExpression[operator='&&'] > BinaryExpression[operator='!=='][right.name='undefined']",
          message:
            "Avoid conditional spread for optional properties. Use direct assignment instead: `prop: value` rather than `...(value !== undefined && { prop: value })`",
        },
      ],
      "func-style": ["error", "declaration", { allowArrowFunctions: true }],
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx"],
    plugins: {
      vitest,
    },
    rules: testRules,
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/explicit-function-return-type": "off",
    },
  },
  {
    files: ["scripts/*.mjs"],
    rules: {
      "no-undef": "off",
      "no-console": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
    },
  },
  {
    files: ["examples/**/*.ts", "examples/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/consistent-type-imports": "off",
    },
  }
)
