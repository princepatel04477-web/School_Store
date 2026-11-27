#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const pkgPath = path.resolve(__dirname, '../frontend/package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const type = process.argv[2] || 'patch';

let [major, minor, patch] = (pkg.version || '1.0.0').split('.').map(Number);

if (type === 'major') {
  major += 1;
  minor = 0;
  patch = 0;
} else if (type === 'minor') {
  minor += 1;
  patch = 0;
} else if (type === 'patch') {
  patch += 1;
} else if (/^\d+\.\d+\.\d+$/.test(type)) {
  [major, minor, patch] = type.split('.').map(Number);
} else {
  console.error(`Unknown bump type: ${type}. Use 'patch', 'minor', 'major', or 'X.Y.Z'.`);
  process.exit(1);
}

const versionName = `${major}.${minor}.${patch}`;
const versionCode = major * 10000 + minor * 100 + patch;

pkg.version = versionName;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

console.log(`Version updated: versionName=${versionName}, versionCode=${versionCode}`);
