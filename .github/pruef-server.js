// Kleiner Datei-Server für die Prüfung. Verhält sich wie der Download-Server im echten Betrieb:
// HTTP/1.1, Angabe der Dateigröße, Verbindung bleibt offen.   Aufruf: node pruef-server.js <Ordner> <Port>
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(process.argv[2]), port = Number(process.argv[3]) || 8765;
http.createServer((req, res) => {
  const name = path.basename(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const file = path.join(root, name);
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Length': 0 }); return res.end(); }
    res.writeHead(200, { 'Content-Type': name.endsWith('.json') ? 'application/json' : 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-store' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}).listen(port, '127.0.0.1', () => console.log(`Prüf-Server auf 127.0.0.1:${port} für ${root}`));
