# One-off customisation of the generated Capacitor Android project (safe to re-run).
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Write-Utf8([string]$Path, [string]$Text) { [System.IO.File]::WriteAllText($Path, $Text, $utf8) }
$android = Join-Path $PSScriptRoot 'android'
$res = Join-Path $android 'app\src\main\res'

# 1. Brand colours (logo green #2F5D50, highlight #2E8B57)
Write-Utf8 (Join-Path $res 'values\colors.xml') @'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="colorPrimary">#2F5D50</color>
    <color name="colorPrimaryDark">#2F5D50</color>
    <color name="colorAccent">#2E8B57</color>
    <color name="splash_background">#2F5D50</color>
</resources>
'@
Write-Utf8 (Join-Path $res 'values\ic_launcher_background.xml') @'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#2F5D50</color>
</resources>
'@

# 2. Remove Capacitor's default splash PNGs (replaced by drawable\splash.xml)
Get-ChildItem $res -Recurse -Filter 'splash.png' | Remove-Item -Force

# 3. Remove the default foreground PNGs/XML (replaced by drawable\ic_launcher_s.xml)
Get-ChildItem $res -Recurse -Filter 'ic_launcher_foreground.png' | Remove-Item -Force
Remove-Item (Join-Path $res 'drawable-v24\ic_launcher_foreground.xml') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $res 'drawable\ic_launcher_background.xml') -Force -ErrorAction SilentlyContinue

# 4. Camera access for the photo-measurement features (getUserMedia + <input capture>)
$manifest = Join-Path $android 'app\src\main\AndroidManifest.xml'
$m = Get-Content $manifest -Raw
if ($m -notmatch 'android.permission.CAMERA') {
    $m = $m.Replace('<uses-permission android:name="android.permission.INTERNET" />',
        "<uses-permission android:name=`"android.permission.INTERNET`" />`r`n    <uses-permission android:name=`"android.permission.CAMERA`" />`r`n    <uses-feature android:name=`"android.hardware.camera`" android:required=`"false`" />")
    Write-Utf8 $manifest $m
}

# 5. Android 7.0+ (layer-list sizing in splash.xml needs API 23+)
$vars = Join-Path $android 'variables.gradle'
Write-Utf8 $vars (((Get-Content $vars -Raw) -replace '^\uFEFF', '') -replace 'minSdkVersion = \d+', 'minSdkVersion = 24')

# 6. Point Gradle at the local Android SDK (local.properties is git-ignored)
$sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
Set-Content -Encoding ascii (Join-Path $android 'local.properties') ("sdk.dir=" + $sdk.Replace('\', '\\'))

Write-Host "Android project customised."
