<#
    Why does the screen saver do nothing?

        powershell -ExecutionPolicy Bypass -File .\check.ps1

    Read-only: it inspects the registry, the installed files, the two runtimes the
    clock needs, and any strays left in C:\Windows. Nothing is changed or deleted.
#>

$ErrorActionPreference = 'Continue'

function Ok($m)   { Write-Host "  [ ok ]  $m" -ForegroundColor Green }
function Bad($m)  { Write-Host "  [FAIL]  $m" -ForegroundColor Red }
function Warn($m) { Write-Host "  [warn]  $m" -ForegroundColor Yellow }
function Info($m) { Write-Host "  [ -- ]  $m" -ForegroundColor Gray }

$fixes = New-Object System.Collections.Generic.List[string]

Write-Host ''
Write-Host 'Perfboard clock - installation check' -ForegroundColor White
Write-Host '===================================' -ForegroundColor White

# ---------------------------------------------------------------- 1. registry
Write-Host ''
Write-Host '1. What Windows launches' -ForegroundColor White

$regPath = 'HKCU:\Control Panel\Desktop'
$scr = $null
$active = $null
try { $scr = (Get-ItemProperty -Path $regPath -Name 'SCRNSAVE.EXE' -ErrorAction Stop).'SCRNSAVE.EXE' } catch { }
try { $active = (Get-ItemProperty -Path $regPath -Name 'ScreenSaveActive' -ErrorAction Stop).'ScreenSaveActive' } catch { }

if ([string]::IsNullOrWhiteSpace($scr)) {
    Bad 'No screen saver is selected (HKCU\Control Panel\Desktop\SCRNSAVE.EXE is empty).'
    $fixes.Add('Select it in Settings > Personalisation > Lock screen > Screen saver, or run .\lazy_install.ps1.')
} else {
    $scr = $scr.Trim('"')
    Info "SCRNSAVE.EXE = $scr"
    if ($active -eq '0') {
        Bad 'The screen saver is switched off (ScreenSaveActive = 0).'
        $fixes.Add("Turn it on: Set-ItemProperty '$regPath' -Name ScreenSaveActive -Value '1'")
    }
    if (Test-Path -LiteralPath $scr) {
        Ok 'That file exists.'
    } else {
        Bad 'That file does not exist any more.'
        $fixes.Add('Re-run .\lazy_install.ps1 - it rewrites this registry value to a path that exists.')
    }
}

# ------------------------------------------------------- 2. the file's siblings
Write-Host ''
Write-Host '2. The installed files' -ForegroundColor White

$need = @(
    'PerfboardSaver.dll',
    'PerfboardSaver.deps.json',
    'PerfboardSaver.runtimeconfig.json',
    'Microsoft.Web.WebView2.Core.dll',
    'Microsoft.Web.WebView2.WinForms.dll',
    'WebView2Loader.dll'
)

if (-not [string]::IsNullOrWhiteSpace($scr) -and (Test-Path -LiteralPath $scr)) {
    $dir = Split-Path -Parent $scr
    $size = (Get-Item -LiteralPath $scr).Length
    Info ("Folder: {0}" -f $dir)
    Info ("Size:   {0:N0} bytes" -f $size)

    if ($size -ge 900KB) {
        Ok 'Single-file build: everything it needs is inside the .scr.'
    } else {
        # a .NET 8 apphost is ~150 KB and loads its DLLs from the same folder
        $need = @(
            'PerfboardSaver.dll',
            'PerfboardSaver.deps.json',
            'PerfboardSaver.runtimeconfig.json',
            'Microsoft.Web.WebView2.Core.dll',
            'Microsoft.Web.WebView2.WinForms.dll',
            'WebView2Loader.dll'
        )
        $missing = @($need | Where-Object { -not (Test-Path -LiteralPath (Join-Path $dir $_)) })
        if ($missing.Count -eq 0) {
            Ok 'Framework-dependent .NET 8 build, and all 6 support files are next to it.'
        } else {
            Bad ("This is a .NET 8 apphost and {0} of 6 support files are missing:" -f $missing.Count)
            foreach ($m in $missing) { Info "        $m" }
            Write-Host ''
            Write-Host '        PerfboardSaver.scr is a 152 KB launcher: it loads PerfboardSaver.dll' -ForegroundColor Yellow
            Write-Host '        and the WebView2 DLLs from its own folder, then exits - silently,' -ForegroundColor Yellow
            Write-Host '        because a WinExe has no console to complain to.' -ForegroundColor Yellow
            $fixes.Add('Rebuild as one file with .\build.ps1, which needs no siblings at all.')
        }
    }

    $machine = 0
    try {
        $b = [System.IO.File]::ReadAllBytes($scr)
        $lfanew = [BitConverter]::ToInt32($b, 0x3C)
        $machine = [BitConverter]::ToUInt16($b, $lfanew + 4)
    } catch { }
    if ($machine -eq 0x8664) { Ok 'The .scr is a 64-bit (x64) executable.' }
    elseif ($machine -eq 0x014C) { Warn 'The .scr is 32-bit - it will not load the x64 runtime.' }
    else { Info 'Could not read the executable header.' }
}

# -------------------------------------------------------------- 3. runtimes
Write-Host ''
Write-Host '3. The two runtimes it needs' -ForegroundColor White

