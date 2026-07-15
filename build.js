#!/usr/bin/env node
// build.js: copies the extension files into dist/ and, with --zip,
// produces the store-ready rosterblur.zip. Copy and zip only; nothing
// gets bundled, minified, or rewritten.
//
// --firefox builds the Firefox variant instead: same files, but
// manifest.firefox.json ships as the manifest (event-page background,
// gecko id, options_ui), into dist-firefox/ and rosterblur-firefox.zip.

"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const FIREFOX = process.argv.includes("--firefox");

const SRC = __dirname;
const DIST = path.join(SRC, FIREFOX ? "dist-firefox" : "dist");
const ZIP_PATH = path.join(SRC, FIREFOX ? "rosterblur-firefox.zip" : "rosterblur.zip");

const FILES = [
  "shared.js",
  "shared.css",
  "background.js",
  "contentScript.js",
  "activate.js",
  "popup.html",
  "popup.js",
  "options.html",
  "options.js"
];

const DIRS = ["icons"];

function build() {
  if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true });
  fs.mkdirSync(DIST, { recursive: true });

  const manifestSrc = path.join(SRC, FIREFOX ? "manifest.firefox.json" : "manifest.json");
  if (!fs.existsSync(manifestSrc)) throw new Error("Missing file: " + path.basename(manifestSrc));
  fs.copyFileSync(manifestSrc, path.join(DIST, "manifest.json"));
  console.log("Copied: " + path.basename(manifestSrc) + " -> manifest.json");

  for (const file of FILES) {
    const src = path.join(SRC, file);
    if (!fs.existsSync(src)) throw new Error("Missing file: " + file);
    fs.copyFileSync(src, path.join(DIST, file));
    console.log("Copied: " + file);
  }
  for (const dir of DIRS) {
    fs.cpSync(path.join(SRC, dir), path.join(DIST, dir), { recursive: true });
    console.log("Copied: " + dir + "/");
  }
  console.log("Build complete in " + DIST);
}

function createZip() {
  if (fs.existsSync(ZIP_PATH)) fs.rmSync(ZIP_PATH);
  if (process.platform === "win32") {
    // PowerShell's Compress-Archive writes backslash separators, which
    // the Chrome Web Store rejects; .NET's ZipFile follows the spec.
    execFileSync("powershell", [
      "-NoProfile", "-Command",
      "Add-Type -AssemblyName System.IO.Compression.FileSystem; " +
      "[System.IO.Compression.ZipFile]::CreateFromDirectory(" +
      "'" + DIST.replace(/\\/g, "\\\\") + "','" + ZIP_PATH.replace(/\\/g, "\\\\") + "'," +
      "[System.IO.Compression.CompressionLevel]::Optimal,$false)"
    ], { stdio: "inherit" });
  } else {
    execFileSync("zip", ["-r", ZIP_PATH, "."], { cwd: DIST, stdio: "inherit" });
  }
  normalizeZipPathSeparators(ZIP_PATH);
  console.log("Zip created: " + ZIP_PATH);
}

// .NET on Windows can still emit backslash separators in entry names.
// Filename lengths do not change when swapping 0x5C for 0x2F, so the
// zip stays valid: patch every local header and central directory
// entry in place.
function normalizeZipPathSeparators(zipPath) {
  const buf = fs.readFileSync(zipPath);
  let touched = 0;

  const eocdSig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const eocdOffset = buf.lastIndexOf(eocdSig);
  if (eocdOffset < 0) return;

  const centralCount = buf.readUInt16LE(eocdOffset + 10);
  let offset = buf.readUInt32LE(eocdOffset + 16);

  for (let i = 0; i < centralCount; i++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) break;
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);

    for (let j = 0; j < nameLen; j++) {
      const at = offset + 46 + j;
      if (buf[at] === 0x5c) { buf[at] = 0x2f; touched++; }
    }
    if (buf.readUInt32LE(localOffset) === 0x04034b50) {
      const localNameLen = buf.readUInt16LE(localOffset + 26);
      for (let j = 0; j < localNameLen; j++) {
        const at = localOffset + 30 + j;
        if (buf[at] === 0x5c) { buf[at] = 0x2f; touched++; }
      }
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }

  if (touched) {
    fs.writeFileSync(zipPath, buf);
    console.log("Normalized " + touched + " path separator bytes in zip");
  }
}

build();
if (process.argv.includes("--zip")) createZip();
