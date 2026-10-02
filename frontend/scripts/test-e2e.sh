#!/bin/bash
#
# Interactive E2E Test Runner
# Prompts for credentials if not set in environment
#

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     Playwright E2E Test Runner         ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Check for existing env vars
if [ -z "$PLAYWRIGHT_TEST_EMAIL" ]; then
    echo -e "${YELLOW}Enter test account email:${NC}"
    read -r PLAYWRIGHT_TEST_EMAIL
    export PLAYWRIGHT_TEST_EMAIL
fi

if [ -z "$PLAYWRIGHT_TEST_PASSWORD" ]; then
    echo -e "${YELLOW}Enter test account password:${NC}"
    read -rs PLAYWRIGHT_TEST_PASSWORD
    echo ""
    export PLAYWRIGHT_TEST_PASSWORD
fi

if [ -z "$PLAYWRIGHT_TEST_ORG_ID" ]; then
    echo -e "${YELLOW}Enter organization ID (or press Enter for 'test-org'):${NC}"
    read -r PLAYWRIGHT_TEST_ORG_ID
    if [ -z "$PLAYWRIGHT_TEST_ORG_ID" ]; then
        PLAYWRIGHT_TEST_ORG_ID="test-org"
    fi
    export PLAYWRIGHT_TEST_ORG_ID
fi

echo ""
echo -e "${GREEN}Configuration:${NC}"
echo -e "  Email:  ${PLAYWRIGHT_TEST_EMAIL}"
echo -e "  Org ID: ${PLAYWRIGHT_TEST_ORG_ID}"
echo ""

# Parse arguments
UI_MODE=false
DEBUG_MODE=false
SPECIFIC_TEST=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --ui)
            UI_MODE=true
            shift
            ;;
        --debug)
            DEBUG_MODE=true
            shift
            ;;
        --test)
            SPECIFIC_TEST="$2"
            shift 2
            ;;
        *)
            SPECIFIC_TEST="$1"
            shift
            ;;
    esac
done

# Build command
CMD="npx playwright test"

if [ "$UI_MODE" = true ]; then
    CMD="$CMD --ui"
elif [ "$DEBUG_MODE" = true ]; then
    CMD="$CMD --debug"
fi

if [ -n "$SPECIFIC_TEST" ]; then
    CMD="$CMD $SPECIFIC_TEST"
fi

echo -e "${BLUE}Running: ${CMD}${NC}"
echo ""

# Run tests
eval $CMD
