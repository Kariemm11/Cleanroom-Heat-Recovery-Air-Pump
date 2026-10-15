#include "comms.h"

#include <Preferences.h>
#include <ctype.h>
#include <stdlib.h>
#include <string.h>

#include "actuators.h"
#include "sensors.h"

namespace {

Preferences prefs;

struct LineBuf { char b[96]; int n = 0; };
LineBuf usbBuf, hmiBuf;

void lower(char* s) { for (; *s; s++) *s = (char)tolower((unsigned char)*s); }

// a JSON number, or null for NaN
void num(Print& o, const char* key, float v, int dec, bool comma = true) {
  o.print('"'); o.print(key); o.print("\":");
  if (isnan(v) || isinf(v)) o.print("null"); else o.print(v, dec);
  if (comma) o.print(',');
}

void reply(Print& o, const char* s) { o.print("# "); o.println(s); }

void help(Print& o) {
  reply(o, "SET flow|rh|dp|ef|cop|trip|reset <v> | SET coil|sup|room <C> | TCTL room|supply | MODE winter|summer | REC on|off | RUN on|off");
  reply(o, "MAN L1..L8 <0-100> | AUTO L1..L8 | RESET energy | ZERO | SCAN | GET | HELP");
}

void printSettings(Print& o, const rig::Controller& c) {
  o.printf("# flow %.2f m3/h (100 %% fresh air), RH %.0f %%, dP %.1f Pa, EF %.2f, COP base %.1f\n", c.sp.flow, c.sp.rh, c.sp.dp, c.sp.ef, c.sp.copBase);
  o.printf("# PT-102 trip %.0f /m3, reset %.0f /m3, DV-101 %s\n", c.sp.pxTrip, c.sp.pxReset, c.diverted ? "to outer HEPA" : "to air pump");
  o.printf("# winter coil %.1f sup %.1f room %.1f | summer coil %.1f sup %.1f room %.1f | control %s (supply SP now %.1f)\n", c.sp.winter.coil, c.sp.winter.sup, c.sp.winter.room,
           c.sp.summer.coil, c.sp.summer.sup, c.sp.summer.room, c.sp.roomCtl ? "room (L8 cascade)" : "fixed supply", c.k.supSP);
  o.printf("# season %s, recovery %s, run %s\n", c.season == rig::Season::Winter ? "winter" : "summer", c.recovery ? "on" : "off", c.on ? "on" : "off");
}

void handle(rig::Controller& c, char* line, Print& o) {
  lower(line);
  char* cmd = strtok(line, " \t\r\n");
  if (!cmd) return;
  char* a = strtok(nullptr, " \t\r\n");
  char* b = strtok(nullptr, " \t\r\n");
  bool save = false;
  if (!strcmp(cmd, "set") && a && b) {
    float v = atof(b);
    rig::SeasonSP& S = c.season == rig::Season::Winter ? c.sp.winter : c.sp.summer;
    if (!strcmp(a, "flow")) c.sp.flow = rig::clampf(v, 0.5f, 20);
    else if (!strcmp(a, "rh")) c.sp.rh = rig::clampf(v, 20, 70);
    else if (!strcmp(a, "dp")) c.sp.dp = rig::clampf(v, 0, 50);
    else if (!strcmp(a, "ef")) c.sp.ef = rig::clampf(v, 0, 1.5f);
    else if (!strcmp(a, "cop")) c.sp.copBase = rig::clampf(v, 1, 8);
    else if (!strcmp(a, "trip")) c.sp.pxTrip = rig::clampf(v, 10, 1e6f);
    else if (!strcmp(a, "reset")) c.sp.pxReset = rig::clampf(v, 1, 1e6f);
    else if (!strcmp(a, "coil")) S.coil = rig::clampf(v, 4, 40);
    else if (!strcmp(a, "sup")) S.sup = rig::clampf(v, 8, 40);
    else if (!strcmp(a, "room")) S.room = rig::clampf(v, 10, 35);
    else { reply(o, "unknown SET key"); return; }
    save = true;
  } else if (!strcmp(cmd, "mode") && a) {
    c.setSeason(!strcmp(a, "summer") ? rig::Season::Summer : rig::Season::Winter);
    reply(o, "season change: compressor stops, valve switches after 30 s");
    save = true;
  } else if (!strcmp(cmd, "tctl") && a) { c.sp.roomCtl = !strcmp(a, "room"); save = true; }
  else if (!strcmp(cmd, "rec") && a) { c.recovery = !strcmp(a, "on"); save = true; }
  else if (!strcmp(cmd, "run") && a) { c.on = !strcmp(a, "on"); }
  else if ((!strcmp(cmd, "man") || !strcmp(cmd, "auto")) && a && a[0] == 'l') {
    int i = atoi(a + 1) - 1;
    if (i < 0 || i > 7) { reply(o, "loop L1..L8"); return; }
    if (!strcmp(cmd, "auto")) c.L[i].man = false;
    else if (b) { c.L[i].man = true; c.L[i].mv = rig::clampf(atof(b) / 100.0f, 0, 1); }
  } else if (!strcmp(cmd, "reset") && a && !strcmp(a, "energy")) c.resetEnergy();
  else if (!strcmp(cmd, "zero")) {
    if (c.on) { reply(o, "RUN off first (all loads off), then ZERO"); return; }
    sensors::zeroCurrents(); reply(o, "current sensors zeroed");
  } else if (!strcmp(cmd, "scan")) sensors::scan(o);
  else if (!strcmp(cmd, "get")) printSettings(o, c);
  else if (!strcmp(cmd, "help")) help(o);
  else { reply(o, "unknown command (HELP)"); return; }
  if (save) comms::saveSettings(c);
  reply(o, "ok");
}

void pump(rig::Controller& c, Stream& in, LineBuf& lb, Print& o) {
  while (in.available()) {
    char ch = (char)in.read();
    if (ch == '\n' || ch == '\r') {
      if (lb.n) { lb.b[lb.n] = 0; handle(c, lb.b, o); lb.n = 0; }
    } else if (lb.n < (int)sizeof(lb.b) - 1 && (uint8_t)ch >= 0x20 && (uint8_t)ch < 0x7F) lb.b[lb.n++] = ch;
  }
}

// Nextion: <name>.txt="<value>" followed by three 0xFF bytes
void nx(Print& o, const char* name, float v, int dec, const char* unit = "") {
  o.print(name); o.print(".txt=\"");
  if (isnan(v)) o.print("--"); else o.print(v, dec);
  o.print(unit); o.print('"'); o.write(0xFF); o.write(0xFF); o.write(0xFF);
}
void nxs(Print& o, const char* name, const char* s) {
  o.print(name); o.print(".txt=\""); o.print(s); o.print('"'); o.write(0xFF); o.write(0xFF); o.write(0xFF);
}

}  // namespace

