# Prüfung auf einem echten Windows-PC, bevor eine Version veröffentlicht wird.
#
# Volle Prüfung (neuer Installer):
#   1. Neuinstallation: Installer läuft still durch, das Programm startet, das Portal antwortet, Nachrichten-Fenster erscheint.
#   2. Programm-Update: Die vorherige Version wird installiert und aktualisiert sich selbst auf die neue
#      (Download, Prüfung, stille Installation, Neustart) – genau der Weg, den die Kunden gehen.
# Portal-Prüfung (-PortalOnly, reines Portal-Update ohne neuen Installer):
#   Das zuletzt veröffentlichte Programm wird installiert und holt sich das neue Portal-Paket.
#
# Ergebnis: Bildschirmfotos, Protokolle und ergebnis.txt im Ausgabeordner. Rückgabewert 1, wenn etwas nicht klappt.
param(
  [string]$NewSetup = '',                     # Installer der zu prüfenden Version (volle Prüfung)
  [string]$NewVersion = '',
  [string]$OldSetup = '',                     # Installer der vorherigen Version
  [Parameter(Mandatory)][string]$UpdateJson,  # update.json der zu prüfenden Version (signiert)
  [Parameter(Mandatory)][string]$Pkg,         # Portal-Paket der zu prüfenden Version
  [Parameter(Mandatory)][string]$Out,
  [switch]$PortalOnly
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
function Clean { Stop-App; Remove-Item $data, $appdata -Recurse -Force -ErrorAction SilentlyContinue }
function Run-Setup($file, $what) {
  # Nur auf den Installer selbst warten – nicht auf das Programm, das er am Ende startet
  $p = Start-Process -FilePath $file -ArgumentList '/S' -PassThru
  if (-not $p.WaitForExit(240000)) { throw "$what ist nach 4 Minuten nicht fertig" }
  return $p.ExitCode
}
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
function Show-Windows($tag) { # Texte offener Fenster (auch verdeckter Fehlerfenster) festhalten
  try { $t = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'fenstertexte.ps1'); $t | Set-Content (Join-Path $Out "$tag-fenstertexte.txt") -Encoding utf8; Write-Host "`n--- Offene Fenster ---"; $t | ForEach-Object { Write-Host $_ } } catch { Write-Host "Fenstertexte: $($_.Exception.Message)" }
}
function Show-Logs($tag) { foreach ($f in Get-ChildItem $Out -Filter "$tag-*.log") { Write-Host "`n--- $($f.Name) (Ende) ---"; Get-Content $f.FullName -Tail 30 } }

# Für alle Schritte: Rolle „Hauptrechner“ vorgeben, keine Sicherung, Updates nur vom lokalen Prüf-Server (nicht aus dem Internet)
$env:PORTAL_AUTOROLE = 'server'; $env:PORTAL_NO_BACKUP = '1'; $env:PORTAL_TEST_NOTIFY = '1'
$env:PORTAL_UPDATE_URL = 'http://127.0.0.1:8765'
$srv = Join-Path $env:RUNNER_TEMP 'pruef-server'; New-Item -ItemType Directory -Force -Path $srv | Out-Null
Copy-Item $Pkg $srv -Force
$m = Get-Content $UpdateJson -Raw | ConvertFrom-Json
if ((Get-FileHash $Pkg -Algorithm SHA256).Hash.ToLower() -ne $m.sha256) { throw 'Das Portal-Paket passt nicht zur signierten Prüfsumme' }
if (-not $PortalOnly) {
  $setupName = Split-Path $NewSetup -Leaf
  Copy-Item $NewSetup (Join-Path $srv $setupName) -Force
  if ($m.shell.version -ne $NewVersion) { throw "update.json gehört zu Programm $($m.shell.version), geprüft wird $NewVersion" }
  if ((Get-FileHash $NewSetup -Algorithm SHA256).Hash.ToLower() -ne $m.shell.sha256) { throw 'Der Installer passt nicht zur signierten Prüfsumme' }
  $m.shell.url = "http://127.0.0.1:8765/$setupName"          # Signatur gilt für Version + Prüfsumme, nicht für die Adresse
}
$m | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $srv 'update.json') -Encoding utf8
$server = Start-Process -FilePath 'node' -ArgumentList (Join-Path $PSScriptRoot 'pruef-server.js'), $srv, '8765' -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 3

