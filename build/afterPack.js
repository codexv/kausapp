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

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  // Sign with our consistent self-signed identity when available (CI sets
  // KAUSAPP_SIGN_IDENTITY after importing the cert into the keychain). codesign
  // signs with an untrusted self-signed cert fine — and a STABLE identity across
  // builds is what lets macOS apply updates in place. Locally (no identity) we
  // ad-hoc sign ("-") just to avoid the "damaged" Gatekeeper error.
  const identity = process.env.KAUSAPP_SIGN_IDENTITY || '-';
  const label = identity === '-' ? 'ad-hoc' : `identity "${identity}"`;

  console.log(`[afterPack] codesign (${label}) ${appPath}`);
  try {
    execSync(`codesign --force --deep --sign "${identity}" "${appPath}"`, { stdio: 'inherit' });
  } catch (err) {
    console.error('[afterPack] codesign failed:', err && err.message);
    throw err;
  }
};