$fx = 0
try { $fx = [int](Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -Name Release -ErrorAction Stop).Release } catch { }
if ($fx -ge 528040) { Ok ".NET Framework 4.8 present (release $fx) - the single-file build runs on it." }
elseif ($fx -ge 394254) { Warn "Only .NET Framework 4.6+ found (release $fx). The single-file build wants 4.8." ; $fixes.Add('Install .NET Framework 4.8 from https://dotnet.microsoft.com/download/dotnet-framework/net48') }
else { Info "No .NET Framework 4.x detected (release $fx) - fine if this is the .NET 8 build." }

$desktop = @()
foreach ($root in @('HKLM:\SOFTWARE\dotnet\Setup\InstalledVersions\x64\sharedfx\Microsoft.WindowsDesktop.App')) {
    try {
        $k = Get-Item -Path $root -ErrorAction Stop
        $desktop += @($k.GetValueNames() | Where-Object { $_ -match '^\d' })
    } catch { }
}
if (@($desktop | Where-Object { $_ -match '^8\.' }).Count -gt 0) { Info 'The .NET 8 Desktop Runtime is present (only needed by the .NET 8 build).' }

$wv2 = $null
foreach ($root in @('HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
                    'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
                    'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}')) {
    try {
        $pv = (Get-ItemProperty -Path $root -Name 'pv' -ErrorAction Stop).'pv'
        if ($pv -and $pv -ne '0.0.0.0') { $wv2 = $pv; break }
    } catch { }
}
if ($wv2) { Ok "WebView2 Runtime present: $wv2" }
else {
    Bad 'The WebView2 Runtime is NOT installed - the clock would show a message box, not silence.'
    $fixes.Add('Install it once from https://go.microsoft.com/fwlink/p/?LinkId=2124703')
}

# --------------------------------------------------- 4. did it ever start?
Write-Host ''
Write-Host '4. Evidence that the clock has run' -ForegroundColor White

$stateDir = Join-Path $env:LOCALAPPDATA 'PerfboardSaver'
$scene = Join-Path $stateDir 'scene.html'
$conf  = Join-Path $stateDir 'config.json'

if (Test-Path -LiteralPath $scene) {
    $fi = Get-Item -LiteralPath $scene
    Ok ("Extracted scene: {0:N0} KB, last written {1}" -f ($fi.Length / 1KB), $fi.LastWriteTime)
    Info 'The scene is only extracted when the clock window opens, so this means it did start.'
} else {
    Info "$scene does not exist - the clock has never opened its main window."
}
if (Test-Path -LiteralPath $conf) {
    Info "Settings: $(Get-Content -LiteralPath $conf -Raw)"
} else {
    Info 'No saved settings yet (config.json absent) - defaults are used.'
}

# ------------------------------------------------------ 5. strays in Windows
Write-Host ''
Write-Host '5. Leftovers in C:\Windows' -ForegroundColor White

$strays = @()
foreach ($d in @("$env:windir\System32", "$env:windir\SysWOW64")) {
    if (Test-Path -LiteralPath $d) {
        $strays += @(Get-ChildItem -LiteralPath $d -Filter 'PerfboardSaver*' -ErrorAction SilentlyContinue)
    }
}
if ($strays.Count -eq 0) {
    Ok 'Nothing of ours in System32 or SysWOW64.'
} else {
    Warn 'Found files of ours inside C:\Windows:'
    foreach ($s in $strays) { Info ("        " + $s.FullName) }
    Write-Host '        System32 is not an install location for a multi-file build, and it' -ForegroundColor Yellow
    Write-Host '        is not writable by the installer. Safe to delete these - the real' -ForegroundColor Yellow
    Write-Host '        install lives in %LOCALAPPDATA%\ScreenSavers\Perfboard.' -ForegroundColor Yellow
    $fixes.Add('Delete the strays: Remove-Item "$env:windir\System32\PerfboardSaver*" -Force (as admin)')
    $fixes.Add('Delete the strays: Remove-Item "$env:windir\SysWOW64\PerfboardSaver*" -Force (as admin)')
}

# ----------------------------------------------------------- 6. quarantine
Write-Host ''
Write-Host '6. Antivirus' -ForegroundColor White
$threats = @()
try { $threats = @(Get-MpThreatDetection -ErrorAction Stop | Where-Object { $_.Resources -match 'Perfboard' }) } catch { }
if ($threats.Count -gt 0) {
    Bad ("Defender is holding {0} detection(s) that mention Perfboard - the file may be gone." -f $threats.Count)
    $fixes.Add('Allow it: Defender Security Center > Virus & threat protection > Protection history > Restore, then add an exclusion for the install folder.')
} else {
    Ok 'No Defender detections mentioning Perfboard.'
}

# ---------------------------------------------------------------- summary
Write-Host ''
Write-Host '===================================' -ForegroundColor White
if ($fixes.Count -eq 0) {
    Write-Host 'Everything checks out. Try it directly:' -ForegroundColor Green
    Write-Host "    & '$scr' /s      (any key, click or mouse move exits)"
    Write-Host "    & '$scr' /c      (settings)"
} else {
    Write-Host 'What to do, in order:' -ForegroundColor Yellow
    $i = 1
    foreach ($f in $fixes) { Write-Host ("  {0}. {1}" -f $i, $f); $i++ }
}
Write-Host ''
