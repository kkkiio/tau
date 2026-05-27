set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

fmt:
    npm run check:write

check:
    npm run check
