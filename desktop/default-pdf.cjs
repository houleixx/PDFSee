const { execFile } = require('node:child_process');
const { dirname, join, normalize } = require('node:path');
const { promisify } = require('node:util');

const run = promisify(execFile);

// Ask the Windows Shell for the effective handler, including any per-user choice.
const windowsQuery = `
$ErrorActionPreference = 'Stop'
Add-Type @'
using System.Runtime.InteropServices;
using System.Text;

public static class PdfAssociation {
    [DllImport("shlwapi.dll", CharSet = CharSet.Unicode)]
    private static extern int AssocQueryString(uint flags, uint kind, string association,
        string verb, StringBuilder value, ref uint length);

    public static string Executable() {
        const uint ASSOCSTR_EXECUTABLE = 2;
        uint length = 32768;
        var value = new StringBuilder((int)length);
        return AssocQueryString(0, ASSOCSTR_EXECUTABLE, ".pdf", "open", value, ref length) == 0
            ? value.ToString() : "";
    }
}
'@
[Console]::OutputEncoding = [Text.Encoding]::UTF8
[PdfAssociation]::Executable()
`;

async function macAssociation(command) {
  const helper = join(process.resourcesPath, 'pdfsee-default-pdf');
  const bundle = dirname(dirname(dirname(process.execPath)));
  const { stdout } = await run(helper, [command, bundle], command === 'get' ? { timeout: 5000 } : {});
  return stdout.trim() === 'default';
}

async function isDefaultPdfApp() {
  if (process.platform === 'darwin') return macAssociation('get');
  const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const { stdout } = await run(powershell, [
    '-NoProfile', '-NonInteractive', '-Command', windowsQuery
  ], { windowsHide: true, timeout: 10000 });
  return normalize(stdout.trim()).toLowerCase() === normalize(process.execPath).toLowerCase();
}

async function windowsDefaultSettings() {
  const settings = 'ms-settings:defaultapps';
  const reg = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
  for (const [hive, parameter] of [['HKCU', 'registeredAppUser'], ['HKLM', 'registeredAppMachine']]) {
    try {
      await run(reg, ['query', `${hive}\\Software\\RegisteredApplications`, '/v', 'PDFSee'],
        { windowsHide: true, timeout: 2000 });
      return `${settings}?${parameter}=PDFSee`;
    } catch {
      // Continue to the other install scope, then fall back to the general settings page.
    }
  }
  return settings;
}

module.exports = { isDefaultPdfApp, macAssociation, windowsDefaultSettings };
