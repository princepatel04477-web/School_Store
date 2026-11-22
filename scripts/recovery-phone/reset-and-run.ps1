# Empties the throwaway local SQLite database, reseeds it and runs the phone flows.
$w = (Resolve-Path "$PSScriptRoot\..\..").Path
$sim = $PSScriptRoot
$rt = 'C:\SchoolStore\runtime'
$env:PATH = "$rt\python;$rt\node;$env:PATH"
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:PYTHONPATH = "$w\.recovery-deps"
$env:HTTP_PROXY = 'http://127.0.0.1:9'
$env:HTTPS_PROXY = 'http://127.0.0.1:9'
$env:USE_SQLITE = '1'
$env:SIM_BACKEND = "$w\backend"
Push-Location "$w\backend"
python manage.py flush --noinput
python "$sim\seed.py" | Out-File -Encoding utf8 "$sim\seed.json"
Pop-Location
'{}' | Out-File -Encoding ascii "$sim\state.json"
$env:WORKTREE = $w
if (-not $env:CHROME_EXE) { $env:CHROME_EXE = "$env:LOCALAPPDATA\ms-playwright\chromium-1248\chrome-win64\chrome.exe" }
Push-Location $sim
node phone-run.mjs
Pop-Location
