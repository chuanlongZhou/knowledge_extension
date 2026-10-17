import { spawnSync } from 'node:child_process';

// Read-only build verification. This script is never shipped with the application.
export function windowsSignatures(files) {
  if (process.platform !== 'win32') throw new Error('Signature verification requires Windows.');
  const command =
    '$ErrorActionPreference="Stop"; [Console]::InputEncoding=[Text.Encoding]::UTF8; [Console]::OutputEncoding=[Text.Encoding]::UTF8; $paths=[Console]::In.ReadToEnd() | ConvertFrom-Json; $items=@(foreach($file in $paths){ $sig=Get-AuthenticodeSignature -LiteralPath $file; [PSCustomObject]@{path=$file;status=[string]$sig.Status;subject=$sig.SignerCertificate.Subject;thumbprint=$sig.SignerCertificate.Thumbprint} }); ConvertTo-Json -InputObject $items -Compress';
  // Windows PowerShell must use its inbox modules, rather than inheriting a
  // PowerShell 7 module path from the development shell.
  const environment = { ...process.env };
  delete environment.PSModulePath;
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', command],
    {
      input: JSON.stringify(files),
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000,
      env: environment,
    },
  );
  if (result.error || result.status !== 0)
    throw new Error('Windows signature verification failed.');
  const signatures = JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
  if (!Array.isArray(signatures) || signatures.length !== files.length)
    throw new Error('Incomplete signature verification.');
  return signatures;
}