namespace comms {

void loadSettings(rig::Controller& c) {
  prefs.begin("rig", true);
  c.sp.flow = prefs.getFloat("flow", c.sp.flow);
  c.sp.pxTrip = prefs.getFloat("trip", c.sp.pxTrip);
  c.sp.pxReset = prefs.getFloat("reset", c.sp.pxReset);
  c.sp.rh = prefs.getFloat("rh", c.sp.rh);
  c.sp.dp = prefs.getFloat("dp", c.sp.dp);
  c.sp.ef = prefs.getFloat("ef", c.sp.ef);
  c.sp.copBase = prefs.getFloat("cop", c.sp.copBase);
  c.sp.winter.coil = prefs.getFloat("wcoil", c.sp.winter.coil);
  c.sp.winter.sup = prefs.getFloat("wsup", c.sp.winter.sup);
  c.sp.summer.coil = prefs.getFloat("scoil", c.sp.summer.coil);
  c.sp.summer.sup = prefs.getFloat("ssup", c.sp.summer.sup);
  c.sp.winter.room = prefs.getFloat("wroom", c.sp.winter.room);
  c.sp.summer.room = prefs.getFloat("sroom", c.sp.summer.room);
  c.sp.roomCtl = prefs.getBool("tctl", c.sp.roomCtl);
  rig::Season s = prefs.getUChar("season", 0) ? rig::Season::Summer : rig::Season::Winter;
  c.season = s; c.setSeason(s);
  c.recovery = prefs.getBool("rec", true);
  prefs.end();
}

void saveSettings(const rig::Controller& c) {
  prefs.begin("rig", false);
  prefs.putFloat("flow", c.sp.flow); prefs.putFloat("trip", c.sp.pxTrip); prefs.putFloat("reset", c.sp.pxReset); prefs.putFloat("rh", c.sp.rh); prefs.putFloat("dp", c.sp.dp);
  prefs.putFloat("ef", c.sp.ef); prefs.putFloat("cop", c.sp.copBase);
  prefs.putFloat("wcoil", c.sp.winter.coil); prefs.putFloat("wsup", c.sp.winter.sup);
  prefs.putFloat("scoil", c.sp.summer.coil); prefs.putFloat("ssup", c.sp.summer.sup);
  prefs.putFloat("wroom", c.sp.winter.room); prefs.putFloat("sroom", c.sp.summer.room); prefs.putBool("tctl", c.sp.roomCtl);
  prefs.putUChar("season", c.season == rig::Season::Summer ? 1 : 0);
  prefs.putBool("rec", c.recovery);
  prefs.end();
}

void poll(rig::Controller& c, Stream& usb, Stream& hmiPort) {
  pump(c, usb, usbBuf, usb);
  pump(c, hmiPort, hmiBuf, usb);           // replies to HMI commands go to the USB log
}

void telemetry(Print& o, const rig::Controller& c, const rig::Measured& m) {
  o.print("{\"t\":"); o.print(millis() / 1000.0f, 1);
  o.print(",\"mode\":\""); o.print(c.season == rig::Season::Winter ? "winter" : "summer");
  o.print("\",\"on\":"); o.print(c.on ? 1 : 0); o.print(",\"rec\":"); o.print(c.recovery ? 1 : 0);
  o.print(",\"s\":{");
  num(o, "TT101", m.TT101, 2); num(o, "MT101", m.MT101, 1); num(o, "FT101", m.FT101, 2); num(o, "TT109", m.TT109, 2);
  num(o, "TT103", m.TT103, 2); num(o, "TT104", m.TT104, 2); num(o, "TT105", m.TT105, 2); num(o, "MT105", m.MT105, 1);
  num(o, "FT102", m.FT102, 2); num(o, "PDT101", m.PDT101, 2); num(o, "PDT102", m.PDT102, 1); num(o, "TT106", m.TT106, 2);
  num(o, "MT106", m.MT106, 1); num(o, "TT107", m.TT107, 2); num(o, "TT108", m.TT108, 2); num(o, "CT101", m.CT101, 3);
  num(o, "CT102", m.CT102, 3); num(o, "CT103", m.CT103, 3); num(o, "VT101", m.VT101, 2); num(o, "PT101", m.PT101, 0);
  num(o, "PT101R5", m.PT101R5, 0); num(o, "PT101A", m.PT101A, 0); num(o, "PT101A5", m.PT101A5, 0); num(o, "PT102", m.PT102, 0);
  num(o, "RPM101", m.rpm101, 0); num(o, "RPM102", m.rpm102, 0); num(o, "RPM103", m.rpm103, 0, false);
  o.print("},\"u\":{");
  num(o, "fa", c.u.fa, 3); num(o, "sf", c.u.sf, 3); num(o, "ef", c.u.ef, 3); num(o, "dv", c.u.dv, 2); num(o, "cmp", c.u.cmp, 3);
  num(o, "rh", c.u.rh, 3); num(o, "hum", c.u.hum, 3); num(o, "eev", (float)c.u.eevSteps, 0); num(o, "rv", c.u.rvCooling ? 1.0f : 0.0f, 0, false);
  o.print("},\"k\":{");
  num(o, "ach", c.k.ach, 1); num(o, "f", c.k.f, 2); num(o, "P", c.k.P, 2); num(o, "Pb", c.k.Pbase, 2); num(o, "sav", c.k.saving, 3);
  num(o, "co2h", c.k.co2h, 2); num(o, "co2hb", c.k.co2hBase, 2); num(o, "coilSP", c.k.coilSP, 1);
  num(o, "Ewh", (float)c.Ewh, 2); num(o, "Ewhb", (float)c.EwhBase, 2); num(o, "co2g", (float)c.co2g, 2); num(o, "co2gb", (float)c.co2gBase, 2, false);
  o.print(",\"room\":\""); o.print(c.k.roomGrade); o.print("\",\"fill\":\""); o.print(c.k.fillGrade); o.print("\"}");
  o.print(",\"man\":[");
  for (int i = 0; i < 8; i++) { o.print(c.L[i].man ? 1 : 0); if (i < 7) o.print(','); }
  o.print("],\"al\":[");
  bool first = true;
  for (int i = 0; i < rig::ALARM_COUNT; i++) if (c.alarm[i]) { if (!first) o.print(','); o.print('"'); o.print(rig::ALARMS[i].id); o.print('"'); first = false; }
  o.println("]}");
}

void hmi(Print& o, const rig::Controller& c, const rig::Measured& m) {
  nx(o, "tt101", m.TT101, 1); nx(o, "mt101", m.MT101, 0); nx(o, "ft101", m.FT101, 2); nx(o, "tt109", m.TT109, 1);
  nx(o, "tt103", m.TT103, 1); nx(o, "tt104", m.TT104, 1); nx(o, "tt105", m.TT105, 1); nx(o, "mt105", m.MT105, 0);
  nx(o, "ft102", m.FT102, 2); nx(o, "pdt101", m.PDT101, 1); nx(o, "pdt102", m.PDT102, 0); nx(o, "tt106", m.TT106, 1);
  nx(o, "mt106", m.MT106, 0); nx(o, "tt107", m.TT107, 1); nx(o, "tt108", m.TT108, 1);
  nx(o, "pt101", m.PT101 / 1000.0f, 0, "k"); nx(o, "pt101a", m.PT101A, 0); nx(o, "pt102", m.PT102, 0);
  nx(o, "ach", c.k.ach, 1); nx(o, "pw", c.k.P, 1, " W"); nx(o, "pwb", c.k.Pbase, 1, " W"); nx(o, "sav", c.k.saving * 100, 0, " %");
  nx(o, "co2", c.k.co2h, 1, " g/h"); nx(o, "ewh", (float)c.Ewh, 1, " Wh");
  nxs(o, "mode", c.season == rig::Season::Winter ? (c.recovery ? "WINTER - RECOVERY ON" : "WINTER - BASELINE") : (c.recovery ? "SUMMER - RECOVERY ON" : "SUMMER - BASELINE"));
  nxs(o, "grade", c.k.roomGrade);
  nxs(o, "dv101", c.diverted ? "EXHAUST -> OUTER HEPA" : "EXHAUST -> AIR PUMP");
  char al[64] = "";
  for (int i = 0, n = 0; i < rig::ALARM_COUNT && n < 6; i++) if (c.alarm[i]) { strcat(al, rig::ALARMS[i].id); strcat(al, " "); n++; }
  nxs(o, "alarms", al[0] ? al : "no alarms");
}

}  // namespace comms
