#!/bin/bash

# Get the root directory of the project
ROOT_DIR=$(pwd)

# Find all example directories
EXAMPLES_DIR="$ROOT_DIR/examples"
FAILED_EXAMPLES=()

echo "Running E2E tests for all examples..."

for example in "$EXAMPLES_DIR"/*; do
  if [ -d "$example" ] && [ -f "$example/package.json" ]; then
    EXAMPLE_NAME=$(basename "$example")
    
    # Check if test:e2e script exists in package.json
    if grep -q "\"test:e2e\":" "$example/package.json"; then
      echo ""
      echo "------------------------------------------------------------"
      echo "🚀 Running E2E tests for: $EXAMPLE_NAME"
      echo "------------------------------------------------------------"
      
      cd "$example"
      if npm run test:e2e; then
        echo "✅ Successfully ran E2E tests for $EXAMPLE_NAME"
      else
        echo "❌ Failed to run E2E tests for $EXAMPLE_NAME"
        FAILED_EXAMPLES+=("$EXAMPLE_NAME")
      fi
      cd "$ROOT_DIR"
    else
      echo "⏭️  Skipping $EXAMPLE_NAME (no test:e2e script found)"
    fi
  fi
done

echo ""
echo "------------------------------------------------------------"
if [ ${#FAILED_EXAMPLES[@]} -eq 0 ]; then
  echo "🎉 All E2E tests passed!"
  exit 0
else
  echo "🛑 The following examples failed E2E tests:"
  for failed in "${FAILED_EXAMPLES[@]}"; do
    echo "  - $failed"
  done
  exit 1
fi
