$ErrorActionPreference = 'Stop'
$folder = Split-Path -Parent $MyInvocation.MyCommand.Path
$keyPath = Join-Path $folder 'trial-key'
$hostsPath = Join-Path $folder 'known_hosts'
$sshPath = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'

if (-not (Test-Path -LiteralPath $sshPath)) { throw 'Windows OpenSSH client is missing.' }
if (-not (Test-Path -LiteralPath $keyPath)) { throw 'Trial key is missing. Extract the whole package again.' }

# Windows OpenSSH requires the private key to be readable only by its owner.
& icacls.exe $keyPath /inheritance:r /grant:r "${env:USERNAME}:F" | Out-Null

$tunnel = $null
$port = $null
try {
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
    '-i', ('"' + $keyPath + '"'),
    '-o', 'BatchMode=yes',
    '-o', 'IdentitiesOnly=yes',
    '-o', ('UserKnownHostsFile="' + $hostsPath + '"'),
    '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ConnectTimeout=15',
    '-o', 'ServerAliveInterval=20',
    '-o', 'ServerAliveCountMax=3',
    '-N',
    '-L', "127.0.0.1:${port}:127.0.0.1:8080",
    'culturetrial1@47.99.189.172'
  ) -join ' '
  $tunnel = Start-Process -FilePath $sshPath -ArgumentList $arguments -WindowStyle Hidden -PassThru

  $ready = $false
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 500
    if ($tunnel.HasExited) { throw 'Connection failed. Contact the trial administrator.' }
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
      $client.Connect('127.0.0.1', $port)
      $ready = $true
      break
    } catch {
      # Wait for this SSH tunnel to start listening.
    } finally {
      $client.Dispose()
    }
  }
  if (-not $ready) { throw 'Connection timed out. Check the network and retry.' }
  $url = "http://127.0.0.1:$port/"
  Start-Process $url
  Write-Host "Trial website opened at $url. Enter the username and password sent separately by the administrator."
  Write-Host 'Keep this window open. Press Enter here to end the trial connection.'
  Read-Host | Out-Null
} finally {
  if ($tunnel -and -not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force }
}
