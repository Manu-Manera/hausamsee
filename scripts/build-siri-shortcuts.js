#!/usr/bin/env node
/**
 * Erzeugt signierte iOS-Kurzbefehle für Siri-Gartensteuerung.
 * Ausgabe: shortcuts/signed/*.shortcut (für GitHub Pages Download)
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const UNSIGNED = path.join(ROOT, "shortcuts", "unsigned");
const SIGNED = path.join(ROOT, "shortcuts", "signed");
const SECRET = "HausAmSee2026Garten";
const BASE = "https://siriwebhook-dcl7qtm3uq-ew.a.run.app";

const SHORTCUTS = [
  {
    file: "beet-giessen",
    name: "Beet gießen",
    color: 4282601983,
    webhookUrl: `${BASE}?action=garten&cmd=start&zoneId=wh2-wintergarten&minutes=20&secret=${SECRET}`,
  },
  {
    file: "salat-giessen",
    name: "Salat gießen",
    color: 4292093695,
    webhookUrl: `${BASE}?action=garten&cmd=start&zoneId=wh1-salat&minutes=20&secret=${SECRET}`,
  },
  {
    file: "tomaten-giessen",
    name: "Tomaten gießen",
    color: 4251333119,
    webhookUrl: `${BASE}?action=garten&cmd=start&zoneId=wh1-rechts&minutes=20&secret=${SECRET}`,
  },
  {
    file: "bewaesserung-stoppen",
    name: "Bewässerung stoppen",
    color: 463140863,
    webhookUrl: `${BASE}?action=garten&cmd=stop&secret=${SECRET}`,
  },
  {
    file: "licht-an",
    name: "Licht an",
    color: 2071128575,
    webhookUrl: `${BASE}?action=licht&cmd=an&secret=${SECRET}`,
  },
  {
    file: "licht-aus",
    name: "Licht aus",
    color: 2846468607,
    webhookUrl: `${BASE}?action=licht&cmd=aus&secret=${SECRET}`,
  },
];

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildPlist({ name, color, webhookUrl }) {
  const url = xmlEscape(webhookUrl);
  const wfName = xmlEscape(name);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>WFWorkflowActions</key>
  <array>
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.url</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>WFURLActionURL</key>
        <string>${url}</string>
      </dict>
    </dict>
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.downloadurl</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>WFHTTPMethod</key>
        <string>GET</string>
      </dict>
    </dict>
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.showresult</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>Text</key>
        <dict>
          <key>Value</key>
          <dict>
            <key>attachmentsByRange</key>
            <dict>
              <key>{0, 1}</key>
              <dict>
                <key>Type</key>
                <string>Variable</string>
                <key>VariableName</key>
                <string>Contents of URL</string>
              </dict>
            </dict>
            <key>string</key>
            <string>￼</string>
          </dict>
          <key>WFSerializationType</key>
          <string>WFTextTokenString</string>
        </dict>
      </dict>
    </dict>
  </array>
  <key>WFWorkflowClientVersion</key>
  <string>1113</string>
  <key>WFWorkflowMinimumClientVersion</key>
  <integer>900</integer>
  <key>WFWorkflowMinimumClientVersionString</key>
  <string>900</string>
  <key>WFWorkflowName</key>
  <string>${wfName}</string>
  <key>WFWorkflowIcon</key>
  <dict>
    <key>WFWorkflowIconStartColor</key>
    <integer>${color}</integer>
    <key>WFWorkflowIconGlyphNumber</key>
    <integer>59511</integer>
  </dict>
</dict>
</plist>
`;
}

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: "inherit" });
}

fs.mkdirSync(UNSIGNED, { recursive: true });
fs.mkdirSync(SIGNED, { recursive: true });

for (const sc of SHORTCUTS) {
  const xmlPath = path.join(UNSIGNED, `${sc.file}.plist`);
  const unsignedPath = path.join(UNSIGNED, `${sc.file}.shortcut`);
  const signedPath = path.join(SIGNED, `${sc.file}.shortcut`);

  fs.writeFileSync(xmlPath, buildPlist(sc), "utf8");
  run("plutil", ["-convert", "binary1", "-o", unsignedPath, xmlPath]);
  run("shortcuts", ["sign", "--mode", "anyone", "--input", unsignedPath, "--output", signedPath]);
  console.log(`✓ ${sc.name} → ${signedPath}`);
}

console.log("\nFertig. Dateien in shortcuts/signed/");
