#!/bin/sh
# Host syntax/type check of every firmware file against minimal Arduino-ESP32 stand-ins (test/stubs).
# Real builds use PlatformIO:  pio run
set -e
cd "$(dirname "$0")/.."
for f in src/*.cpp; do g++ -std=gnu++17 -fsyntax-only -Wall -Wextra -Wno-unused-parameter -Iinclude -Isrc -Itest/stubs "$f"; echo "ok  $f"; done
