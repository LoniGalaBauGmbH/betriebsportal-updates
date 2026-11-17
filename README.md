# Betriebsportal – Update-Kanal

Diese Ablage enthält nur die signierten Update-Pakete für das Betriebsportal. Jede Installation fragt regelmäßig die
neueste Veröffentlichung ab und installiert ausschließlich Pakete mit gültiger Signatur.

- `channel/` – das aktuelle Update (`update.json` + Paket). Ein Push in diesen Ordner erzeugt automatisch eine Veröffentlichung.
- **Releases** – alle veröffentlichten Versionen. Der Windows-Installer (`Betriebsportal-Setup-<Version>.exe`) wird der
  jeweiligen Veröffentlichung von Hand hinzugefügt (er ist für eine Git-Ablage zu groß).

Quellcode und Signaturschlüssel liegen nicht hier.
