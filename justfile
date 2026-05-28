set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

fmt:
    npm run check:write

check:
    npx tsc --noEmit
    npm run check

build:
    npm run build:web
