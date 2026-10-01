[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$CasePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$resolvedCasePath = (Resolve-Path -LiteralPath $CasePath).Path
$analysisRoot = Join-Path $resolvedCasePath '02-分析记录'
$baselinePath = Join-Path $analysisRoot '原始文件清单-基线.json'

if (-not (Test-Path -LiteralPath $baselinePath -PathType Leaf)) {
    throw "未找到基线清单：$baselinePath"
}

& (Join-Path $PSScriptRoot 'Update-CaseInventory.ps1') -CasePath $resolvedCasePath | Out-Null
$currentPath = Join-Path $analysisRoot '原始文件清单-当前.json'

$baseline = Get-Content -LiteralPath $baselinePath -Raw | ConvertFrom-Json
$current = Get-Content -LiteralPath $currentPath -Raw | ConvertFrom-Json

$baselineByPath = @{}
@($baseline.files) | ForEach-Object { $baselineByPath[$_.relativePath.ToLowerInvariant()] = $_ }
$currentByPath = @{}
@($current.files) | ForEach-Object { $currentByPath[$_.relativePath.ToLowerInvariant()] = $_ }

$missing = @()
$added = @()
$changed = @()

foreach ($key in $baselineByPath.Keys) {
    if (-not $currentByPath.ContainsKey($key)) {
        $missing += $baselineByPath[$key].relativePath
        continue
    }

    if ($baselineByPath[$key].sha256 -ne $currentByPath[$key].sha256) {
        $changed += $baselineByPath[$key].relativePath
    }
}

foreach ($key in $currentByPath.Keys) {
    if (-not $baselineByPath.ContainsKey($key)) {
        $added += $currentByPath[$key].relativePath
    }
}

$result = [pscustomobject]@{
    CasePath = $resolvedCasePath
    IsIntact = ($missing.Count -eq 0 -and $added.Count -eq 0 -and $changed.Count -eq 0)
    MissingFiles = $missing
    AddedFiles = $added
    ChangedFiles = $changed
}

$result | Format-List

if (-not $result.IsIntact) {
    exit 2
}

exit 0

