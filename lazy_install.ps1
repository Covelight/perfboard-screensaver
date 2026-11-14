<#
    Installs the Perfboard clock screensaver and makes it the active one.

    Right-click -> "Run with PowerShell", or from a terminal:

        powershell -ExecutionPolicy Bypass -File .\lazy_install.ps1

    It is one file: release\PerfboardSaver.scr. It gets copied to
    %LOCALAPPDATA%\ScreenSavers\Perfboard\ (no admin rights, and nothing is put
    into C:\Windows), then HKCU\Control Panel\Desktop is pointed at it.

    Use -NoActivate to copy the file without changing the current screen saver.
#>
param([switch]$NoActivate)

$ErrorActionPreference = 'Stop'

$src = Join-Path $PSScriptRoot 'release\PerfboardSaver.scr'
if (-not (Test-Path $src)) {
    throw "release\PerfboardSaver.scr not found - run .\build.ps1 first"
}

$destDir = Join-Path $env:LOCALAPPDATA 'ScreenSavers\Perfboard'
New-Item -ItemType Directory -Force -Path $destDir | Out-Null

# a stale folder install would leave an old PerfboardSaver.dll lying around
Get-ChildItem -LiteralPath $destDir -Filter 'PerfboardSaver.*' -File -ErrorAction SilentlyContinue |
    Remove-Item -Force -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force (Join-Path $destDir 'runtimes') -ErrorAction SilentlyContinue

Copy-Item -Force $src $destDir
$dest = Join-Path $destDir 'PerfboardSaver.scr'
$size = (Get-Item $dest).Length
Write-Host ("Installed: {0}  ({1:N0} bytes)" -f $dest, $size)

# A lone .scr only works when everything is inside it. Say so if it is not.
if ($size -lt 500KB -and -not (Test-Path (Join-Path $destDir 'PerfboardSaver.dll'))) {
    Write-Host ''
    Write-Host 'WARNING: this .scr is a .NET 8 apphost and its DLLs are missing.' -ForegroundColor Yellow
    Write-Host '         Copy the whole release folder instead, or rebuild with .\build.ps1' -ForegroundColor Yellow
}

if (-not $NoActivate) {
    Set-ItemProperty 'HKCU:\Control Panel\Desktop' -Name 'SCRNSAVE.EXE' -Value $dest
    Set-ItemProperty 'HKCU:\Control Panel\Desktop' -Name 'ScreenSaveActive' -Value '1'
    Write-Host 'Set as the active screen saver (HKCU\Control Panel\Desktop).'
}

# .NET Framework 4.8 is in-box on Windows 10 1903+ / Windows 11; anything older
# needs it installed for this build to start.
$rel = 0
try { $rel = [int](Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -Name Release -ErrorAction Stop).Release } catch { }
if ($rel -lt 528040) {
    Write-Host ''
    Write-Host 'NOTE: .NET Framework 4.8 was not detected.' -ForegroundColor Yellow
    Write-Host '      Install it from https://dotnet.microsoft.com/download/dotnet-framework/net48' -ForegroundColor Yellow
}

# Windows caches the desktop settings; poke it so the dialog shows the new saver.
Add-Type -Namespace Win32 -Name Dll -MemberDefinition @'
[DllImport("user32.dll")] public static extern int SystemParametersInfo(int a, int b, System.IntPtr c, int d);
'@
[void][Win32.Dll]::SystemParametersInfo(0x0015, 0, [IntPtr]::Zero, 1)

Write-Host ''
Write-Host 'Next:'
Write-Host "  * settings dialog:  & '$dest' /c"
Write-Host "  * try it:           & '$dest' /s      (any key, click, or mouse move exits)"
Write-Host ''
Write-Host 'Settings live in: ' (Join-Path $env:LOCALAPPDATA 'PerfboardSaver\config.json')
Write-Host 'Nothing is downloaded and nothing is unpacked: the .scr is self-contained.'
