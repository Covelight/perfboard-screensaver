<#
    Builds the screen saver locally, on your machine, from source.

        .\build.ps1                single file, ~1.9 MB, no prerequisites  (default)
        .\build.ps1 -Net8          .NET 8 folder, ~2.2 MB, needs the .NET 8
                                   Desktop Runtime installed
        .\build.ps1 -SelfContained .NET 8 single file, ~66 MB, no runtime needed
                                   but it is a self-extracting bundle, which is
                                   the shape Defender's Sabsik heuristics dislike

    The default targets .NET Framework 4.8, which ships inside Windows 10 1903+
    and Windows 11, so the result is one .scr with no runtime to install, no
    folder of DLLs, and nothing that unpacks itself at run time.

    Output: .\release\PerfboardSaver.scr
#>
param(
    [switch]$SelfContained,
    [switch]$Net8
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$out  = Join-Path $root 'release'
$tmp  = Join-Path $env:TEMP ('perfboard-build-' + [guid]::NewGuid().ToString('N').Substring(0, 8))

if (-not (Test-Path (Join-Path $root 'index.html'))) {
    Write-Host 'index.html missing - run: python3 build.py'
    exit 1
}

Remove-Item -Recurse -Force $out -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $out | Out-Null

function Finish([string]$exe, [string]$label) {
    $size = (Get-Item $exe).Length
    Move-Item -Force $exe (Join-Path $out 'PerfboardSaver.scr')
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    Write-Host ''
    Write-Host ('Built {0}\PerfboardSaver.scr  ({1:N0} bytes / {2:N2} MB) - {3}' -f $out, $size, ($size / 1MB), $label)
    Write-Host ('SHA256: ' + (Get-FileHash (Join-Path $out 'PerfboardSaver.scr') -Algorithm SHA256).Hash)
}

if ($SelfContained -or $Net8) {
    $proj = Join-Path $root 'host\PerfboardSaver\PerfboardSaver.csproj'
    if ($SelfContained) {
        Write-Host 'Publishing .NET 8, self-contained single file (~66 MB)...'
        dotnet publish $proj -c Release -r win-x64 --self-contained true `
            /p:PublishSingleFile=true /p:EnableCompressionInSingleFile=true -o $tmp
        Finish (Join-Path $tmp 'PerfboardSaver.exe') 'self-contained, self-extracting'
    } else {
        Write-Host 'Publishing .NET 8, framework-dependent folder...'
        dotnet publish $proj -c Release -r win-x64 --self-contained false `
            /p:PublishSingleFile=false -o $tmp
        Remove-Item (Join-Path $tmp 'Microsoft.Web.WebView2.Wpf.dll') -ErrorAction SilentlyContinue
        Move-Item -Force (Join-Path $tmp 'PerfboardSaver.exe') (Join-Path $tmp 'PerfboardSaver.scr')
        Copy-Item -Recurse -Force (Join-Path $tmp '*') $out
        Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
        $size = (Get-ChildItem $out -Recurse -File | Measure-Object Length -Sum).Sum
        Write-Host ''
        Write-Host ('Built {0}\  ({1:N2} MB, {2} files) - framework-dependent folder' -f $out, ($size / 1MB), (Get-ChildItem $out -Recurse -File).Count)
        Write-Host 'Needs the .NET 8 Desktop Runtime. Copy the whole folder, not just the .scr.'
    }
} else {
    Write-Host 'Building .NET Framework 4.8 single file...'
    $proj = Join-Path $root 'host\PerfboardSaver.Net48\PerfboardSaver.Net48.csproj'
    dotnet build $proj -c Release -o $tmp
    Finish (Join-Path $tmp 'PerfboardSaver.exe') 'single file, .NET Framework 4.8 (in-box)'
}
