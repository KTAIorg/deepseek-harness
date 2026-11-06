#!/bin/sh
# Wrapper: run pnpm dsh from the repo from any cwd
REPO="/Users/arise0852/AiWorkSpace/KTAIorg/deepseek-harness"
cd "$REPO" || exit 1
exec pnpm dsh "$@"
