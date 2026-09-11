import { execFile } from "node:child_process";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

// Constant platform interop only. Paths are environment data, never PowerShell
// source; canonical response data is never sent to this process.
const aclScript = `
$ErrorActionPreference = 'Stop'
Import-Module -Name (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
$path = $env:BIZYEET_EXPORT_SECURITY_PATH
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$item = Get-Item -LiteralPath $path -Force
if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Unsafe export path' }
if ($env:BIZYEET_EXPORT_SECURITY_CREATE -eq 'directory') {
  if (-not $item.PSIsContainer) { throw 'Expected directory' }
  $acl = New-Object System.Security.AccessControl.DirectorySecurity
  $acl.SetOwner($sid)
  $acl.SetAccessRuleProtection($true, $false)
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')
  $acl.AddAccessRule($rule)
  Set-Acl -LiteralPath $path -AclObject $acl
}
if ($env:BIZYEET_EXPORT_SECURITY_CREATE -eq 'file') {
  if ($item.PSIsContainer -or $item.Length -ne 0) { throw 'Expected empty file' }
  $acl = New-Object System.Security.AccessControl.FileSecurity
  $acl.SetOwner($sid)
  $acl.SetAccessRuleProtection($true, $false)
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'Allow')
  $acl.AddAccessRule($rule)
  Set-Acl -LiteralPath $path -AclObject $acl
}
$actual = Get-Acl -LiteralPath $path
$rules = @($actual.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
if ($actual.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'Unexpected owner' }
if ($rules.Count -ne 1) { throw 'Unexpected access rules' }
if ($rules[0].IdentityReference.Value -ne $sid.Value -or $rules[0].AccessControlType -ne 'Allow' -or $rules[0].FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl) { throw 'Unexpected access' }
if (-not $actual.AreAccessRulesProtected) { throw 'Unprotected export path' }
[Console]::Out.Write('private')
`;

export type AclExecutor = (executable: string, args: readonly string[], environment: NodeJS.ProcessEnv) => Promise<string>;

const executeAcl: AclExecutor = async (executable, args, environment) =>
  (await execute(executable, args, { env: environment, timeout: 10_000, maxBuffer: 16_384, windowsHide: true })).stdout;

/** Establish or verify owner-only Windows ACLs before an export receives data. */
export const secureWindowsExport = async (path: string, mode: "directory" | "file" | "verify",
  executor: AclExecutor = executeAcl, environment: NodeJS.ProcessEnv = process.env): Promise<void> => {
  const systemRoot = environment.SystemRoot ?? environment.SYSTEMROOT;
  if (!systemRoot || !isAbsolute(systemRoot) || !isAbsolute(path)) throw new Error("Export ACL protection is unavailable.");
  const executable = join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  // Node inherits PS7 module paths without PowerShell's direct-child cleanup.
  // Let Windows PowerShell construct its own compatible module search paths.
  const childEnvironment = Object.fromEntries(Object.entries(environment).filter(([key]) => key.toUpperCase() !== "PSMODULEPATH"));
  const output = await executor(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(aclScript, "utf16le").toString("base64")], {
    ...childEnvironment, BIZYEET_EXPORT_SECURITY_PATH: path,
    BIZYEET_EXPORT_SECURITY_CREATE: mode,
  });
  if (output !== "private") throw new Error("Export ACL protection could not be verified.");
};
