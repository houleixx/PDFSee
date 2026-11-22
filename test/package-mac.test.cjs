const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

function runPackaging(t, { accepted = false, profile = '' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pdfsee-package-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'bin'));
  copyFileSync(join(__dirname, '../scripts/package-mac.sh'), join(root, 'scripts/package-mac.sh'));
  copyFileSync(join(__dirname, '../package.json'), join(root, 'package.json'));
  const executable = (name, body) => writeFileSync(join(root, 'bin', name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  executable('uname', 'echo Darwin');
  executable('security', 'echo \'1) ABCDEF "Developer ID Application: Test (1234567890)"\'');
  executable('xcrun', `
[[ "$1 $2" == 'notarytool history' ]] || exit 99
echo credential-check >> "$PACKAGING_TRACE"
${profile ? '[[ "$3" == --keychain-profile && "$4" == test-profile ]] || exit 98' : '[[ "$3" == --apple-id && "$4" == test@example.invalid ]] || exit 98'}
${accepted ? 'exit 0' : 'echo "HTTP status code: 401. Invalid credentials." >&2; exit 1'}`);
  // Stop at the build boundary: this test must never sign or submit a real app.
  executable('npm', 'echo build >> "$PACKAGING_TRACE"; exit 42');
  const trace = join(root, 'trace');
  writeFileSync(trace, '');
  const result = spawnSync('bash', [join(root, 'scripts/package-mac.sh'), '--universal'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${join(root, 'bin')}:${process.env.PATH}`,
      PACKAGING_TRACE: trace,
      PDFSEE_MAC_TEAM_ID: '1234567890',
      PDFSEE_NOTARY_PROFILE: profile,
      APPLE_ID: 'test@example.invalid',
      APPLE_TEAM_ID: '1234567890',
      APPLE_APP_PASSWORD: 'test-password',
    },
  });
  return { ...result, trace: readFileSync(trace, 'utf8') };
}

test('invalid notarization credentials stop packaging before the build', { skip: process.platform === 'win32' }, t => {
  const result = runPackaging(t);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.trace, 'credential-check\n');
  assert.match(result.stderr, /APPLE_APP_PASSWORD/);
});

for (const profile of ['', 'test-profile']) {
  test(`valid notarization ${profile ? 'keychain profile' : 'environment credentials'} are checked before building`, { skip: process.platform === 'win32' }, t => {
    const result = runPackaging(t, { accepted: true, profile });
    assert.equal(result.status, 42, result.stderr);
    assert.equal(result.trace, 'credential-check\nbuild\n');
  });
}
