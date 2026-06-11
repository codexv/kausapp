'use strict';

const { execSync } = require('node:child_process');
const path = require('node:path');

// Ad-hoc code-sign the macOS .app after packaging.
//
// Why: an entirely UNSIGNED app downloaded from the internet is flagged by
// macOS (especially Apple Silicon) as "damaged and can't be opened". An ad-hoc
// signature (`codesign -s -`) is a valid self-signature, so Gatekeeper instead
// shows the milder "unidentified developer" prompt (right-click → Open works).
//
// This is NOT Developer ID signing or notarization — those need a paid Apple
// Developer certificate and would remove the warning entirely. This hook just
// stops the "damaged" error so unsigned builds are testable/installable.
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  // When a real signing cert is provided (CI via CSC_LINK), let electron-builder
  // sign with that consistent identity instead — ad-hoc would override it and
  // break in-place auto-updates. Only ad-hoc sign local/unsigned builds.
  if (process.env.CSC_LINK) {
    console.log('[afterPack] CSC_LINK present — skipping ad-hoc (electron-builder will sign with the cert)');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  console.log(`[afterPack] ad-hoc signing ${appPath}`);
  try {
    execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });
  } catch (err) {
    console.error('[afterPack] ad-hoc signing failed:', err && err.message);
    throw err;
  }
};
