#!/bin/sh
# Lanceur macOS / Linux. Toute la logique est dans build.mjs, qui tourne
# aussi bien sous Windows — voir build.cmd.
exec node "$(dirname "$0")/build.mjs" "$@"
