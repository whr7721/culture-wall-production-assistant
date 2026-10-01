[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$systemTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
$testRoot = Join-Path $systemTemp ('culture-wall-kit-smoke-' + [Guid]::NewGuid().ToString('N'))
$sourceRoot = Join-Path $testRoot 'source'
$casesRoot = Join-Path $testRoot 'cases'
$scriptRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\scripts')).Path

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw "断言失败：$Message" }
}

try {
    New-Item -ItemType Directory -Path $sourceRoot -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $sourceRoot 'production') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $sourceRoot 'effect.png') -Value 'fake-image-for-smoke-test' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $sourceRoot 'production\final.svg') -Value '<svg xmlns="http://www.w3.org/2000/svg"></svg>' -Encoding UTF8
    $sourceReadOnlyFile = Get-Item -LiteralPath (Join-Path $sourceRoot 'production\final.svg') -Force
    $sourceReadOnlyFile.Attributes = $sourceReadOnlyFile.Attributes -bor [IO.FileAttributes]::ReadOnly

    $initialized = & (Join-Path $scriptRoot 'Initialize-Case.ps1') `
        -CaseId 'smoke-case' `
        -CaseName '烟雾测试案例' `
        -SourcePath $sourceRoot `
        -CasesRoot $casesRoot

    $caseRoot = $initialized.CasePath
    Assert-True (Test-Path -LiteralPath (Join-Path $caseRoot '00-原始资料只读\effect.png')) '原始资料未复制'
    Assert-True (Test-Path -LiteralPath (Join-Path $caseRoot '01-工作副本\production\final.svg')) '工作副本未复制'
    Assert-True (Test-Path -LiteralPath (Join-Path $caseRoot '02-分析记录\原始文件清单-基线.json')) '未生成基线清单'
    Assert-True (Test-Path -LiteralPath (Join-Path $caseRoot '04-范围决策\MVP范围决策书.md')) '未生成决策模板'

    $original = Get-Item -LiteralPath (Join-Path $caseRoot '00-原始资料只读\effect.png') -Force
    $working = Get-Item -LiteralPath (Join-Path $caseRoot '01-工作副本\production\final.svg') -Force
    Assert-True (($original.Attributes -band [IO.FileAttributes]::ReadOnly) -ne 0) '原始副本不是只读'
    Assert-True (($working.Attributes -band [IO.FileAttributes]::ReadOnly) -eq 0) '工作副本不应是只读'

    & (Join-Path $scriptRoot 'Test-CaseIntegrity.ps1') -CasePath $caseRoot | Out-Null
    Assert-True ($LASTEXITCODE -eq 0) '新建案例的完整性检查未通过'

    Add-Content -LiteralPath (Join-Path $caseRoot '01-工作副本\effect.png') -Value 'work-copy-change'
    & (Join-Path $scriptRoot 'Test-CaseIntegrity.ps1') -CasePath $caseRoot | Out-Null
    Assert-True ($LASTEXITCODE -eq 0) '修改工作副本不应影响原件完整性'

    $tamperedOriginal = Get-Item -LiteralPath (Join-Path $caseRoot '00-原始资料只读\effect.png') -Force
    $tamperedOriginal.Attributes = $tamperedOriginal.Attributes -band (-bnot [IO.FileAttributes]::ReadOnly)
    Set-Content -LiteralPath $tamperedOriginal.FullName -Value 'tampered-original' -Encoding UTF8
    & (Get-Command pwsh).Source -NoProfile -File (Join-Path $scriptRoot 'Test-CaseIntegrity.ps1') -CasePath $caseRoot | Out-Null
    Assert-True ($LASTEXITCODE -eq 2) '原件被改变时应返回退出码 2'

    Write-Output 'PASS: 案例初始化、只读保护、清单生成、正常检查和篡改检测均正常。'
}
finally {
    $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot)
    $expectedPrefix = $systemTemp + [IO.Path]::DirectorySeparatorChar + 'culture-wall-kit-smoke-'
    if ($resolvedTestRoot.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedTestRoot)) {
        Get-ChildItem -LiteralPath $resolvedTestRoot -File -Recurse -Force | ForEach-Object {
            $_.Attributes = $_.Attributes -band (-bnot [IO.FileAttributes]::ReadOnly)
        }
        Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
    }
}

exit 0

