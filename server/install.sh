#!/usr/bin/env bash
# Betriebsportal auf einem eigenen Server einrichten (Ubuntu 24.04 oder neuer, als root).
#
#   bash install.sh portal.meine-firma.de
#
# Richtet ein: das Portal als Dienst (startet von selbst, aktualisiert sich selbst), verschlüsselten Zugang (https)
# über Caddy mit automatischem Zertifikat, Firewall und automatische Sicherheits-Updates des Systems.
# Das Skript kann gefahrlos erneut ausgeführt werden; vorhandene Daten bleiben erhalten.
set -euo pipefail

DOMAIN="${1:-}"
CHANNEL="${PORTAL_CHANNEL:-https://github.com/LoniGalaBauGmbH/betriebsportal-updates/releases/latest/download}"
BASE=/opt/betriebsportal
VAR=/var/lib/betriebsportal
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
die() { printf '\n\033[31mFEHLER: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "Bitte als root ausführen."
[[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] || die "Bitte die Adresse angeben, z. B.: bash install.sh portal.meine-firma.de"
case "$(uname -m)" in x86_64) ARCH=x64 ;; aarch64) ARCH=arm64 ;; *) die "Nicht unterstützter Prozessor: $(uname -m)" ;; esac

say "1/6 System vorbereiten"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q curl ca-certificates xz-utils ufw unattended-upgrades caddy
id portal >/dev/null 2>&1 || useradd --system --home-dir "$VAR" --shell /usr/sbin/nologin portal
mkdir -p "$BASE/app" "$VAR/daten" "$VAR/sicherung"

say "2/6 Node.js installieren"
cat > "$BASE/node-aktualisieren.sh" <<'NODE'
#!/usr/bin/env bash
# Installiert die neueste Node.js-Version der Reihe 22 (geprüft über die Prüfsummen von nodejs.org). Läuft auch wöchentlich von selbst.
set -euo pipefail
BASE=/opt/betriebsportal
case "$(uname -m)" in x86_64) ARCH=x64 ;; aarch64) ARCH=arm64 ;; *) exit 1 ;; esac
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o "$TMP/sums"
FILE="$(grep -oE "node-v22\.[0-9]+\.[0-9]+-linux-$ARCH\.tar\.xz" "$TMP/sums" | head -1)"
[ -n "$FILE" ] || { echo "Keine passende Node.js-Version gefunden"; exit 1; }
VER="${FILE#node-}"; VER="${VER%-linux-*}"
if [ -x "$BASE/node/bin/node" ] && [ "$("$BASE/node/bin/node" -v)" = "$VER" ]; then echo "Node.js $VER ist aktuell"; exit 0; fi
curl -fsSL "https://nodejs.org/dist/latest-v22.x/$FILE" -o "$TMP/$FILE"
(cd "$TMP" && grep " $FILE\$" sums | sha256sum -c - >/dev/null) || { echo "Prüfsumme von Node.js stimmt nicht"; exit 1; }
rm -rf "$BASE/node.neu"; mkdir -p "$BASE/node.neu"
tar -xJf "$TMP/$FILE" -C "$BASE/node.neu" --strip-components=1
"$BASE/node.neu/bin/node" -e 'require("node:sqlite")' 2>/dev/null || { echo "Node.js startet nicht"; exit 1; }
rm -rf "$BASE/node.alt"; [ -d "$BASE/node" ] && mv "$BASE/node" "$BASE/node.alt"
mv "$BASE/node.neu" "$BASE/node"; rm -rf "$BASE/node.alt"
echo "Node.js $VER installiert"
systemctl is-active --quiet betriebsportal 2>/dev/null && systemctl restart betriebsportal || true
NODE
chmod 755 "$BASE/node-aktualisieren.sh"
"$BASE/node-aktualisieren.sh"

say "3/6 Betriebsportal laden"
if [ ! -f "$BASE/app/portal.js" ]; then
  TMP="$(mktemp -d)"
  curl -fsSL "$CHANNEL/update.json" -o "$TMP/update.json"
  "$BASE/node/bin/node" - "$TMP" "$CHANNEL" "$BASE/app" <<'JS'
const fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto'), { execFileSync } = require('child_process');
const [tmp, channel, out] = process.argv.slice(2);
const m = JSON.parse(fs.readFileSync(path.join(tmp, 'update.json'), 'utf8'));
if (!/^[\w.-]+\.pkg$/.test(m.file)) throw new Error('Unerwarteter Dateiname im Update-Verzeichnis');
const pkg = path.join(tmp, m.file);
execFileSync('curl', ['-fsSL', `${channel}/${m.file}`, '-o', pkg], { stdio: 'inherit' });
const buf = fs.readFileSync(pkg);
if (crypto.createHash('sha256').update(buf).digest('hex') !== m.sha256) throw new Error('Die Prüfsumme des Pakets stimmt nicht');
const j = JSON.parse(zlib.gunzipSync(buf));
for (const [name, b64] of Object.entries(j.files)) {
  if (!/^(portal\.js|public\/[\w.-]+)$/.test(name)) throw new Error('Unerwartete Datei im Paket: ' + name);
  fs.mkdirSync(path.dirname(path.join(out, name)), { recursive: true });
  fs.writeFileSync(path.join(out, name), Buffer.from(b64, 'base64'));
}
console.log('Betriebsportal ' + j.version + ' geladen');
JS
  rm -rf "$TMP"
else
  echo "Programm ist schon vorhanden (aktualisiert sich selbst)"
fi
chown -R root:root "$BASE"; chmod -R go-w "$BASE"
chown -R portal:portal "$VAR"; chmod 750 "$VAR"

say "4/6 Dienst einrichten"
cat > /etc/systemd/system/betriebsportal.service <<UNIT
[Unit]
Description=Betriebsportal
After=network-online.target
Wants=network-online.target

[Service]
User=portal
Group=portal
WorkingDirectory=$VAR
Environment=HOME=$VAR
Environment=DATA_DIR=$VAR/daten
Environment=BACKUP_DIR=$VAR/sicherung
Environment=HOST=127.0.0.1
Environment=PORT=3000
Environment=PORTAL_SERVER=1
Environment=NO_BROWSER=1
Environment=PUBLIC_URL=https://$DOMAIN
ExecStart=$BASE/node/bin/node --no-warnings $BASE/app/portal.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$VAR
StandardInput=null

[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/betriebsportal-node.service <<UNIT
[Unit]
Description=Node.js fuer das Betriebsportal aktualisieren
[Service]
Type=oneshot
ExecStart=$BASE/node-aktualisieren.sh
UNIT
cat > /etc/systemd/system/betriebsportal-node.timer <<UNIT
[Unit]
Description=Node.js fuer das Betriebsportal woechentlich aktualisieren
[Timer]
OnCalendar=Sun 03:30
RandomizedDelaySec=1h
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now betriebsportal-node.timer >/dev/null
systemctl enable betriebsportal >/dev/null
systemctl restart betriebsportal

say "5/6 Verschlüsselten Zugang (https) und Firewall einrichten"
cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000
	header Strict-Transport-Security "max-age=31536000"
}
CADDY
systemctl enable caddy >/dev/null 2>&1 || true
systemctl restart caddy
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443 >/dev/null
ufw --force enable >/dev/null
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'APT'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT
systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true

say "6/6 Prüfen"
for i in $(seq 1 30); do curl -fsS http://127.0.0.1:3000/api/setup >/dev/null 2>&1 && break; sleep 1; done
curl -fsS http://127.0.0.1:3000/api/setup >/dev/null 2>&1 || { journalctl -u betriebsportal -n 30 --no-pager; die "Das Portal startet nicht (Protokoll siehe oben)."; }
HTTPS=nein
for i in $(seq 1 20); do curl -fsS "https://$DOMAIN/api/setup" >/dev/null 2>&1 && { HTTPS=ja; break; }; sleep 3; done
CODE="$(cat "$VAR/daten/einrichtungscode.txt" 2>/dev/null || true)"

echo
echo "=================================================================="
echo "  Das Betriebsportal läuft auf diesem Server."
echo
echo "  Adresse:           https://$DOMAIN"
if [ -n "$CODE" ]; then
echo "  Einrichtungscode:  $CODE"
echo
echo "  Nächster Schritt: am bisherigen Hauptrechner im Programm unter"
echo "  Einstellungen -> Umzug auf einen Server Adresse und Code eingeben."
else
echo "  (Bereits eingerichtet – vorhandene Daten wurden nicht verändert.)"
fi
if [ "$HTTPS" = nein ]; then
echo
echo "  ACHTUNG: https://$DOMAIN antwortet noch nicht. Zeigt die Adresse"
echo "  schon auf diesen Server (DNS-Eintrag)? Das Zertifikat wird dann von"
echo "  selbst geholt – in ein paar Minuten noch einmal probieren."
fi
echo "=================================================================="