try {
  if ($PortalOnly) {
    # ---------- Portal-Update auf dem zuletzt veröffentlichten Programm ----------
    $baseVersion = [regex]::Match((Split-Path $OldSetup -Leaf), '(\d+\.\d+\.\d+)').Value
    Write-Host "`n=== Portal-Update auf $($m.version) (Programm $baseVersion) ==="
    Clean
    $code = Run-Setup $OldSetup "Der Installer $baseVersion"
    Note (($code -eq 0) -and ((Installed-Version) -eq $baseVersion)) "Programm $baseVersion installiert"
    $up = Wait-Until { (Portal-Version) -eq $m.version } 240
    Save-Logs 'portal'
    Note $up "Programm holt das Portal-Update, Portal $($m.version) läuft (gemeldet: $(Portal-Version))"
    Start-Sleep -Seconds 12; Shot 'portal-update'
    if (-not $up) { Show-Logs 'portal' }
  } else {
    # ---------- 1. Neuinstallation ----------
    Write-Host "`n=== 1. Neuinstallation von $NewVersion ==="
    Clean
    $code = Run-Setup $NewSetup "Der Installer $NewVersion"
    Note ($code -eq 0) "Installer $NewVersion läuft still durch (Rückgabewert $code)"
    Note ((Installed-Version) -eq $NewVersion) "Installiertes Programm trägt Version $(Installed-Version)"
    $up = Wait-Until { (Portal-Version) -eq $NewVersion } 150
    Note $up "Programm startet nach der Installation von selbst, Portal $NewVersion antwortet"
    Start-Sleep -Seconds 11; Shot '1-neuinstallation'; Start-Sleep -Seconds 6; Save-Logs '1'   # Foto, solange das Nachrichten-Fenster (Test) zu sehen ist
    $plog = Join-Path $Out '1-programm.log'
    if ([version]$NewVersion -ge [version]'1.5.5') {
      $shown = (Test-Path $plog) -and (Select-String -Path $plog -Pattern 'Nachrichten-Fenster gezeigt: sichtbar=true' -Quiet)
      Note $shown 'Nachrichten-Fenster wird unter Windows angezeigt (Test-Benachrichtigung)'
      $crash = (Test-Path $plog) -and (Select-String -Path $plog -Pattern 'Unerwarteter Fehler' -Quiet)
      Note (-not $crash) 'Keine unerwarteten Programmfehler im Protokoll'
    }
    if (-not $up) { Show-Logs '1' }

    # ---------- 2. Programm-Update von der vorherigen Version ----------
    if ($OldSetup) {
      $oldVersion = [regex]::Match((Split-Path $OldSetup -Leaf), '(\d+\.\d+\.\d+)').Value
      Write-Host "`n=== 2. Programm-Update $oldVersion -> $NewVersion ==="
      Clean                                                                        # frischer Stand, wie bei einem Kunden mit der alten Version
      $env:PORTAL_SHELL_AUTO = '1'; $env:PORTAL_SHELL_DELAY = '10000'              # Rückfrage „Jetzt aktualisieren“ automatisch bestätigen
      $code = Run-Setup $OldSetup "Der Installer $oldVersion"
      Note ((Installed-Version) -eq $oldVersion) "Vorherige Version $oldVersion installiert"
      $oldUp = Wait-Until { $null -ne (Portal-Version) } 150
      Note $oldUp "Vorherige Version läuft"
      Start-Sleep -Seconds 14; Shot '2a-alte-version-laedt'
      $updated = Wait-Until { ((Installed-Version) -eq $NewVersion) -and ((Portal-Version) -eq $NewVersion) } 420
      Save-Logs '2'
      Note $updated "Programm hat sich selbst von $oldVersion auf $NewVersion aktualisiert und läuft wieder (installiert: $(Installed-Version), Portal: $(Portal-Version))"
      Start-Sleep -Seconds 14; Shot '2b-nach-programm-update'
      if (-not $updated) { Show-Logs '2'; Show-Windows '2' }
    }
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
