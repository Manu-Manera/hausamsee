#!/usr/bin/env node
/**
 * Baut iOS/macOS .shortcut-Dateien und Android .curl-Dateien aus voice-catalog.js.
 */
const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { CATALOG } = require("./voice-catalog");

const ROOT = path.join(__dirname, "..");
const UNSIGNED = path.join(ROOT, "shortcuts", "unsigned");
const SIGNED = path.join(ROOT, "shortcuts", "signed");
const ANDROID = path.join(ROOT, "shortcuts", "android");

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
    action("is.workflow.actions.speaktext", `
        <key>WFText</key>
        ${tokenRef(idFetch, "Contents of URL")}
        <key>WFSpeakTextLanguage</key>
        <string>de-DE</string>`, idSpeak),
    action("is.workflow.actions.showresult", `
        <key>Text</key>
        ${tokenRef(idFetch, "Contents of URL")}`, idShow),
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
fs.mkdirSync(ANDROID, { recursive: true });

const catalogForWeb = {
  generatedAt: new Date().toISOString(),
  wakeHint: {
    ios: "Hey Siri, Gustav …",
    android: "Hey Google, Gustav …",
  },
  categories: [
    { id: "bewaesserung", label: "Bewässerung", emoji: "💧" },
    { id: "licht", label: "Licht", emoji: "💡" },
  ],
  items: CATALOG.map((item) => ({
    ...item,
    iosFile: `${item.file}.shortcut`,
    androidFile: `${item.file}.curl`,
  })),
};

for (const sc of CATALOG) {
  const xmlPath = path.join(UNSIGNED, `${sc.file}.plist`);
  const unsignedPath = path.join(UNSIGNED, `${sc.file}.shortcut`);
  const signedPath = path.join(SIGNED, `${sc.file}.shortcut`);
  const curlPath = path.join(ANDROID, `${sc.file}.curl`);

  fs.writeFileSync(xmlPath, buildPlist(sc), "utf8");
  run("plutil", ["-convert", "binary1", "-o", unsignedPath, xmlPath]);
  run("shortcuts", ["sign", "--mode", "anyone", "--input", unsignedPath, "--output", signedPath]);

  fs.writeFileSync(
    curlPath,
    `# ${sc.name}\n# Sprachbefehl: ${sc.phrase}\ncurl -sL '${sc.webhookUrl}'\n`,
    "utf8"
  );
  console.log(`✓ ${sc.name}`);
}

fs.writeFileSync(path.join(ROOT, "voice-catalog.json"), JSON.stringify(catalogForWeb, null, 2));

// Alte Dateien ohne gustav- Präfix entfernen
for (const old of fs.readdirSync(SIGNED)) {
  if (!old.startsWith("gustav-") && old.endsWith(".shortcut")) {
    fs.unlinkSync(path.join(SIGNED, old));
    console.log(`  entfernt: ${old}`);
  }
}

const zipPath = path.join(ANDROID, "gustav-android.zip");
try {
  run("zip", ["-j", zipPath, ...CATALOG.map((sc) => path.join(ANDROID, `${sc.file}.curl`))]);
  console.log(`✓ ZIP ${zipPath}`);
} catch (e) {
  console.warn("ZIP übersprungen:", e.message);
}

console.log(`\n${CATALOG.length} Kurzbefehle → shortcuts/signed/ + shortcuts/android/ + voice-catalog.json`);
