# Prüfung auf einem echten Windows-PC, bevor eine Version veröffentlicht wird.
#   1. Neuinstallation: Installer läuft still durch, das Programm startet, das Portal antwortet.
#   2. Programm-Update: Die vorherige Version wird installiert und aktualisiert sich selbst auf die neue
#      (Download, Prüfung, stille Installation, Neustart) – genau der Weg, den die Kunden gehen.
#   3. Benachrichtigung: Das kleine Nachrichten-Fenster erscheint (ab Programm 1.5.5).
# Ergebnis: Bildschirmfotos, Protokolle und ergebnis.txt im Ausgabeordner. Rückgabewert 1, wenn etwas nicht klappt.
param(
  [Parameter(Mandatory)][string]$NewSetup,    # Installer der zu prüfenden Version
  [Parameter(Mandatory)][string]$NewVersion,
  [string]$OldSetup = '',                     # Installer der vorherigen Version (leer = Schritt 2 entfällt)
  [Parameter(Mandatory)][string]$UpdateJson,  # update.json der zu prüfenden Version (signiert)
  [Parameter(Mandatory)][string]$Pkg,         # Portal-Paket der zu prüfenden Version
  [Parameter(Mandatory)][string]$Out
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$inst = Join-Path $env:LOCALAPPDATA 'Programs\Betriebsportal'
$exe = Join-Path $inst 'Betriebsportal.exe'
$data = Join-Path $env:USERPROFILE 'Betriebsportal-Daten'
$appdata = Join-Path $env:APPDATA 'Betriebsportal'
$results = New-Object System.Collections.Generic.List[string]
$failed = $false
function Note($ok, $text) { $line = $(if ($ok) { '[OK]     ' } else { '[FEHLER] ' }) + $text; Write-Host $line; $script:results.Add($line); if (-not $ok) { $script:failed = $true } }
function Portal-Version { try { return (Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/setup' -TimeoutSec 3).version } catch { return $null } }
function Wait-Until([scriptblock]$cond, [int]$seconds) { $end = (Get-Date).AddSeconds($seconds); while ((Get-Date) -lt $end) { if (& $cond) { return $true }; Start-Sleep -Seconds 2 }; return $false }
function Installed-Version { if (-not (Test-Path $exe)) { return $null }; $v = (Get-Item $exe).VersionInfo; return "$($v.FileMajorPart).$($v.FileMinorPart).$($v.FileBuildPart)" }
function Stop-App { Get-Process -Name 'Betriebsportal' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 4 }
function Shot($name) {
  try {
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
    $bmp.Save((Join-Path $Out "$name.png")); $g.Dispose(); $bmp.Dispose()
  } catch { Write-Host "Bildschirmfoto $name nicht möglich: $($_.Exception.Message)" }
}
function Save-Logs($tag) {
  foreach ($f in @((Join-Path $appdata 'programm.log'), (Join-Path $data 'portal.log'))) { if (Test-Path $f) { Copy-Item $f (Join-Path $Out ("$tag-" + (Split-Path $f -Leaf))) -Force } }
}

# Für alle Schritte: Rolle „Hauptrechner“ vorgeben, keine Sicherung, Updates nur vom lokalen Prüf-Server (nicht aus dem Internet)
$env:PORTAL_AUTOROLE = 'server'; $env:PORTAL_NO_BACKUP = '1'; $env:PORTAL_TEST_NOTIFY = '1'
$env:PORTAL_UPDATE_URL = 'http://127.0.0.1:8765'
$srv = Join-Path $env:RUNNER_TEMP 'pruef-server'; New-Item -ItemType Directory -Force -Path $srv | Out-Null
$setupName = Split-Path $NewSetup -Leaf
Copy-Item $NewSetup (Join-Path $srv $setupName) -Force
Copy-Item $Pkg $srv -Force
$m = Get-Content $UpdateJson -Raw | ConvertFrom-Json
if ($m.shell.version -ne $NewVersion) { throw "update.json gehört zu Programm $($m.shell.version), geprüft wird $NewVersion" }
if ((Get-FileHash $NewSetup -Algorithm SHA256).Hash.ToLower() -ne $m.shell.sha256) { throw 'Der Installer passt nicht zur signierten Prüfsumme' }
$m.shell.url = "http://127.0.0.1:8765/$setupName"            # Signatur gilt für Version + Prüfsumme, nicht für die Adresse
$m | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $srv 'update.json') -Encoding utf8
$server = Start-Process -FilePath 'python' -ArgumentList '-m', 'http.server', '8765', '--bind', '127.0.0.1' -WorkingDirectory $srv -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 3

try {
  # ---------- 1. Neuinstallation ----------
  Write-Host "`n=== 1. Neuinstallation von $NewVersion ==="
  $p = Start-Process -FilePath $NewSetup -ArgumentList '/S' -PassThru
  if (-not $p.WaitForExit(240000)) { throw 'Der Installer ist nach 4 Minuten nicht fertig' }
  Note ($p.ExitCode -eq 0) "Installer $NewVersion läuft still durch (Rückgabewert $($p.ExitCode))"
  Note ((Installed-Version) -eq $NewVersion) "Installiertes Programm trägt Version $(Installed-Version)"
  $up = Wait-Until { (Portal-Version) -eq $NewVersion } 120
  Note $up "Programm startet nach der Installation von selbst, Portal $NewVersion antwortet"
  Start-Sleep -Seconds 14; Shot '1-neuinstallation'; Save-Logs '1'
  $plog = Join-Path $appdata 'programm.log'
  if ((Test-Path $plog) -and (Select-String -Path $plog -Pattern 'Programm .* gestartet' -Quiet)) {
    $shown = Select-String -Path $plog -Pattern 'Nachrichten-Fenster gezeigt: sichtbar=true' -Quiet
    if ([version]$NewVersion -ge [version]'1.5.5') { Note $shown 'Nachrichten-Fenster wird unter Windows angezeigt (Test-Benachrichtigung)' }
  }

  # ---------- 2. Programm-Update von der vorherigen Version ----------
  if ($OldSetup) {
    $oldVersion = [regex]::Match((Split-Path $OldSetup -Leaf), '(\d+\.\d+\.\d+)').Value
    Write-Host "`n=== 2. Programm-Update $oldVersion -> $NewVersion ==="
    Stop-App
    Remove-Item $data, $appdata -Recurse -Force -ErrorAction SilentlyContinue      # frischer Stand, wie bei einem Kunden mit der alten Version
    $env:PORTAL_SHELL_AUTO = '1'; $env:PORTAL_SHELL_DELAY = '10000'                # Rückfrage „Jetzt aktualisieren“ automatisch bestätigen
    $p = Start-Process -FilePath $OldSetup -ArgumentList '/S' -PassThru
    if (-not $p.WaitForExit(240000)) { throw 'Der Installer der vorherigen Version ist nach 4 Minuten nicht fertig' }
    Note ((Installed-Version) -eq $oldVersion) "Vorherige Version $oldVersion installiert"
    $oldUp = Wait-Until { $null -ne (Portal-Version) } 120
    Note $oldUp "Vorherige Version läuft"
    Shot '2a-alte-version'
    $updated = Wait-Until { ((Installed-Version) -eq $NewVersion) -and ((Portal-Version) -eq $NewVersion) } 420
    Save-Logs '2'
    Note $updated "Programm hat sich selbst von $oldVersion auf $NewVersion aktualisiert und läuft wieder (installiert: $(Installed-Version), Portal: $(Portal-Version))"
    Start-Sleep -Seconds 10; Shot '2b-nach-programm-update'
    if (-not $updated) { foreach ($f in Get-ChildItem $Out -Filter '2-*.log') { Write-Host "`n--- $($f.Name) (Ende) ---"; Get-Content $f.FullName -Tail 25 } }
  }
} catch {
  Note $false "Prüfung abgebrochen: $($_.Exception.Message)"
} finally {
  Save-Logs 'ende'; Stop-App
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
  $results | Set-Content (Join-Path $Out 'ergebnis.txt') -Encoding utf8
}
Write-Host "`n=== Ergebnis ==="; $results | ForEach-Object { Write-Host $_ }
if ($failed) { Write-Host "`nPRÜFUNG NICHT BESTANDEN"; exit 1 } else { Write-Host "`nPRÜFUNG BESTANDEN"; exit 0 }
