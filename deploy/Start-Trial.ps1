$ErrorActionPreference = 'Stop'
$folder = Split-Path -Parent $MyInvocation.MyCommand.Path
$keyPath = Join-Path $folder 'trial-key'
$hostsPath = Join-Path $folder 'known_hosts'
$sshPath = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
$url = 'http://127.0.0.1:18080/'

if (-not (Test-Path -LiteralPath $sshPath)) { throw 'Windows OpenSSH client is missing.' }
if (-not (Test-Path -LiteralPath $keyPath)) { throw 'Trial key is missing. Extract the whole package again.' }

# Windows OpenSSH requires the private key to be readable only by its owner.
& icacls.exe $keyPath /inheritance:r /grant:r "${env:USERNAME}:F" | Out-Null

$arguments = @(
  '-i', ('"' + $keyPath + '"'),
  '-o', 'BatchMode=yes',
  '-o', 'IdentitiesOnly=yes',
  '-o', ('UserKnownHostsFile="' + $hostsPath + '"'),
  '-o', 'StrictHostKeyChecking=yes',
  '-o', 'ExitOnForwardFailure=yes',
  '-N',
  '-L', '127.0.0.1:18080:127.0.0.1:8080',
  'culturetrial1@47.99.189.172'
) -join ' '

$tunnel = Start-Process -FilePath $sshPath -ArgumentList $arguments -WindowStyle Hidden -PassThru
try {
  $ready = $false
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 500
    if ($tunnel.HasExited) { throw 'Connection failed. Contact the trial administrator.' }
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
      $client.Connect('127.0.0.1', 18080)
      $ready = $true
      break
    } catch {
      # Wait for the SSH tunnel.
    } finally {
      $client.Dispose()
    }
  }
  if (-not $ready) { throw 'Connection timed out. Check the network and retry.' }
  Start-Process $url
  Write-Host 'Trial website opened. Enter the username and password sent separately by the administrator.'
  Write-Host 'Keep this window open. Press Enter here to end the trial connection.'
  Read-Host | Out-Null
} finally {
  if (-not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force }
}
