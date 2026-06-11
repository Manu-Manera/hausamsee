#!/usr/bin/env node
/**
 * Signierte iOS/macOS-Kurzbefehle für Gartenbewässerung.
 * URL direkt in «Inhalte von URL abrufen» (WFURL) – sichtbar in der Shortcuts-App.
 */
const { execFileSync } = require("child_process");
const crypto = require("crypto");
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
];

function uuid() {
  return crypto.randomUUID().toUpperCase();
}

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function outputRef(outputUuid, outputName) {
  return `<dict>
        <key>Value</key>
        <dict>
          <key>OutputName</key>
          <string>${xmlEscape(outputName)}</string>
          <key>OutputUUID</key>
          <string>${outputUuid}</string>
          <key>Type</key>
          <string>ActionOutput</string>
        </dict>
        <key>WFSerializationType</key>
        <string>WFTextTokenAttachment</string>
      </dict>`;
}

function tokenRef(outputUuid, outputName) {
  return `<dict>
        <key>Value</key>
        <dict>
          <key>attachmentsByRange</key>
          <dict>
            <key>{0, 1}</key>
            <dict>
              <key>OutputName</key>
              <string>${xmlEscape(outputName)}</string>
              <key>OutputUUID</key>
              <string>${outputUuid}</string>
              <key>Type</key>
              <string>ActionOutput</string>
            </dict>
          </dict>
          <key>string</key>
          <string>￼</string>
        </dict>
        <key>WFSerializationType</key>
        <string>WFTextTokenString</string>
      </dict>`;
}

function action(identifier, paramsXml, id) {
  return `<dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>${identifier}</string>
      <key>WFWorkflowActionParameters</key>
      <dict>${paramsXml}</dict>
      <key>UUID</key>
      <string>${id}</string>
    </dict>`;
}

function buildPlist({ name, color, webhookUrl }) {
  const idFetch = uuid();
  const idDict = uuid();
  const idSpeech = uuid();
  const idSpeak = uuid();
  const idShow = uuid();
  const url = xmlEscape(webhookUrl);
  const wfName = xmlEscape(name);

  const actions = [
    action("is.workflow.actions.downloadurl", `
        <key>WFURL</key>
        <string>${url}</string>
        <key>WFHTTPMethod</key>
        <string>GET</string>`, idFetch),
    action("is.workflow.actions.getdictionaryfrominput", `
        <key>WFInput</key>
        ${outputRef(idFetch, "Contents of URL")}`, idDict),
    action("is.workflow.actions.getvalueforkey", `
        <key>WFGetDictionaryValueType</key>
        <string>Value</string>
        <key>WFDictionaryKey</key>
        <string>speech</string>
        <key>WFInput</key>
        ${outputRef(idDict, "Dictionary")}`, idSpeech),
    action("is.workflow.actions.speaktext", `
        <key>WFText</key>
        ${tokenRef(idSpeech, "Dictionary Value")}
        <key>WFSpeakTextLanguage</key>
        <string>de-DE</string>`, idSpeak),
    action("is.workflow.actions.showresult", `
        <key>Text</key>
        ${tokenRef(idSpeech, "Dictionary Value")}`, idShow),
  ].join("\n    ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>WFWorkflowActions</key>
  <array>
    ${actions}
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
  console.log(`✓ ${sc.name}`);
}

console.log("\nFertig: shortcuts/signed/");
