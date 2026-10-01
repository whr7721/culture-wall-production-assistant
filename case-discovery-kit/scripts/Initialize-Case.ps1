[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$')]
    [string]$CaseId,

    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$CaseName,

    [Parameter(Mandatory = $true)]
    [string]$SourcePath,

    [string]$CasesRoot = (Join-Path $PSScriptRoot '..\cases')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Copy-DirectoryContents {
    param(
        [Parameter(Mandatory = $true)][string]$From,
        [Parameter(Mandatory = $true)][string]$To
    )

    Get-ChildItem -LiteralPath $From -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $To -Recurse -Force
    }
}

function Expand-MarkdownTemplate {
    param(
        [Parameter(Mandatory = $true)][string]$TemplatePath,
        [Parameter(Mandatory = $true)][string]$DestinationPath
    )

    $content = Get-Content -LiteralPath $TemplatePath -Raw
    $content = $content.Replace('{{CASE_ID}}', $CaseId).Replace('{{CASE_NAME}}', $CaseName)
    Set-Content -LiteralPath $DestinationPath -Value $content -Encoding UTF8
}

$resolvedSource = (Resolve-Path -LiteralPath $SourcePath).Path
if (-not (Test-Path -LiteralPath $resolvedSource -PathType Container)) {
    throw "SourcePath 必须是一个目录：$resolvedSource"
}

$resolvedCasesRoot = [IO.Path]::GetFullPath($CasesRoot)
if (-not (Test-Path -LiteralPath $resolvedCasesRoot)) {
    New-Item -ItemType Directory -Path $resolvedCasesRoot | Out-Null
}
$resolvedCasesRoot = (Resolve-Path -LiteralPath $resolvedCasesRoot).Path

if ($resolvedSource.StartsWith($resolvedCasesRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'SourcePath 不能位于案例工作区内部，以免递归复制或混淆原件。'
}

$caseRoot = Join-Path $resolvedCasesRoot $CaseId
if (Test-Path -LiteralPath $caseRoot) {
    throw "案例目录已经存在，脚本不会覆盖：$caseRoot"
}

$originalRoot = Join-Path $caseRoot '00-原始资料只读'
$workingRoot = Join-Path $caseRoot '01-工作副本'
$analysisRoot = Join-Path $caseRoot '02-分析记录'
$validationRoot = Join-Path $caseRoot '03-技术验证'
$decisionRoot = Join-Path $caseRoot '04-范围决策'

@($caseRoot, $originalRoot, $workingRoot, $analysisRoot, $validationRoot, $decisionRoot) |
    ForEach-Object { New-Item -ItemType Directory -Path $_ | Out-Null }

try {
    Copy-DirectoryContents -From $resolvedSource -To $originalRoot
    Copy-DirectoryContents -From $resolvedSource -To $workingRoot

    Get-ChildItem -LiteralPath $originalRoot -File -Recurse -Force | ForEach-Object {
        $_.Attributes = $_.Attributes -bor [IO.FileAttributes]::ReadOnly
    }
    Get-ChildItem -LiteralPath $workingRoot -File -Recurse -Force | ForEach-Object {
        $_.Attributes = $_.Attributes -band (-bnot [IO.FileAttributes]::ReadOnly)
    }

    $templateRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\templates')).Path
    Expand-MarkdownTemplate -TemplatePath (Join-Path $templateRoot '02-访谈提纲.md') -DestinationPath (Join-Path $analysisRoot '访谈记录.md')
    Copy-Item -LiteralPath (Join-Path $templateRoot '03-人工流程记录.csv') -Destination (Join-Path $analysisRoot '人工流程记录.csv')
    Expand-MarkdownTemplate -TemplatePath (Join-Path $templateRoot '03b-当前人工流程图.md') -DestinationPath (Join-Path $analysisRoot '当前人工流程图.md')
    Copy-Item -LiteralPath (Join-Path $templateRoot '04-元素追踪矩阵.csv') -Destination (Join-Path $analysisRoot '元素追踪矩阵.csv')
    Expand-MarkdownTemplate -TemplatePath (Join-Path $templateRoot '05-效果图与生产文件差异报告.md') -DestinationPath (Join-Path $analysisRoot '效果图与生产文件差异报告.md')
    Expand-MarkdownTemplate -TemplatePath (Join-Path $templateRoot '06-技术验证记录.md') -DestinationPath (Join-Path $validationRoot '技术验证记录.md')
    Copy-Item -LiteralPath (Join-Path $templateRoot '07-候选功能评估.csv') -Destination (Join-Path $decisionRoot '候选功能评估.csv')
    Expand-MarkdownTemplate -TemplatePath (Join-Path $templateRoot '07b-候选功能评分规则.md') -DestinationPath (Join-Path $decisionRoot '候选功能评分规则.md')
    Expand-MarkdownTemplate -TemplatePath (Join-Path $templateRoot '08-MVP范围决策书.md') -DestinationPath (Join-Path $decisionRoot 'MVP范围决策书.md')

    $metadata = [ordered]@{
        schemaVersion = 1
        caseId = $CaseId
        caseName = $CaseName
        createdAt = [DateTimeOffset]::UtcNow.ToString('o')
        sourceDirectoryName = Split-Path -Leaf $resolvedSource
        status = '等待案例分析'
        conclusionsLocked = $false
    }
    $metadata | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $caseRoot 'case.json') -Encoding UTF8

    & (Join-Path $PSScriptRoot 'Update-CaseInventory.ps1') -CasePath $caseRoot -SetBaseline | Out-Null

    [pscustomobject]@{
        CaseId = $CaseId
        CaseName = $CaseName
        CasePath = $caseRoot
        OriginalFiles = @(Get-ChildItem -LiteralPath $originalRoot -File -Recurse -Force).Count
        Status = '初始化完成'
    }
}
catch {
    throw "案例初始化失败。已创建的目录保留供人工检查，未自动删除。原因：$($_.Exception.Message)"
}

