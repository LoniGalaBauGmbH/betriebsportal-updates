# Liest die Texte offener Fenster aus (z. B. eines Fehlerfensters, das auf dem Bildschirmfoto verdeckt ist).
# Läuft bewusst in der klassischen Windows-PowerShell (powershell.exe), weil nur dort die nötigen Bausteine vorhanden sind.
try {
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $all = [System.Windows.Automation.Condition]::TrueCondition
  foreach ($w in $root.FindAll([System.Windows.Automation.TreeScope]::Children, $all)) {
    $name = $w.Current.Name
    if ($name -match 'Error|Fehler|Programm-Update|Betriebsportal') {
      Write-Output "--- Fenster: $name ---"
      $seen = @{}
      foreach ($e in $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, $all)) {
        $t = $e.Current.Name
        if ($t -and -not $seen.ContainsKey($t) -and $t.Length -lt 4000) { $seen[$t] = 1; Write-Output "    $t" }
      }
    }
  }
} catch { Write-Output "Fenstertexte nicht lesbar: $($_.Exception.Message)" }
