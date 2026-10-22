param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$folder = Split-Path -Parent $MyInvocation.MyCommand.Path
$keyPath = Join-Path $folder 'trial-key'
$hostsPath = Join-Path $folder 'known_hosts'
$sshPath = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'

$diagnostic = Join-Path $folder 'connection-diagnostic.txt'
$errorLog = Join-Path $folder 'ssh-error.log'
$outputLog = Join-Path $folder 'ssh-output.log'
$tunnel = $null
$port = $null
$resultCode = 0
function Note([string]$text) {
  Add-Content -LiteralPath $diagnostic -Value $text -Encoding UTF8
  Write-Host $text
}
function WebsiteReady([int]$localPort) {
  $request = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$localPort/api/health")
  $request.Timeout = 3000
  $request.AllowAutoRedirect = $false
  $response = $null
  try { $response = $request.GetResponse() }
  catch [System.Net.WebException] { $response = $_.Exception.Response }
  if (-not $response) { return $false }
  try { return [int]$response.StatusCode -eq 401 -and $response.Headers['WWW-Authenticate'] -like '*Culture Wall Trial*' }
  finally { $response.Close() }
}
try {
  Set-Content -LiteralPath $diagnostic -Value "Culture Wall connection check v2026-10-22`r`nTime: $([DateTime]::Now.ToString('s'))" -Encoding UTF8
  Note "PowerShell: $($PSVersionTable.PSVersion)"
  if (-not (Test-Path -LiteralPath $sshPath)) { throw 'Windows OpenSSH client is missing. Enable OpenSSH Client in Windows Optional Features.' }
  if (-not (Test-Path -LiteralPath $keyPath) -or -not (Test-Path -LiteralPath $hostsPath)) { throw 'Package files are missing. Extract the entire ZIP first; do not run inside the ZIP.' }
  # SID-based ACLs do not depend on the user's display name or domain.
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  $acl = New-Object System.Security.AccessControl.FileSecurity
  $acl.SetOwner($identity.User)
  $acl.SetAccessRuleProtection($true, $false)
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity.User, 'FullControl', 'Allow')
  $acl.AddAccessRule($rule)
  Set-Acl -LiteralPath $keyPath -AclObject $acl
  Note 'Package key permission check: OK'
  $probe = New-Object System.Net.Sockets.TcpClient
  try {
    $pending = $probe.BeginConnect('47.99.189.172', 22, $null, $null)
    if (-not $pending.AsyncWaitHandle.WaitOne(8000)) { throw 'Cannot reach server SSH port 22. Try a phone hotspot; your network may block SSH.' }
    $probe.EndConnect($pending)
  } finally { $probe.Dispose() }
  Note 'Server TCP port 22: reachable'
  foreach ($candidate in 18080..18089) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
      $client.Connect('127.0.0.1', $candidate)
      continue # Already in use; never connect the browser to an unrelated listener.
    } catch {
      $port = $candidate
      break
    } finally {
      $client.Dispose()
    }
  }
  if (-not $port) { throw 'Local preview ports 18080-18089 are all busy. Close an old preview and retry.' }

  $arguments = @(
    '-F', 'NUL',
    '-v',
    '-i', 'trial-key',
    '-o', 'BatchMode=yes',
    '-o', 'IdentitiesOnly=yes',
    '-o', 'UserKnownHostsFile=known_hosts',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ConnectTimeout=15',
    '-o', 'ServerAliveInterval=20',
    '-o', 'ServerAliveCountMax=3',
    '-N',
    '-L', "127.0.0.1:${port}:127.0.0.1:8080",
    'culturetrial1@47.99.189.172'
  ) -join ' '
  # Relative filenames avoid SSH quoting/path issues in folders with spaces.
  # -F NUL isolates the connection from unrelated per-user SSH settings.
  $tunnel = Start-Process -FilePath $sshPath -WorkingDirectory $folder -ArgumentList $arguments -WindowStyle Hidden -RedirectStandardError $errorLog -RedirectStandardOutput $outputLog -PassThru

  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    Start-Sleep -Milliseconds 500
    $tunnel.Refresh()
    if ($tunnel.HasExited) { throw 'SSH exited. See the detailed reason below and in connection-diagnostic.txt.' }
    if (WebsiteReady $port) { $ready = $true; break }
  }
  if (-not $ready) { throw 'SSH started but the website did not respond. Send connection-diagnostic.txt to the administrator.' }
  $url = "http://127.0.0.1:$port/"
  Note "PASS: server website responded through this trial tunnel at $url"
  if (-not $CheckOnly) {
    Start-Process $url
    Write-Host 'Enter the website username and password sent separately. Keep this window open.'
    Write-Host 'Press Enter here to close the connection.'
    Read-Host | Out-Null
  }
} catch {
  $resultCode = 1
  Write-Host "Connection failed: $($_.Exception.Message)" -ForegroundColor Red
  try {
    Note "FAIL: $($_.Exception.Message)"
    if ($tunnel -and (Test-Path -LiteralPath $errorLog)) {
      Note '--- SSH details (no passwords or private key contents) ---'
      Get-Content -LiteralPath $errorLog -Tail 60 | ForEach-Object { Note $_ }
    }
    Write-Host 'Please send connection-diagnostic.txt from this folder to the administrator.'
  } catch { Write-Host 'Could not save diagnostics. Move the extracted folder somewhere writable and retry.' }
} finally {
  if ($tunnel) { $tunnel.Refresh(); if (-not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force } }
}
exit $resultCode
