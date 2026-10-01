[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$CasePath,

    [switch]$SetBaseline
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-FileCategory {
    param([string]$Extension)

    switch ($Extension.ToLowerInvariant()) {
        { $_ -in '.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.bmp', '.heic' } { return '位图/效果图' }
        { $_ -in '.svg', '.eps', '.ai', '.cdr', '.pdf' } { return '矢量/排版文件' }
        { $_ -in '.psd', '.psb', '.xcf' } { return '分层位图文件' }
        { $_ -in '.dwg', '.dxf', '.cad' } { return 'CAD/工程文件' }
        { $_ -in '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.md', '.csv' } { return '文案/说明文件' }
        { $_ -in '.ttf', '.otf', '.woff', '.woff2' } { return '字体文件' }
        { $_ -in '.zip', '.rar', '.7z', '.tar', '.gz' } { return '压缩包' }
        { $_ -in '.mp4', '.mov', '.avi', '.mkv', '.webm' } { return '视频/录屏' }
        default { return '其他/待识别' }
    }
}

$resolvedCasePath = (Resolve-Path -LiteralPath $CasePath).Path
$originalRoot = Join-Path $resolvedCasePath '00-原始资料只读'
$analysisRoot = Join-Path $resolvedCasePath '02-分析记录'

if (-not (Test-Path -LiteralPath $originalRoot -PathType Container)) {
    throw "未找到原始资料目录：$originalRoot"
}

if (-not (Test-Path -LiteralPath $analysisRoot -PathType Container)) {
    New-Item -ItemType Directory -Path $analysisRoot | Out-Null
}

$entries = @(
    Get-ChildItem -LiteralPath $originalRoot -File -Recurse -Force |
        Sort-Object FullName |
        ForEach-Object {
            $hash = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256
            [pscustomobject][ordered]@{
                relativePath = [IO.Path]::GetRelativePath($originalRoot, $_.FullName)
                extension = $_.Extension.ToLowerInvariant()
                category = Get-FileCategory -Extension $_.Extension
                sizeBytes = $_.Length
                modifiedAt = $_.LastWriteTimeUtc.ToString('o')
                sha256 = $hash.Hash.ToLowerInvariant()
                readOnly = ($_.Attributes -band [IO.FileAttributes]::ReadOnly) -ne 0
            }
        }
)

$payload = [ordered]@{
    schemaVersion = 1
    generatedAt = [DateTimeOffset]::UtcNow.ToString('o')
    fileCount = $entries.Count
    totalBytes = [long](($entries | Measure-Object -Property sizeBytes -Sum).Sum)
    files = $entries
}

$currentCsv = Join-Path $analysisRoot '原始文件清单-当前.csv'
$currentJson = Join-Path $analysisRoot '原始文件清单-当前.json'
$entries | Export-Csv -LiteralPath $currentCsv -NoTypeInformation -Encoding UTF8
$payload | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $currentJson -Encoding UTF8

if ($SetBaseline) {
    $baselineCsv = Join-Path $analysisRoot '原始文件清单-基线.csv'
    $baselineJson = Join-Path $analysisRoot '原始文件清单-基线.json'

    if ((Test-Path -LiteralPath $baselineCsv) -or (Test-Path -LiteralPath $baselineJson)) {
        throw '基线清单已经存在。为保护原始证据，脚本不会覆盖基线。'
    }

    Copy-Item -LiteralPath $currentCsv -Destination $baselineCsv
    Copy-Item -LiteralPath $currentJson -Destination $baselineJson
}

[pscustomobject]@{
    CasePath = $resolvedCasePath
    FileCount = $entries.Count
    TotalBytes = $payload.totalBytes
    CurrentInventory = $currentJson
    BaselineCreated = [bool]$SetBaseline
}

