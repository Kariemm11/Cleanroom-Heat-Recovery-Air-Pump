// Telemetry, commands and settings.
//   USB serial (115200): one JSON line per second (read by build-pack/09-live-monitor.html) + commands.
//   HMI-101 UART1 (115200): Nextion-style component updates every 500 ms; the HMI sends the same
//   text commands back (e.g. a "Set" button runs: prints "SET flow 6.0\r\n",0).
// Commands (one per line, case-insensitive):
//   SET flow|oa|rh|dp|ef|cop <value>      SET mix|coil|sup <°C>   (active season)
//   MODE winter|summer    REC on|off    RUN on|off    MAN L1..L7 <0-100>    AUTO L1..L7
//   RESET energy    ZERO (current-sensor zero, outputs off)    SCAN    GET    HELP
#pragma once
#include <Arduino.h>

#include "control.h"

namespace comms {
void loadSettings(rig::Controller& c);
void saveSettings(const rig::Controller& c);
void poll(rig::Controller& c, Stream& usb, Stream& hmi);
void telemetry(Print& out, const rig::Controller& c, const rig::Measured& m);
void hmi(Print& out, const rig::Controller& c, const rig::Measured& m);
}  // namespace comms
