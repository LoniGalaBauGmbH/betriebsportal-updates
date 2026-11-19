"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// versions.js
var require_versions = __commonJS({
  "versions.js"(exports2, module2) {
    "use strict";
    var fs = require("node:fs");
    var path2 = require("node:path");
    var RE = /^\d+\.\d+\.\d+$/;
    var cmp = (a, b) => {
      const x = a.split(".").map(Number), y = b.split(".").map(Number);
      for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
      return 0;
    };
    function staged(dataDir, than, onlyApproved = false) {
      const dir = path2.join(dataDir, "app");
      let names = [];
      try {
        names = fs.readdirSync(dir);
      } catch {
        return null;
      }
      let best = null;
      for (const n of names) {
        if (!RE.test(n) || cmp(n, than) <= 0) continue;
        const d = path2.join(dir, n);
        if (!fs.existsSync(path2.join(d, "ok")) || fs.existsSync(path2.join(d, "bad"))) continue;
        if (onlyApproved && !fs.existsSync(path2.join(d, "approved"))) continue;
        if (!best || cmp(n, best.version) > 0) best = { version: n, dir: d };
      }
      return best;
    }
    var updateMode = (dataDir) => {
      try {
        return fs.readFileSync(path2.join(dataDir, "update-mode.txt"), "utf8").trim() === "manual" ? "manual" : "auto";
      } catch {
        return "auto";
      }
    };
    var pick2 = (dataDir, embedded) => staged(dataDir, embedded, updateMode(dataDir) === "manual");
    module2.exports = { RE, cmp, staged, updateMode, pick: pick2 };
  }
});

// package.json
var require_package = __commonJS({
  "package.json"(exports2, module2) {
    module2.exports = {
      name: "betriebsportal",
      version: "1.8.2",
      description: "Betriebsinternes Portal: Aufgaben, Nachrichten, Dateien, Kalender",
      private: true,
      engines: {
        node: ">=22.5"
      },
      scripts: {
        start: "node --no-warnings server.js",
        demo: "node --no-warnings demo.js",
        build: "node build.js",
        "build:update": "node build.js --update-only",
        release: "node release.js"
      },
      devDependencies: {
        esbuild: "^0.28.2",
        jsqr: "^1.4.0",
        "pe-library": "^2.0.3",
        "png-to-ico": "^3.0.2",
        pngjs: "^7.0.0",
        postject: "^1.0.0-alpha.6",
        "qrcode-generator": "^2.0.4",
        resedit: "^3.1.1"
      }
    };
  }
});

// db.js
var require_db = __commonJS({
  "db.js"(exports2, module2) {
    "use strict";
    var fs = require("node:fs");
    var path2 = require("node:path");
    var crypto = require("node:crypto");
    var { DatabaseSync } = require("node:sqlite");
    var isSea2 = false;
    try {
      isSea2 = require("node:sea").isSea();
    } catch {
    }
    var PACKAGED = isSea2 || !!process.env.PORTAL_PACKAGED;
    var DATA2 = process.env.DATA_DIR ? path2.resolve(process.env.DATA_DIR) : PACKAGED ? path2.join(require("node:os").homedir(), "Betriebsportal-Daten") : path2.join(__dirname, "data");
    var UPLOADS = path2.join(DATA2, "uploads");
    fs.mkdirSync(UPLOADS, { recursive: true });
    var db = new DatabaseSync(path2.join(DATA2, "portal.db"));
    db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  position TEXT NOT NULL DEFAULT '',
  responsibility TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user',
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  creator_id INTEGER NOT NULL REFERENCES users(id),
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'open',
  due TEXT,
  created_at TEXT NOT NULL,
  done_at TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'meeting',
  date_start TEXT NOT NULL,
  date_end TEXT NOT NULL,
  time_start TEXT,
  time_end TEXT,
  creator_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS event_attendees (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, user_id)
);
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  stored TEXT NOT NULL,
  size INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  ctx TEXT NOT NULL DEFAULT 'files',
  uploader_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  sender_id INTEGER NOT NULL REFERENCES users(id),
  recipient_id INTEGER REFERENCES users(id),
  body TEXT NOT NULL DEFAULT '',
  file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reads (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conv TEXT NOT NULL,
  last_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, conv)
);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_events_dates ON events(date_start, date_end);
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_id, sender_id);
`);
    var schemaVersion = db.prepare("PRAGMA user_version").get().user_version;
    if (schemaVersion < 1) {
      const cols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
      const add = (name, ddl) => {
        if (!cols.includes(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${ddl}`);
      };
      add("email", "TEXT NOT NULL DEFAULT ''");
      add("pending", "INTEGER NOT NULL DEFAULT 0");
      add("must_change", "INTEGER NOT NULL DEFAULT 0");
      add("reset_requested_at", "TEXT");
      db.exec(`
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reset_codes (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL, expires INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '');
    PRAGMA user_version = 1;`);
    }
    if (schemaVersion < 2) {
      const has = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
      if (!has("files", "project_id")) db.exec("ALTER TABLE files ADD COLUMN project_id INTEGER");
      if (!has("files", "category")) db.exec("ALTER TABLE files ADD COLUMN category TEXT NOT NULL DEFAULT ''");
      if (!has("tasks", "project_id")) db.exec("ALTER TABLE tasks ADD COLUMN project_id INTEGER");
      db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY, company TEXT NOT NULL, website TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', keywords TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
      created_by INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS contact_persons (
      id INTEGER PRIMARY KEY, contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      name TEXT NOT NULL, role TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', mobile TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY, number TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, customer TEXT NOT NULL DEFAULT '', contact_id INTEGER,
      description TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active',
      start_date TEXT, end_date TEXT, lead_id INTEGER, created_by INTEGER NOT NULL, created_at TEXT NOT NULL, closed_at TEXT);
    CREATE TABLE IF NOT EXISTS project_comments (
      id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, file_id INTEGER,
      user_id INTEGER, kind TEXT NOT NULL DEFAULT 'comment', body TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_files_project ON files(project_id);
    CREATE INDEX IF NOT EXISTS idx_pc_project ON project_comments(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
    PRAGMA user_version = 2;`);
    }
    if (schemaVersion < 3) {
      const ucols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
      if (!ucols.includes("avatar_v")) db.exec("ALTER TABLE users ADD COLUMN avatar_v INTEGER");
      if (!ucols.includes("avatar_type")) db.exec("ALTER TABLE users ADD COLUMN avatar_type TEXT NOT NULL DEFAULT ''");
      db.exec("PRAGMA user_version = 3");
    }
    if (schemaVersion < 4) {
      const has = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
      const add = (table, col, ddl) => {
        if (!has(table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
      };
      add("users", "weekly_hours", "REAL NOT NULL DEFAULT 40");
      add("users", "workdays", "TEXT NOT NULL DEFAULT '1,2,3,4,5'");
      add("users", "vacation_days", "REAL NOT NULL DEFAULT 30");
      add("users", "time_start", "TEXT");
      add("users", "overtime_start", "REAL NOT NULL DEFAULT 0");
      add("files", "owner_id", "INTEGER");
      db.exec(`
    CREATE TABLE IF NOT EXISTS time_entries (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      start TEXT NOT NULL, end TEXT, project_id INTEGER, station_id INTEGER, source TEXT NOT NULL DEFAULT 'app',
      note TEXT NOT NULL DEFAULT '', review INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, edited_by INTEGER, edited_at TEXT);
    CREATE TABLE IF NOT EXISTS time_stations (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, project_id INTEGER, mode TEXT NOT NULL DEFAULT 'static',
      token TEXT NOT NULL, secret TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS absences (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL, date_start TEXT NOT NULL, date_end TEXT NOT NULL, half INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending', note TEXT NOT NULL DEFAULT '', file_id INTEGER,
      decided_by INTEGER, decided_at TEXT, decision_note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_time_user ON time_entries(user_id, start);
    CREATE INDEX IF NOT EXISTS idx_abs_user ON absences(user_id, date_start);
    PRAGMA user_version = 4;`);
    }
    if (db.prepare("PRAGMA user_version").get().user_version < 5) {
      const has = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
      const add = (table, col, ddl) => {
        if (!has(table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
      };
      add("users", "kind", "TEXT NOT NULL DEFAULT 'office'");
      add("projects", "folders_init", "INTEGER NOT NULL DEFAULT 0");
      add("files", "folder_id", "INTEGER");
      add("files", "taken_at", "TEXT");
      add("files", "lat", "REAL");
      add("files", "lng", "REAL");
      db.exec(`
    CREATE TABLE IF NOT EXISTS project_folders (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS daily_reports (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, number INTEGER NOT NULL, date TEXT NOT NULL,
      client TEXT NOT NULL DEFAULT '', site TEXT NOT NULL DEFAULT '', weather TEXT NOT NULL DEFAULT '[]', temp TEXT NOT NULL DEFAULT '', staff TEXT NOT NULL DEFAULT '[]', machines TEXT NOT NULL DEFAULT '[]',
      materials TEXT NOT NULL DEFAULT '[]', notes TEXT NOT NULL DEFAULT '', signature TEXT NOT NULL DEFAULT '', signature2 TEXT NOT NULL DEFAULT '', signer TEXT NOT NULL DEFAULT '', signer2 TEXT NOT NULL DEFAULT '',
      created_by INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_reports_project ON daily_reports(project_id, date);
    CREATE INDEX IF NOT EXISTS idx_folders_project ON project_folders(project_id);
    PRAGMA user_version = 5;`);
    }
    var now = () => (/* @__PURE__ */ new Date()).toISOString();
    function hashPassword(pw) {
      const salt = crypto.randomBytes(16);
      const hash = crypto.scryptSync(pw, salt, 64);
      return salt.toString("hex") + ":" + hash.toString("hex");
    }
    function verifyPassword(pw, stored) {
      const [s, h] = String(stored).split(":");
      if (!s || !h) return false;
      const test = crypto.scryptSync(pw, Buffer.from(s, "hex"), 64);
      const real = Buffer.from(h, "hex");
      return test.length === real.length && crypto.timingSafeEqual(test, real);
    }
    module2.exports = { db, DATA: DATA2, PACKAGED, UPLOADS, now, hashPassword, verifyPassword };
  }
});

// readable-export.js
var require_readable_export = __commonJS({
  "readable-export.js"(exports2, module2) {
    "use strict";
    var fs = require("node:fs");
    var path2 = require("node:path");
    var MARKER = ".betriebsportal-ordner-ansicht";
    var RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
    function safeName(s, fallback = "Ohne Namen") {
      let n = String(s || "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
      if (n.length > 110) {
        const e = path2.extname(n).slice(0, 12);
        n = n.slice(0, 110 - e.length).trim() + e;
      }
      if (!n) n = fallback;
      if (RESERVED.test(n.replace(/\.[^.]*$/, ""))) n = "_" + n;
      return n;
    }
    var csv = (rows) => "\uFEFF" + rows.map((r) => r.map((v) => {
      const s = v === null || v === void 0 ? "" : String(v);
      return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(";")).join("\r\n") + "\r\n";
    var txt = (lines) => lines.join("\r\n") + "\r\n";
    var dt = (iso) => iso ? new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" }) : "";
    var day = (d) => d ? d.split("-").reverse().join(".") : "";
    module2.exports = async function exportReadable({ db, root, uploadsDir, linkFromDir, includeDirect }) {
      const all = (sql, ...a) => db.prepare(sql).all(...a);
      const users = new Map(all("SELECT * FROM users").map((u) => [u.id, u]));
      const uname = (id) => users.get(id)?.name || (id ? "Gel\xF6schtes Konto" : "\u2014");
      const texts = /* @__PURE__ */ new Map(), binaries = /* @__PURE__ */ new Map(), used = /* @__PURE__ */ new Set();
      const place = (dir, name) => {
        const base = safeName(name), ext = path2.extname(base), stem = base.slice(0, base.length - ext.length);
        let rel = path2.join(dir, base), i = 2;
        while (used.has(rel.toLowerCase())) rel = path2.join(dir, `${stem} (${i++})${ext}`);
        used.add(rel.toLowerCase());
        return rel;
      };
      const addText = (dir, name, content) => texts.set(place(dir, name), content);
      const addFile = (dir, f) => binaries.set(place(dir, f.name), f);
      const CAT_DIR = { delivery: "Lieferscheine", invoice: "Rechnungen", image: "Bilder", other: "Sonstiges" };
      const STATUS = { open: "offen", progress: "in Arbeit", done: "erledigt" }, PRIO = { low: "niedrig", normal: "normal", high: "hoch" };
      const contacts = new Map(all("SELECT * FROM contacts").map((k) => [k.id, k]));
      const pdirs = /* @__PURE__ */ new Set();
      for (const p of all("SELECT * FROM projects ORDER BY id")) {
        let dir = path2.join("Projekte", p.status === "done" ? "Abgeschlossen" : "Aktiv", safeName(`${p.number} ${p.name}`.trim(), `Projekt ${p.id}`));
        for (let i = 2; pdirs.has(dir.toLowerCase()); i++) dir = dir.replace(/( \(\d+\))?$/, ` (${i})`);
        pdirs.add(dir.toLowerCase());
        const k = contacts.get(p.contact_id);
        addText(dir, "Projekt.txt", txt([
          `PROJEKT ${p.number}  ${p.name}`,
          "=".repeat(60),
          "",
          `Status:          ${p.status === "done" ? "abgeschlossen" + (p.closed_at ? " am " + dt(p.closed_at) : "") : "aktiv"}`,
          `Kunde:           ${p.customer || "\u2014"}`,
          `Kontakt:         ${k ? k.company + (k.phone ? ", Tel. " + k.phone : "") : "\u2014"}`,
          `Projektleitung:  ${uname(p.lead_id)}`,
          `Zeitraum:        ${day(p.start_date) || "\u2026"} \u2013 ${day(p.end_date) || "offen"}`,
          `Ort / Baustelle: ${p.address || "\u2014"}`,
          `Angelegt:        ${dt(p.created_at)} von ${uname(p.created_by)}`,
          "",
          "BESCHREIBUNG",
          "-".repeat(60),
          p.description || "\u2014"
        ]));
        const feed = all("SELECT k.*, f.name AS file_name FROM project_comments k LEFT JOIN files f ON f.id = k.file_id WHERE k.project_id = ? ORDER BY k.id", p.id);
        addText(dir, "Verlauf und Kommentare.txt", txt([
          `VERLAUF UND KOMMENTARE \u2013 ${p.number} ${p.name}`,
          "=".repeat(60),
          "",
          ...feed.map((c) => c.kind === "event" ? `${dt(c.created_at)}  \xB7  ${uname(c.user_id)} ${c.body}` : `${dt(c.created_at)}  ${uname(c.user_id)}${c.file_name ? ` (zu \u201E${c.file_name}\u201C)` : ""}:\r
    ${String(c.body).replace(/\r?\n/g, "\r\n    ")}`),
          ...feed.length ? [] : ["Noch keine Eintr\xE4ge."]
        ]));
        const tasks = all("SELECT * FROM tasks WHERE project_id = ? ORDER BY id", p.id);
        if (tasks.length) addText(dir, "Aufgaben.csv", csv([["Aufgabe", "Status", "Zust\xE4ndig", "F\xE4llig am", "Priorit\xE4t", "Beschreibung"], ...tasks.map((t) => [t.title, STATUS[t.status] || t.status, uname(t.assignee_id), day(t.due), PRIO[t.priority] || t.priority, t.description])]));
        for (const f of all("SELECT * FROM files WHERE project_id = ? ORDER BY id", p.id)) addFile(path2.join(dir, CAT_DIR[f.category] || "Sonstiges"), f);
      }
      for (const f of all("SELECT * FROM files WHERE ctx = 'files' ORDER BY id")) addFile("Dateiablage", f);
      const persons = all("SELECT * FROM contact_persons ORDER BY contact_id, name COLLATE NOCASE");
      addText("Telefonbuch", "Firmen.csv", csv([
        ["Firma", "Telefon", "E-Mail", "Webseite", "Adresse", "Stichw\xF6rter", "Notizen"],
        ...[...contacts.values()].sort((a, b) => a.company.localeCompare(b.company, "de")).map((c) => [c.company, c.phone, c.email, c.website, c.address, c.keywords, c.notes])
      ]));
      addText("Telefonbuch", "Ansprechpersonen.csv", csv([["Firma", "Name", "Funktion", "Durchwahl", "Mobil", "E-Mail"], ...persons.map((q) => [contacts.get(q.contact_id)?.company || "", q.name, q.role, q.phone, q.mobile, q.email])]));
      const projName = new Map(all("SELECT id, number, name FROM projects").map((p) => [p.id, `${p.number} ${p.name}`]));
      addText("Aufgaben", "Alle Aufgaben.csv", csv([
        ["Aufgabe", "Status", "Zust\xE4ndig", "F\xE4llig am", "Priorit\xE4t", "Projekt", "Erstellt von", "Erstellt am", "Beschreibung"],
        ...all("SELECT * FROM tasks ORDER BY id").map((t) => [t.title, STATUS[t.status] || t.status, uname(t.assignee_id), day(t.due), PRIO[t.priority] || t.priority, projName.get(t.project_id) || "", uname(t.creator_id), dt(t.created_at), t.description])
      ]));
      const KIND = { meeting: "Besprechung", absence: "Abwesenheit", deadline: "Frist", other: "Sonstiges" };
      const att = all("SELECT * FROM event_attendees");
      addText("Kalender", "Termine.csv", csv([
        ["Termin", "Art", "Beginn", "Uhrzeit von", "Ende", "Uhrzeit bis", "Teilnehmer", "Erstellt von", "Beschreibung"],
        ...all("SELECT * FROM events ORDER BY date_start, time_start").map((e) => [e.title, KIND[e.kind] || e.kind, day(e.date_start), e.time_start || "ganzt\xE4gig", day(e.date_end), e.time_end || "", att.filter((a) => a.event_id === e.id).map((a) => uname(a.user_id)).join(", "), uname(e.creator_id), e.description])
      ]));
      addText("Team", "Mitarbeiter.csv", csv([
        ["Name", "Benutzername", "Position", "Verantwortungsbereich", "E-Mail", "Rolle", "Zugang"],
        ...[...users.values()].sort((a, b) => a.name.localeCompare(b.name, "de")).map((u) => [u.name, u.username, u.position, u.responsibility, u.email, u.role === "admin" ? "Administrator" : "Mitarbeiter", u.pending ? "wartet auf Freigabe" : u.active ? "aktiv" : "deaktiviert"])
      ]));
      const fileById = new Map(all("SELECT * FROM files WHERE ctx = 'message'").map((f) => [f.id, f]));
      const chat = (title, rows) => txt([title, "=".repeat(60), "", ...rows.map((m) => `${dt(m.created_at)}  ${uname(m.sender_id)}: ${String(m.body || "").replace(/\r?\n/g, "\r\n    ")}${m.file_id && fileById.get(m.file_id) ? `  [Anhang: ${fileById.get(m.file_id).name}]` : ""}`), ...rows.length ? [] : ["Noch keine Nachrichten."]]);
      const pub = all("SELECT * FROM messages WHERE recipient_id IS NULL ORDER BY id");
      addText("Nachrichten", "Alle Mitarbeiter.txt", chat("NACHRICHTEN AN ALLE MITARBEITER", pub));
      for (const m of pub) if (m.file_id && fileById.get(m.file_id)) addFile(path2.join("Nachrichten", "Anh\xE4nge (an alle)"), fileById.get(m.file_id));
      if (includeDirect) {
        const pairs = /* @__PURE__ */ new Map();
        for (const m of all("SELECT * FROM messages WHERE recipient_id IS NOT NULL ORDER BY id")) {
          const key = [m.sender_id, m.recipient_id].sort((a, b) => a - b).join("-");
          (pairs.get(key) || pairs.set(key, []).get(key)).push(m);
        }
        for (const [key, rows] of pairs) {
          const [a, b] = key.split("-").map(Number), name = `${uname(a)} und ${uname(b)}`;
          addText(path2.join("Nachrichten", "Direktnachrichten"), `${name}.txt`, chat(`DIREKTNACHRICHTEN \u2013 ${name}`, rows));
          for (const m of rows) if (m.file_id && fileById.get(m.file_id)) addFile(path2.join("Nachrichten", "Direktnachrichten", safeName(`Anh\xE4nge ${name}`)), fileById.get(m.file_id));
        }
      }
      addText("", "LIES-MICH.txt", txt([
        "ORDNER-ANSICHT DES BETRIEBSPORTALS",
        "",
        `Stand: ${(/* @__PURE__ */ new Date()).toLocaleString("de-DE")}`,
        "",
        "Hier liegen alle Inhalte so, dass man sie auch OHNE das Programm \xF6ffnen kann:",
        "",
        "  Projekte\\Aktiv und Projekte\\Abgeschlossen   je Projekt ein Ordner mit Lieferscheinen, Rechnungen, Bildern,",
        "                                              den Projektdaten, dem Verlauf mit allen Kommentaren und den Aufgaben",
        "  Dateiablage                                 die allgemeine Dateiablage",
        "  Telefonbuch                                 Firmen und Ansprechpersonen",
        "  Aufgaben, Kalender, Team                    als Tabellen",
        "  Nachrichten                                 Nachrichten an alle" + (includeDirect ? " und Direktnachrichten" : ""),
        "",
        "Die Tabellen (.csv) lassen sich mit Excel \xF6ffnen, die Texte (.txt) mit jedem Editor.",
        "",
        "WICHTIG: Dieser Ordner ist eine Kopie zum Nachschlagen. Er wird bei jeder Sicherung neu abgeglichen \u2013",
        "\xC4nderungen, die du hier machst, gehen dabei verloren und kommen nicht im Programm an."
      ]));
      await fs.promises.mkdir(root, { recursive: true });
      const marker = path2.join(root, MARKER);
      const existing = await fs.promises.readdir(root);
      const ours = existing.length === 0 || existing.includes(MARKER);
      if (ours) await fs.promises.writeFile(marker, "Dieser Ordner wird vom Betriebsportal verwaltet.\r\n");
      let written = 0, copied = 0, removed = 0;
      for (const [rel, content] of texts) {
        const dest = path2.join(root, rel);
        await fs.promises.mkdir(path2.dirname(dest), { recursive: true });
        let old = null;
        try {
          old = await fs.promises.readFile(dest, "utf8");
        } catch {
        }
        const same = old !== null && (old === content || rel === "LIES-MICH.txt" && old.replace(/^Stand: .*$/m, "") === content.replace(/^Stand: .*$/m, ""));
        if (!same) {
          await fs.promises.writeFile(dest, content);
          written++;
        }
      }
      for (const [rel, f] of binaries) {
        const dest = path2.join(root, rel), src = path2.join(uploadsDir, f.stored);
        try {
          if ((await fs.promises.stat(dest)).size === f.size) continue;
          await fs.promises.rm(dest, { force: true });
        } catch {
        }
        await fs.promises.mkdir(path2.dirname(dest), { recursive: true });
        try {
          try {
            await fs.promises.link(path2.join(linkFromDir, f.stored), dest);
          } catch {
            await fs.promises.copyFile(src, dest);
          }
          copied++;
        } catch {
        }
      }
      if (ours) {
        const keep = new Set([...texts.keys(), ...binaries.keys()].map((r) => r.toLowerCase()).concat(MARKER.toLowerCase()));
        const sweep = async (dir, rel) => {
          for (const e of await fs.promises.readdir(dir, { withFileTypes: true })) {
            const abs = path2.join(dir, e.name), r = rel ? path2.join(rel, e.name) : e.name;
            if (e.isDirectory()) {
              await sweep(abs, r);
              try {
                await fs.promises.rmdir(abs);
              } catch {
              }
            } else if (!keep.has(r.toLowerCase())) {
              await fs.promises.rm(abs, { force: true });
              removed++;
            }
          }
        };
        await sweep(root, "");
      }
      return { texts: texts.size, files: binaries.size, written, copied, removed, managed: ours };
    };
  }
});

// features.js
var require_features = __commonJS({
  "features.js"(exports2, module2) {
    "use strict";
    var fs = require("node:fs");
    var path2 = require("node:path");
    module2.exports = function install(x) {
      const { route, send, readJson, HttpError, db, DATA: DATA2, UPLOADS, now, str, isDate, intOrNull, getSetting, setSetting, audit, userExists, fileRow, MAX_LOGO = 3 * 1024 * 1024 } = x;
      const row = (sql, ...a) => db.prepare(sql).get(...a);
      const all = (sql, ...a) => db.prepare(sql).all(...a);
      const run = (sql, ...a) => db.prepare(sql).run(...a);
      const BRAND_DIR = path2.join(DATA2, "branding");
      const LOGO_TYPES = { "image/png": [137, 80, 78, 71], "image/jpeg": [255, 216, 255], "image/gif": [71, 73, 70, 56], "image/webp": [82, 73, 70, 70] };
      const branding = () => ({ name: getSetting("company_name", ""), logo: getSetting("logo_type") ? `/api/branding/logo?v=${getSetting("logo_v", "0")}` : null });
      route("GET", "/api/branding", { auth: false }, async (c) => send(c.res, 200, branding()));
      route("GET", "/api/branding/logo", { auth: false }, async (c) => {
        const type = getSetting("logo_type"), file = path2.join(BRAND_DIR, "logo");
        if (!type || !fs.existsSync(file)) throw new HttpError(404, "Kein Logo");
        c.res.writeHead(200, { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" });
        fs.createReadStream(file).pipe(c.res);
      });
      route("PUT", "/api/admin/branding", { admin: true }, async (c) => {
        setSetting("company_name", str((await readJson(c.req)).name, 80, { label: "Firmenname" }));
        audit(c.user.name, "Firmenname ge\xE4ndert", getSetting("company_name"));
        send(c.res, 200, branding());
      });
      route("POST", "/api/admin/logo", { admin: true }, async (c) => {
        const chunks = [];
        let size = 0;
        for await (const ch of c.req) {
          size += ch.length;
          if (size > MAX_LOGO) throw new HttpError(413, "Das Logo ist zu gro\xDF (max. 3 MB)");
          chunks.push(ch);
        }
        const buf = Buffer.concat(chunks);
        const type = Object.keys(LOGO_TYPES).find((t) => LOGO_TYPES[t].every((b, i) => buf[i] === b));
        if (!type) throw new HttpError(400, "Bitte ein Bild im Format PNG, JPG, GIF oder WebP hochladen");
        fs.mkdirSync(BRAND_DIR, { recursive: true });
        fs.writeFileSync(path2.join(BRAND_DIR, "logo"), buf);
        setSetting("logo_type", type);
        setSetting("logo_v", Date.now());
        audit(c.user.name, "Firmenlogo ge\xE4ndert");
        send(c.res, 200, branding());
      });
      route("DELETE", "/api/admin/logo", { admin: true }, async (c) => {
        fs.rmSync(path2.join(BRAND_DIR, "logo"), { force: true });
        setSetting("logo_type", "");
        send(c.res, 200, branding());
      });
      const AV_DIR = path2.join(DATA2, "avatars");
      route("POST", "/api/me/avatar", async (c) => {
        const chunks = [];
        let size = 0;
        for await (const ch of c.req) {
          size += ch.length;
          if (size > 2 * 1024 * 1024) throw new HttpError(413, "Das Bild ist zu gro\xDF (max. 2 MB)");
          chunks.push(ch);
        }
        const buf = Buffer.concat(chunks);
        const type = Object.keys(LOGO_TYPES).find((t) => LOGO_TYPES[t].every((b, i) => buf[i] === b));
        if (!type) throw new HttpError(400, "Bitte ein Bild im Format PNG, JPG, GIF oder WebP hochladen");
        fs.mkdirSync(AV_DIR, { recursive: true });
        fs.writeFileSync(path2.join(AV_DIR, String(c.user.id)), buf);
        run("UPDATE users SET avatar_v = ?, avatar_type = ? WHERE id = ?", Date.now(), type, c.user.id);
        send(c.res, 200, { avatar: `/api/users/${c.user.id}/avatar?v=${row("SELECT avatar_v FROM users WHERE id = ?", c.user.id).avatar_v}` });
      });
      route("DELETE", "/api/me/avatar", async (c) => {
        fs.rmSync(path2.join(AV_DIR, String(c.user.id)), { force: true });
        run("UPDATE users SET avatar_v = NULL, avatar_type = '' WHERE id = ?", c.user.id);
        send(c.res, 200, { avatar: null });
      });
      route("GET", "/api/users/:id/avatar", async (c) => {
        const u = row("SELECT id, avatar_v, avatar_type FROM users WHERE id = ?", Number(c.params.id));
        const file = u && path2.join(AV_DIR, String(u.id));
        if (!u || !u.avatar_v || !fs.existsSync(file)) throw new HttpError(404, "Kein Bild");
        c.res.writeHead(200, { "Content-Type": u.avatar_type || "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable" });
        fs.createReadStream(file).pipe(c.res);
      });
      const withPersons = (list) => {
        const persons = all("SELECT * FROM contact_persons ORDER BY name COLLATE NOCASE");
        return list.map((k) => ({ ...k, persons: persons.filter((p) => p.contact_id === k.id) }));
      };
      function contactFields(b) {
        const f = {
          company: str(b.company, 120, { required: true, label: "Firma" }),
          website: str(b.website, 200, { label: "Webseite" }),
          phone: str(b.phone, 60, { label: "Telefon" }),
          email: str(b.email, 120, { label: "E-Mail" }),
          address: str(b.address, 300, { label: "Adresse" }),
          keywords: str(b.keywords, 300, { label: "Stichw\xF6rter" }),
          notes: str(b.notes, 3e3, { label: "Notizen" })
        };
        const persons = (Array.isArray(b.persons) ? b.persons : []).slice(0, 50).map((p) => ({
          name: str(p.name, 100, { label: "Name" }),
          role: str(p.role, 100, { label: "Funktion" }),
          email: str(p.email, 120, { label: "E-Mail" }),
          phone: str(p.phone, 60, { label: "Durchwahl" }),
          mobile: str(p.mobile, 60, { label: "Mobil" })
        })).filter((p) => p.name);
        return { f, persons };
      }
      const savePersons = (id, persons) => {
        run("DELETE FROM contact_persons WHERE contact_id = ?", id);
        for (const p of persons) run("INSERT INTO contact_persons (contact_id,name,role,email,phone,mobile) VALUES (?,?,?,?,?,?)", id, p.name, p.role, p.email, p.phone, p.mobile);
      };
      route("GET", "/api/contacts", async (c) => send(c.res, 200, withPersons(all("SELECT * FROM contacts ORDER BY company COLLATE NOCASE"))));
      route("POST", "/api/contacts", async (c) => {
        const { f, persons } = contactFields(await readJson(c.req));
        const r = run("INSERT INTO contacts (company,website,phone,email,address,keywords,notes,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)", f.company, f.website, f.phone, f.email, f.address, f.keywords, f.notes, c.user.id, now(), now());
        savePersons(r.lastInsertRowid, persons);
        send(c.res, 201, withPersons([row("SELECT * FROM contacts WHERE id = ?", r.lastInsertRowid)])[0]);
      });
      route("PUT", "/api/contacts/:id", async (c) => {
        const id = Number(c.params.id);
        if (!row("SELECT 1 FROM contacts WHERE id = ?", id)) throw new HttpError(404, "Nicht gefunden");
        const { f, persons } = contactFields(await readJson(c.req));
        run("UPDATE contacts SET company=?, website=?, phone=?, email=?, address=?, keywords=?, notes=?, updated_at=? WHERE id=?", f.company, f.website, f.phone, f.email, f.address, f.keywords, f.notes, now(), id);
        savePersons(id, persons);
        send(c.res, 200, withPersons([row("SELECT * FROM contacts WHERE id = ?", id)])[0]);
      });
      route("DELETE", "/api/contacts/:id", async (c) => {
        const id = Number(c.params.id);
        run("UPDATE projects SET contact_id = NULL WHERE contact_id = ?", id);
        run("DELETE FROM contacts WHERE id = ?", id);
        send(c.res, 200, { ok: true });
      });
      const CATEGORIES = ["delivery", "invoice", "image", "other"];
      const CAT_LABEL = { delivery: "Lieferschein", invoice: "Rechnung", image: "Bild", other: "Dokument" };
      const event = (projectId, userId, body, fileId = null) => run("INSERT INTO project_comments (project_id,file_id,user_id,kind,body,created_at) VALUES (?,?,?,'event',?,?)", projectId, fileId, userId, body, now());
      const PROJECT_LIST = `SELECT p.*,
    (SELECT COUNT(*) FROM files f WHERE f.project_id = p.id AND f.category != 'image') AS docs,
    (SELECT COUNT(*) FROM files f WHERE f.project_id = p.id AND f.category = 'image') AS images,
    (SELECT COUNT(*) FROM project_comments k WHERE k.project_id = p.id AND k.kind = 'comment') AS comments,
    (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS tasks_total,
    (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS tasks_done,
    COALESCE((SELECT MAX(k.created_at) FROM project_comments k WHERE k.project_id = p.id), p.created_at) AS last_activity
    FROM projects p`;
      function projectFields(b, base = {}) {
        const p = { ...base };
        if ("name" in b) p.name = str(b.name, 160, { required: true, label: "Projektname" });
        if ("number" in b) p.number = str(b.number, 40, { label: "Projektnummer" });
        if ("customer" in b) p.customer = str(b.customer, 160, { label: "Kunde" });
        if ("description" in b) p.description = str(b.description, 5e3, { label: "Beschreibung" });
        if ("address" in b) p.address = str(b.address, 300, { label: "Ort" });
        for (const k of ["start_date", "end_date"]) if (k in b) {
          if (b[k] && !isDate(b[k])) throw new HttpError(400, "Ung\xFCltiges Datum");
          p[k] = b[k] || null;
        }
        if (p.start_date && p.end_date && p.end_date < p.start_date) throw new HttpError(400, "Das Ende darf nicht vor dem Beginn liegen");
        if ("lead_id" in b) {
          const l = intOrNull(b.lead_id);
          if (l !== null && !userExists(l)) throw new HttpError(400, "Unbekannte Person");
          p.lead_id = l;
        }
        if ("contact_id" in b) {
          const k = intOrNull(b.contact_id);
          p.contact_id = k !== null && row("SELECT 1 FROM contacts WHERE id = ?", k) ? k : null;
        }
        if ("status" in b) {
          if (!["active", "done"].includes(b.status)) throw new HttpError(400, "Ung\xFCltiger Status");
          p.status = b.status;
        }
        return p;
      }
      const getProject = (id) => {
        const p = row("SELECT * FROM projects WHERE id = ?", Number(id));
        if (!p) throw new HttpError(404, "Projekt nicht gefunden");
        return p;
      };
      const canManage = (u, p) => u.role === "admin" || p.created_by === u.id || p.lead_id === u.id;
      const { isSite, siteSees } = x;
      const siteProject = (p) => ({
        id: p.id,
        number: p.number,
        name: p.name,
        customer: p.customer,
        address: p.address,
        status: p.status,
        description: "",
        lead_id: null,
        contact_id: null,
        start_date: null,
        end_date: null,
        created_by: null,
        created_at: p.created_at,
        docs: 0,
        images: p.images,
        comments: 0,
        tasks_total: 0,
        tasks_done: 0,
        last_activity: p.last_activity
      });
      route("GET", "/api/projects", async (c) => {
        const list = all(`${PROJECT_LIST} ORDER BY p.status, last_activity DESC`);
        send(c.res, 200, isSite(c.user) ? list.filter((p) => p.status === "active").map(siteProject) : list);
      });
      route("POST", "/api/projects", async (c) => {
        const p = projectFields(await readJson(c.req), { number: "", customer: "", description: "", address: "", start_date: null, end_date: null, lead_id: c.user.id, contact_id: null, status: "active" });
        if (!p.name) throw new HttpError(400, "Projektname darf nicht leer sein");
        if (!p.number) {
          const y = (/* @__PURE__ */ new Date()).getFullYear();
          const n = row("SELECT COUNT(*) n FROM projects WHERE number LIKE ?", `P-${y}-%`).n + 1;
          p.number = `P-${y}-${String(n).padStart(3, "0")}`;
        }
        const r = run(
          "INSERT INTO projects (number,name,customer,contact_id,description,address,status,start_date,end_date,lead_id,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
          p.number,
          p.name,
          p.customer,
          p.contact_id,
          p.description,
          p.address,
          p.status,
          p.start_date,
          p.end_date,
          p.lead_id,
          c.user.id,
          now()
        );
        event(r.lastInsertRowid, c.user.id, "hat das Projekt angelegt");
        send(c.res, 201, row(`${PROJECT_LIST} WHERE p.id = ?`, r.lastInsertRowid));
      });
      route("GET", "/api/projects/:id", async (c) => {
        const p = getProject(c.params.id);
        if (isSite(c.user)) {
          const files = all(`SELECT f.id, f.name, f.size, f.note, f.category, f.uploader_id, f.created_at, f.folder_id, f.taken_at, f.lat, f.lng,
        (SELECT COUNT(*) FROM project_comments k WHERE k.file_id = f.id AND k.kind = 'comment') AS comments FROM files f WHERE f.project_id = ? ORDER BY f.id DESC`, p.id).filter((f) => siteSees(c.user, f));
          const ids = new Set(files.map((f) => f.id));
          return send(c.res, 200, {
            project: siteProject(row(`${PROJECT_LIST} WHERE p.id = ?`, p.id)),
            files,
            feed: all("SELECT k.*, f.name AS file_name, f.category AS file_category FROM project_comments k LEFT JOIN files f ON f.id = k.file_id WHERE k.project_id = ? AND k.kind = 'comment' AND k.file_id IS NOT NULL ORDER BY k.id DESC LIMIT 500", p.id).filter((k) => ids.has(k.file_id)),
            tasks: all("SELECT * FROM tasks WHERE project_id = ? AND (assignee_id = ? OR creator_id = ?) ORDER BY id DESC", p.id, c.user.id, c.user.id),
            contact: null,
            can_manage: false
          });
        }
        send(c.res, 200, {
          project: row(`${PROJECT_LIST} WHERE p.id = ?`, p.id),
          files: all(`SELECT f.id, f.name, f.size, f.note, f.category, f.uploader_id, f.created_at, f.folder_id, f.taken_at, f.lat, f.lng,
        (SELECT COUNT(*) FROM project_comments k WHERE k.file_id = f.id AND k.kind = 'comment') AS comments FROM files f WHERE f.project_id = ? ORDER BY f.id DESC`, p.id),
          feed: all("SELECT k.*, f.name AS file_name, f.category AS file_category FROM project_comments k LEFT JOIN files f ON f.id = k.file_id WHERE k.project_id = ? ORDER BY k.id DESC LIMIT 500", p.id),
          tasks: all("SELECT * FROM tasks WHERE project_id = ? ORDER BY status = 'done', due IS NULL, due, id DESC", p.id),
          contact: p.contact_id ? withPersons(all("SELECT * FROM contacts WHERE id = ?", p.contact_id))[0] || null : null,
          can_manage: canManage(c.user, p)
        });
      });
      route("PUT", "/api/projects/:id", async (c) => {
        const old = getProject(c.params.id);
        if (!canManage(c.user, old)) throw new HttpError(403, "Nur Projektleitung, Ersteller:in oder Admins d\xFCrfen das Projekt \xE4ndern");
        const p = projectFields(await readJson(c.req), old);
        const closed = p.status === "done" ? old.status === "done" ? old.closed_at : now() : null;
        run(
          "UPDATE projects SET number=?, name=?, customer=?, contact_id=?, description=?, address=?, status=?, start_date=?, end_date=?, lead_id=?, closed_at=? WHERE id=?",
          p.number,
          p.name,
          p.customer,
          p.contact_id,
          p.description,
          p.address,
          p.status,
          p.start_date,
          p.end_date,
          p.lead_id,
          closed,
          old.id
        );
        if (old.status !== p.status) event(old.id, c.user.id, p.status === "done" ? "hat das Projekt abgeschlossen" : "hat das Projekt wieder ge\xF6ffnet");
        else event(old.id, c.user.id, "hat die Projektdaten ge\xE4ndert");
        send(c.res, 200, row(`${PROJECT_LIST} WHERE p.id = ?`, old.id));
      });
      route("DELETE", "/api/projects/:id", { admin: true }, async (c) => {
        const p = getProject(c.params.id);
        for (const f of all("SELECT stored FROM files WHERE project_id = ?", p.id)) fs.rm(path2.join(UPLOADS, f.stored), { force: true }, () => {
        });
        run("DELETE FROM files WHERE project_id = ?", p.id);
        run("DELETE FROM project_folders WHERE project_id = ?", p.id);
        run("DELETE FROM daily_reports WHERE project_id = ?", p.id);
        run("UPDATE time_entries SET project_id = NULL WHERE project_id = ?", p.id);
        run("UPDATE time_stations SET project_id = NULL WHERE project_id = ?", p.id);
        run("UPDATE tasks SET project_id = NULL WHERE project_id = ?", p.id);
        run("DELETE FROM projects WHERE id = ?", p.id);
        audit(c.user.name, "Projekt gel\xF6scht", `${p.number} ${p.name}`);
        send(c.res, 200, { ok: true });
      });
      route("POST", "/api/projects/:id/comments", async (c) => {
        const p = getProject(c.params.id);
        const b = await readJson(c.req);
        const body = str(b.body, 5e3, { required: true, label: "Kommentar" });
        const fileId = intOrNull(b.file_id);
        if (isSite(c.user) && (fileId === null || !siteSees(c.user, row("SELECT * FROM files WHERE id = ?", fileId) || { uploader_id: -1 }))) throw new HttpError(403, "Kommentare sind hier nur zu Fotos m\xF6glich");
        if (fileId !== null && !row("SELECT 1 FROM files WHERE id = ? AND project_id = ?", fileId, p.id)) throw new HttpError(400, "Datei geh\xF6rt nicht zu diesem Projekt");
        const r = run("INSERT INTO project_comments (project_id,file_id,user_id,kind,body,created_at) VALUES (?,?,?,'comment',?,?)", p.id, fileId, c.user.id, body, now());
        send(c.res, 201, row("SELECT * FROM project_comments WHERE id = ?", r.lastInsertRowid));
      });
      route("DELETE", "/api/projects/:id/comments/:cid", async (c) => {
        const k = row("SELECT * FROM project_comments WHERE id = ? AND project_id = ? AND kind = 'comment'", Number(c.params.cid), Number(c.params.id));
        if (!k) throw new HttpError(404, "Nicht gefunden");
        if (c.user.role !== "admin" && k.user_id !== c.user.id) throw new HttpError(403, "Nur eigene Kommentare k\xF6nnen gel\xF6scht werden");
        run("DELETE FROM project_comments WHERE id = ?", k.id);
        send(c.res, 200, { ok: true });
      });
      route("PUT", "/api/files/:id/assign", async (c) => {
        const f = row("SELECT * FROM files WHERE id = ? AND ctx IN ('files','project')", Number(c.params.id));
        if (!f) throw new HttpError(404, "Nicht gefunden");
        const b = await readJson(c.req);
        const pid = intOrNull(b.project_id);
        if (pid === null) {
          if (f.project_id) event(f.project_id, c.user.id, `hat \u201E${f.name}\u201C aus dem Projekt gel\xF6st`);
          run("UPDATE files SET project_id = NULL, category = '', ctx = 'files' WHERE id = ?", f.id);
        } else {
          const p = getProject(pid);
          const cat = CATEGORIES.includes(b.category) ? b.category : "other";
          run("UPDATE files SET project_id = ?, category = ?, ctx = 'project' WHERE id = ?", p.id, cat, f.id);
          if (f.project_id !== p.id) event(p.id, c.user.id, `hat ${CAT_LABEL[cat]} \u201E${f.name}\u201C zugeordnet`, f.id);
          if (f.project_id && f.project_id !== p.id) event(f.project_id, c.user.id, `hat \u201E${f.name}\u201C in ein anderes Projekt verschoben`);
        }
        send(c.res, 200, row(`${fileRow} WHERE id = ?`, f.id));
      });
      route("DELETE", "/api/projects/:id/files/:fid", async (c) => {
        const p = getProject(c.params.id);
        const f = row("SELECT * FROM files WHERE id = ? AND project_id = ?", Number(c.params.fid), p.id);
        if (!f) throw new HttpError(404, "Nicht gefunden");
        if (!canManage(c.user, p) && f.uploader_id !== c.user.id) throw new HttpError(403, "Nur wer die Datei hochgeladen hat, die Projektleitung oder Admins d\xFCrfen sie l\xF6schen");
        run("DELETE FROM project_comments WHERE file_id = ?", f.id);
        run("DELETE FROM files WHERE id = ?", f.id);
        fs.rm(path2.join(UPLOADS, f.stored), { force: true }, () => {
        });
        event(p.id, c.user.id, `hat \u201E${f.name}\u201C gel\xF6scht`);
        send(c.res, 200, { ok: true });
      });
      route("GET", "/api/search", async (c) => {
        const q = String(c.query.get("q") || "").trim().slice(0, 80);
        if (q.length < 2) return send(c.res, 200, { contacts: [], projects: [], tasks: [], files: [] });
        const like = "%" + q.replace(/[\\%_]/g, (m) => "\\" + m) + "%";
        const L = "LIKE ? ESCAPE '\\'";
        const contacts = withPersons(all(`SELECT DISTINCT k.* FROM contacts k LEFT JOIN contact_persons p ON p.contact_id = k.id
      WHERE k.company ${L} OR k.keywords ${L} OR k.website ${L} OR k.phone ${L} OR k.email ${L} OR k.notes ${L} OR p.name ${L} OR p.email ${L} OR p.phone ${L} OR p.mobile ${L}
      ORDER BY (k.company ${L}) DESC, (k.keywords ${L}) DESC, k.company COLLATE NOCASE LIMIT 8`, ...Array(12).fill(like)));
        send(c.res, 200, {
          contacts,
          projects: all(`SELECT id, number, name, customer, status FROM projects WHERE name ${L} OR number ${L} OR customer ${L} OR description ${L} OR address ${L} ORDER BY status, id DESC LIMIT 6`, like, like, like, like, like),
          tasks: all(`SELECT id, title, status, assignee_id, project_id FROM tasks WHERE title ${L} OR description ${L} ORDER BY status = 'done', id DESC LIMIT 6`, like, like),
          files: all(`SELECT id, name, size, ctx, project_id FROM files WHERE ctx IN ('files','project') AND (name ${L} OR note ${L}) ORDER BY id DESC LIMIT 6`, like, like)
        });
      });
      const defaultBackupDir = () => process.env.BACKUP_DIR || path2.join(path2.dirname(DATA2), "Betriebsportal-Sicherung");
      const ON_SERVER = !!process.env.PORTAL_SERVER;
      const backupCfg = () => ({
        enabled: getSetting("backup_enabled", "1") === "1",
        dir: !ON_SERVER && getSetting("backup_dir", "") || defaultBackupDir(),
        server: ON_SERVER,
        keep: Math.min(Math.max(Number(getSetting("backup_keep", "48")) || 48, 2), 1e3),
        default_dir: defaultBackupDir(),
        readable: getSetting("backup_readable", "1") === "1",
        // zusätzlich eine lesbare Ordner-Ansicht ablegen
        direct: getSetting("backup_direct", "0") === "1"
      });
      const backupLast = () => {
        try {
          return JSON.parse(getSetting("backup_last", "null"));
        } catch {
          return null;
        }
      };
      let backupRunning = false;
      async function runBackup() {
        if (backupRunning) return backupLast();
        backupRunning = true;
        const cfg = backupCfg(), started = Date.now();
        let result;
        try {
          const dbDir = path2.join(cfg.dir, "datenbank"), fileDir = path2.join(cfg.dir, "dateien");
          await fs.promises.mkdir(dbDir, { recursive: true });
          await fs.promises.mkdir(fileDir, { recursive: true });
          const d = /* @__PURE__ */ new Date(), pad = (n) => String(n).padStart(2, "0");
          const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
          const snap = path2.join(dbDir, `portal-${stamp}.db`);
          db.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`);
          const have = new Set(await fs.promises.readdir(fileDir));
          let copied = 0;
          for (const name of await fs.promises.readdir(UPLOADS)) if (!have.has(name)) {
            await fs.promises.copyFile(path2.join(UPLOADS, name), path2.join(fileDir, name));
            copied++;
          }
          if (fs.existsSync(path2.join(BRAND_DIR, "logo"))) await fs.promises.copyFile(path2.join(BRAND_DIR, "logo"), path2.join(cfg.dir, "logo"));
          if (fs.existsSync(AV_DIR)) {
            await fs.promises.mkdir(path2.join(cfg.dir, "profilbilder"), { recursive: true });
            for (const name of await fs.promises.readdir(AV_DIR)) await fs.promises.copyFile(path2.join(AV_DIR, name), path2.join(cfg.dir, "profilbilder", name));
          }
          const snaps = (await fs.promises.readdir(dbDir)).filter((n) => /^portal-.*\.db$/.test(n)).sort();
          for (const old of snaps.slice(0, Math.max(0, snaps.length - cfg.keep))) await fs.promises.rm(path2.join(dbDir, old), { force: true });
          await fs.promises.writeFile(path2.join(cfg.dir, "LIES-MICH.txt"), [
            "SICHERUNG DES BETRIEBSPORTALS",
            "",
            `Letzte Sicherung: ${d.toLocaleString("de-DE")}`,
            "",
            "Inhalt:",
            "  Ordner-Ansicht/  alles zum Nachschlagen ohne das Programm: Projekte als Ordner mit ihren Dateien, Tabellen, Texte",
            "  datenbank/       st\xFCndliche Schnappsch\xFCsse der Datenbank (zum vollst\xE4ndigen Wiederherstellen)",
            "  dateien/         alle hochgeladenen Dateien (technische Kopie f\xFCr das Wiederherstellen)",
            "",
            "WIEDERHERSTELLEN (z. B. auf einem neuen Hauptrechner):",
            "  1. Betriebsportal installieren, aber noch NICHT einrichten \u2013 bzw. das Programm ganz beenden (Symbol neben der Uhr -> Beenden).",
            '  2. Im Benutzerordner den Ordner "Betriebsportal-Daten" \xF6ffnen (falls er fehlt: anlegen).',
            '  3. Den neuesten Schnappschuss aus "datenbank" dorthin kopieren und in "portal.db" umbenennen',
            "     (vorhandene Dateien portal.db, portal.db-wal und portal.db-shm vorher l\xF6schen).",
            '  4. Den Inhalt von "dateien" in den Unterordner "uploads" kopieren',
            '     (und, falls vorhanden, "profilbilder" nach "avatars" sowie die Datei "logo" in den Unterordner "branding").',
            "  5. Betriebsportal starten.",
            ""
          ].join("\r\n"));
          let view = null;
          if (cfg.readable) {
            try {
              view = await require_readable_export()({ db, root: path2.join(cfg.dir, "Ordner-Ansicht"), uploadsDir: UPLOADS, linkFromDir: fileDir, includeDirect: cfg.direct });
            } catch (e) {
              view = { error: e.message };
            }
          }
          result = { at: now(), ok: true, dir: cfg.dir, copied, snapshots: Math.min(snaps.length, cfg.keep), view, ms: Date.now() - started };
        } catch (e) {
          result = { at: now(), ok: false, dir: cfg.dir, error: e.code === "ENOENT" || e.code === "EACCES" || e.code === "EPERM" ? `Der Ordner ist nicht erreichbar oder nicht beschreibbar (${e.code})` : e.message };
        } finally {
          backupRunning = false;
        }
        setSetting("backup_last", JSON.stringify(result));
        return result;
      }
      const backupInfo = () => ({ ...backupCfg(), last: backupLast() });
      route("GET", "/api/admin/backup", { admin: true }, async (c) => send(c.res, 200, backupInfo()));
      route("PUT", "/api/admin/backup", { admin: true }, async (c) => {
        const b = await readJson(c.req);
        if ("enabled" in b) setSetting("backup_enabled", b.enabled ? "1" : "0");
        if ("keep" in b) setSetting("backup_keep", String(Math.min(Math.max(Number(b.keep) || 48, 2), 1e3)));
        if ("readable" in b) setSetting("backup_readable", b.readable ? "1" : "0");
        if ("direct" in b) setSetting("backup_direct", b.direct ? "1" : "0");
        if ("dir" in b && !ON_SERVER) {
          const dir = str(b.dir, 400, { label: "Ordner" });
          if (dir && !path2.isAbsolute(dir)) throw new HttpError(400, "Bitte den vollst\xE4ndigen Pfad angeben, z. B. D:\\Sicherung oder \\\\Server\\Freigabe\\Sicherung");
          if (dir && path2.resolve(dir).startsWith(path2.resolve(DATA2))) throw new HttpError(400, "Die Sicherung darf nicht im Daten-Ordner selbst liegen");
          setSetting("backup_dir", dir);
        }
        audit(c.user.name, "Sicherung: Einstellungen ge\xE4ndert");
        send(c.res, 200, backupInfo());
      });
      route("POST", "/api/admin/backup/run", { admin: true }, async (c) => {
        await runBackup();
        send(c.res, 200, backupInfo());
      });
      if (!process.env.PORTAL_NO_BACKUP) {
        const due = () => {
          const l = backupLast();
          return backupCfg().enabled && (!l || Date.now() - Date.parse(l.at) > 55 * 6e4);
        };
        setTimeout(() => {
          if (due()) runBackup();
        }, 90 * 1e3).unref?.();
        setInterval(() => {
          if (due()) runBackup();
        }, 5 * 6e4).unref?.();
      }
      return { runBackup, event, CATEGORIES, backupCfg };
    };
  }
});

// fieldwork.js
var require_fieldwork = __commonJS({
  "fieldwork.js"(exports2, module2) {
    "use strict";
    var DEFAULT_FOLDERS = ["Baustellenfotos", "Formulare", "Pl\xE4ne & Unterlagen"];
    var WEATHER = ["sun", "partly", "cloud", "storm", "rain", "snow"];
    module2.exports = function install(x) {
      const { route, send, readJson, HttpError, db, now, str, isDate, intOrNull, getSetting, setSetting, audit, event, isSite, siteSees } = x;
      const row = (sql, ...a) => db.prepare(sql).get(...a);
      const all = (sql, ...a) => db.prepare(sql).all(...a);
      const run = (sql, ...a) => db.prepare(sql).run(...a);
      const project = (id) => {
        const p = row("SELECT * FROM projects WHERE id = ?", Number(id));
        if (!p) throw new HttpError(404, "Projekt nicht gefunden");
        return p;
      };
      const canManage = (u, p) => u.role === "admin" || p.created_by === u.id || p.lead_id === u.id;
      const pad = (n) => String(n).padStart(2, "0");
      const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const defaultFolders = () => {
        const s = getSetting("default_folders", "");
        const l = s.split("\n").map((v) => v.trim()).filter(Boolean);
        return l.length ? l.slice(0, 30) : DEFAULT_FOLDERS;
      };
      function folders(p) {
        if (!p.folders_init) {
          const have = new Set(all("SELECT name FROM project_folders WHERE project_id = ?", p.id).map((f) => f.name));
          defaultFolders().forEach((name, i) => {
            if (!have.has(name)) run("INSERT INTO project_folders (project_id, name, sort, created_at) VALUES (?,?,?,?)", p.id, name, i, now());
          });
          run("UPDATE projects SET folders_init = 1 WHERE id = ?", p.id);
        }
        return all("SELECT f.id, f.name, f.sort, (SELECT COUNT(*) FROM files x WHERE x.folder_id = f.id) AS count FROM project_folders f WHERE f.project_id = ? ORDER BY f.sort, f.name COLLATE NOCASE", p.id);
      }
      const folderName = (b) => str(b.name, 60, { required: true, label: "Name der Mappe" });
      route("POST", "/api/projects/:id/folders", async (c) => {
        const p = project(c.params.id), name = folderName(await readJson(c.req));
        if (row("SELECT 1 FROM project_folders WHERE project_id = ? AND name = ? COLLATE NOCASE", p.id, name)) throw new HttpError(409, "Diese Mappe gibt es schon");
        const sort = (row("SELECT MAX(sort) m FROM project_folders WHERE project_id = ?", p.id).m ?? -1) + 1;
        const r = run("INSERT INTO project_folders (project_id, name, sort, created_at) VALUES (?,?,?,?)", p.id, name, sort, now());
        event(p.id, c.user.id, `hat die Mappe \u201E${name}\u201C angelegt`);
        send(c.res, 201, { id: Number(r.lastInsertRowid), name, sort, count: 0 });
      });
      route("PUT", "/api/projects/:id/folders/:fid", async (c) => {
        const p = project(c.params.id), f = row("SELECT * FROM project_folders WHERE id = ? AND project_id = ?", Number(c.params.fid), p.id);
        if (!f) throw new HttpError(404, "Mappe nicht gefunden");
        const name = folderName(await readJson(c.req));
        run("UPDATE project_folders SET name = ? WHERE id = ?", name, f.id);
        send(c.res, 200, { ok: true });
      });
      route("DELETE", "/api/projects/:id/folders/:fid", async (c) => {
        const p = project(c.params.id), f = row("SELECT * FROM project_folders WHERE id = ? AND project_id = ?", Number(c.params.fid), p.id);
        if (!f) throw new HttpError(404, "Mappe nicht gefunden");
        if (!canManage(c.user, p)) throw new HttpError(403, "Mappen l\xF6schen d\xFCrfen nur Projektleitung und Administratoren");
        run("UPDATE files SET folder_id = NULL WHERE folder_id = ?", f.id);
        run("DELETE FROM project_folders WHERE id = ?", f.id);
        event(p.id, c.user.id, `hat die Mappe \u201E${f.name}\u201C gel\xF6scht (der Inhalt bleibt im Projekt)`);
        send(c.res, 200, { ok: true });
      });
      route("GET", "/api/admin/folders", { admin: true }, async (c) => send(c.res, 200, { folders: defaultFolders() }));
      route("PUT", "/api/admin/folders", { admin: true }, async (c) => {
        const b = await readJson(c.req);
        const list = (Array.isArray(b.folders) ? b.folders : String(b.folders || "").split("\n")).map((v) => String(v).trim().slice(0, 60)).filter(Boolean).slice(0, 30);
        setSetting("default_folders", list.join("\n"));
        audit(c.user.name, "Standard-Mappen ge\xE4ndert", list.join(", "));
        send(c.res, 200, { folders: defaultFolders() });
      });
      function afterUpload(fileId, projectId, q) {
        const folder = intOrNull(q.get("folder"));
        const fid = folder !== null && row("SELECT 1 FROM project_folders WHERE id = ? AND project_id = ?", folder, projectId) ? folder : null;
        const taken = q.get("taken") && !isNaN(Date.parse(q.get("taken"))) ? new Date(q.get("taken")).toISOString() : null;
        const lat = Number(q.get("lat")), lng = Number(q.get("lng"));
        const geo = q.get("lat") && q.get("lng") && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
        run("UPDATE files SET folder_id = ?, taken_at = ?, lat = ?, lng = ? WHERE id = ?", fid, taken, geo ? lat : null, geo ? lng : null, fileId);
      }
      route("PUT", "/api/projects/:id/files/:fid", async (c) => {
        const p = project(c.params.id), f = row("SELECT * FROM files WHERE id = ? AND project_id = ?", Number(c.params.fid), p.id);
        if (!f) throw new HttpError(404, "Nicht gefunden");
        const b = await readJson(c.req);
        if ("note" in b) {
          if (f.uploader_id !== c.user.id && !canManage(c.user, p)) throw new HttpError(403, "Die Beschreibung \xE4ndert, wer das Foto aufgenommen hat, oder die Projektleitung");
          run("UPDATE files SET note = ? WHERE id = ?", str(b.note, 2e3, { label: "Beschreibung" }), f.id);
        }
        if ("folder_id" in b) {
          const fid = intOrNull(b.folder_id);
          if (fid !== null && !row("SELECT 1 FROM project_folders WHERE id = ? AND project_id = ?", fid, p.id)) throw new HttpError(400, "Mappe nicht gefunden");
          run("UPDATE files SET folder_id = ? WHERE id = ?", fid, f.id);
        }
        send(c.res, 200, { ok: true });
      });
      function hours(p) {
        const list = all("SELECT e.user_id, u.name, e.start, e.end FROM time_entries e JOIN users u ON u.id = e.user_id WHERE e.project_id = ? ORDER BY e.start DESC", p.id);
        const byUser = /* @__PURE__ */ new Map(), byDay = /* @__PURE__ */ new Map();
        for (const e of list) {
          const min = Math.max(0, Math.round(((e.end ? Date.parse(e.end) : Date.now()) - Date.parse(e.start)) / 6e4));
          if (!e.end && ymd(new Date(e.start)) !== ymd(/* @__PURE__ */ new Date())) continue;
          const u = byUser.get(e.user_id) || { user_id: e.user_id, name: e.name, minutes: 0, days: /* @__PURE__ */ new Set() };
          u.minutes += min;
          u.days.add(ymd(new Date(e.start)));
          byUser.set(e.user_id, u);
          const d = ymd(new Date(e.start)), day = byDay.get(d) || { date: d, minutes: 0, people: /* @__PURE__ */ new Map() };
          day.minutes += min;
          day.people.set(e.name, (day.people.get(e.name) || 0) + min);
          byDay.set(d, day);
        }
        return {
          total: [...byUser.values()].reduce((n, u) => n + u.minutes, 0),
          users: [...byUser.values()].map((u) => ({ user_id: u.user_id, name: u.name, minutes: u.minutes, days: u.days.size })).sort((a, b) => b.minutes - a.minutes),
          days: [...byDay.values()].slice(0, 60).map((d) => ({ date: d.date, minutes: d.minutes, people: [...d.people].map(([name, minutes]) => ({ name, minutes })) }))
        };
      }
      route("PUT", "/api/time/project", async (c) => {
        const open = row("SELECT * FROM time_entries WHERE user_id = ? AND end IS NULL ORDER BY id DESC LIMIT 1", c.user.id);
        if (!open) throw new HttpError(400, "Du bist gerade nicht eingestempelt");
        const pid = intOrNull((await readJson(c.req)).project_id);
        if (pid !== null) project(pid);
        if (open.project_id === pid) return send(c.res, 200, { ok: true });
        if (open.project_id !== null && Date.now() - Date.parse(open.start) > 5 * 6e4) {
          const t = now();
          run("UPDATE time_entries SET end = ? WHERE id = ?", t, open.id);
          run("INSERT INTO time_entries (user_id, start, project_id, station_id, source, created_at) VALUES (?,?,?,?,?,?)", c.user.id, t, pid, open.station_id, open.source, t);
        } else run("UPDATE time_entries SET project_id = ? WHERE id = ?", pid, open.id);
        send(c.res, 200, { ok: true });
      });
      const rows = (v, fields, max) => (Array.isArray(v) ? v : []).slice(0, max).map((r) => Object.fromEntries(fields.map(([k, len]) => [k, String(r?.[k] ?? "").trim().slice(0, len)]))).filter((r) => Object.values(r).some(Boolean));
      const sig = (v) => typeof v === "string" && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(v) && v.length < 4e5 ? v : "";
      function reportFields(b, old = {}) {
        const date = "date" in b ? b.date : old.date;
        if (!isDate(date)) throw new HttpError(400, "Bitte ein g\xFCltiges Datum angeben");
        const pick2 = (k, len, label) => k in b ? str(b[k], len, { label }) : old[k] || "";
        return {
          date,
          client: pick2("client", 200, "Auftraggeber"),
          site: pick2("site", 200, "Bauvorhaben"),
          temp: pick2("temp", 20, "Temperatur"),
          notes: pick2("notes", 5e3, "Leistungsergebnisse"),
          signer: pick2("signer", 100, "Name"),
          signer2: pick2("signer2", 100, "Name"),
          weather: JSON.stringify("weather" in b ? (Array.isArray(b.weather) ? b.weather : []).filter((w) => WEATHER.includes(w)) : JSON.parse(old.weather || "[]")),
          staff: JSON.stringify("staff" in b ? rows(b.staff, [["name", 80], ["hours", 10]], 30) : JSON.parse(old.staff || "[]")),
          machines: JSON.stringify("machines" in b ? rows(b.machines, [["name", 80], ["hours", 10]], 30) : JSON.parse(old.machines || "[]")),
          materials: JSON.stringify("materials" in b ? rows(b.materials, [["name", 120], ["qty", 20], ["unit", 20]], 40) : JSON.parse(old.materials || "[]")),
          signature: "signature" in b ? sig(b.signature) : old.signature || "",
          signature2: "signature2" in b ? sig(b.signature2) : old.signature2 || ""
        };
      }
      const reportOut = (r, full = true) => ({
        id: r.id,
        project_id: r.project_id,
        number: r.number,
        date: r.date,
        client: r.client,
        site: r.site,
        temp: r.temp,
        notes: r.notes,
        signer: r.signer,
        signer2: r.signer2,
        weather: JSON.parse(r.weather || "[]"),
        staff: JSON.parse(r.staff || "[]"),
        machines: JSON.parse(r.machines || "[]"),
        materials: JSON.parse(r.materials || "[]"),
        signed: !!r.signature,
        ...full ? { signature: r.signature, signature2: r.signature2 } : {},
        created_by: r.created_by,
        created_at: r.created_at,
        updated_at: r.updated_at
      });
      const num = (s) => Number(String(s).replace(",", ".")) || 0;
      route("GET", "/api/projects/:id/reports/prefill", async (c) => {
        const p = project(c.params.id), date = c.query.get("date");
        if (!isDate(date)) throw new HttpError(400, "Ung\xFCltiges Datum");
        const [y, m, d] = date.split("-").map(Number), from = new Date(y, m - 1, d).toISOString(), to = new Date(y, m - 1, d + 1).toISOString();
        const people = /* @__PURE__ */ new Map();
        for (const e of all("SELECT e.*, u.name, u.position FROM time_entries e JOIN users u ON u.id = e.user_id WHERE e.project_id = ? AND e.start >= ? AND e.start < ?", p.id, from, to)) {
          const min = Math.max(0, ((e.end ? Date.parse(e.end) : Math.min(Date.now(), Date.parse(to))) - Date.parse(e.start)) / 6e4);
          people.set(e.name, (people.get(e.name) || 0) + min);
        }
        send(c.res, 200, {
          client: p.customer || "",
          site: [p.name, p.address].filter(Boolean).join(", "),
          staff: [...people].map(([name, min]) => ({ name, hours: (Math.round(min / 6) / 10).toFixed(1).replace(".", ",") })),
          last: (() => {
            const l = row("SELECT * FROM daily_reports WHERE project_id = ? ORDER BY date DESC, id DESC LIMIT 1", p.id);
            return l ? { staff: JSON.parse(l.staff || "[]").map((s) => ({ name: s.name, hours: "" })), machines: JSON.parse(l.machines || "[]").map((s) => ({ name: s.name, hours: "" })) } : null;
          })()
        });
      });
      route("POST", "/api/projects/:id/reports", async (c) => {
        const p = project(c.params.id), f = reportFields(await readJson(c.req));
        const number = (row("SELECT MAX(number) n FROM daily_reports WHERE project_id = ?", p.id).n || 0) + 1;
        const r = run(
          "INSERT INTO daily_reports (project_id, number, date, client, site, weather, temp, staff, machines, materials, notes, signature, signature2, signer, signer2, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          p.id,
          number,
          f.date,
          f.client,
          f.site,
          f.weather,
          f.temp,
          f.staff,
          f.machines,
          f.materials,
          f.notes,
          f.signature,
          f.signature2,
          f.signer,
          f.signer2,
          c.user.id,
          now(),
          now()
        );
        event(p.id, c.user.id, `hat den Tagesbericht Nr. ${number} vom ${f.date.split("-").reverse().join(".")} erstellt`);
        send(c.res, 201, reportOut(row("SELECT * FROM daily_reports WHERE id = ?", r.lastInsertRowid)));
      });
      const report = (id) => {
        const r = row("SELECT * FROM daily_reports WHERE id = ?", Number(id));
        if (!r) throw new HttpError(404, "Bericht nicht gefunden");
        return r;
      };
      route("GET", "/api/reports/:id", async (c) => send(c.res, 200, reportOut(report(c.params.id))));
      route("PUT", "/api/reports/:id", async (c) => {
        const old = report(c.params.id), p = project(old.project_id);
        if (old.created_by !== c.user.id && !canManage(c.user, p)) throw new HttpError(403, "Den Bericht \xE4ndert, wer ihn erstellt hat, oder die Projektleitung");
        const f = reportFields(await readJson(c.req), old);
        run(
          "UPDATE daily_reports SET date=?, client=?, site=?, weather=?, temp=?, staff=?, machines=?, materials=?, notes=?, signature=?, signature2=?, signer=?, signer2=?, updated_at=? WHERE id=?",
          f.date,
          f.client,
          f.site,
          f.weather,
          f.temp,
          f.staff,
          f.machines,
          f.materials,
          f.notes,
          f.signature,
          f.signature2,
          f.signer,
          f.signer2,
          now(),
          old.id
        );
        send(c.res, 200, reportOut(report(old.id)));
      });
      route("DELETE", "/api/reports/:id", async (c) => {
        const old = report(c.params.id), p = project(old.project_id);
        if (old.created_by !== c.user.id && !canManage(c.user, p)) throw new HttpError(403, "Keine Berechtigung");
        run("DELETE FROM daily_reports WHERE id = ?", old.id);
        event(p.id, c.user.id, `hat den Tagesbericht Nr. ${old.number} gel\xF6scht`);
        send(c.res, 200, { ok: true });
      });
      route("GET", "/api/projects/:id/site", async (c) => {
        const p = project(c.params.id);
        const reports = all("SELECT * FROM daily_reports WHERE project_id = ? ORDER BY date DESC, id DESC LIMIT 400", p.id).map((r) => {
          const o = reportOut(r, false);
          return { ...o, hours: o.staff.reduce((n, s) => n + num(s.hours), 0) };
        });
        const site = isSite(c.user);
        send(c.res, 200, {
          folders: folders(p),
          files: all(`SELECT f.id, f.name, f.size, f.note, f.category, f.uploader_id, f.created_at, f.folder_id, f.taken_at, f.lat, f.lng,
        (SELECT COUNT(*) FROM project_comments k WHERE k.file_id = f.id AND k.kind = 'comment') AS comments FROM files f WHERE f.project_id = ? ORDER BY COALESCE(f.taken_at, f.created_at) DESC, f.id DESC`, p.id).filter((f) => !site || siteSees(c.user, f)),
          reports,
          hours: site ? { total: 0, users: [], days: [] } : hours(p),
          can_manage: !site && canManage(c.user, p)
        });
      });
      route("GET", "/api/site/home", async (c) => {
        const recent = all("SELECT project_id, MAX(start) last FROM time_entries WHERE user_id = ? AND project_id IS NOT NULL GROUP BY project_id ORDER BY last DESC LIMIT 5", c.user.id).map((r) => r.project_id);
        const mine = all("SELECT project_id, MAX(created_at) last FROM files WHERE uploader_id = ? AND ctx = 'project' GROUP BY project_id ORDER BY last DESC LIMIT 5", c.user.id).map((r) => r.project_id);
        const open = row("SELECT project_id FROM time_entries WHERE user_id = ? AND end IS NULL ORDER BY id DESC LIMIT 1", c.user.id);
        send(c.res, 200, { recent: [.../* @__PURE__ */ new Set([...open && open.project_id ? [open.project_id] : [], ...recent, ...mine])], current: open ? open.project_id : null, stamped: !!open });
      });
      route("GET", "/api/site/feed", async (c) => send(c.res, 200, {
        photos: all("SELECT f.id, f.name, f.note, f.uploader_id, f.project_id, COALESCE(f.taken_at, f.created_at) AS at, p.name AS project FROM files f JOIN projects p ON p.id = f.project_id WHERE f.category = 'image' ORDER BY f.id DESC LIMIT 8"),
        reports: all("SELECT r.id, r.number, r.date, r.project_id, r.created_by, p.name AS project FROM daily_reports r JOIN projects p ON p.id = r.project_id ORDER BY r.id DESC LIMIT 5"),
        present: all("SELECT e.user_id, u.name, e.start, e.project_id, p.name AS project FROM time_entries e JOIN users u ON u.id = e.user_id LEFT JOIN projects p ON p.id = e.project_id WHERE e.end IS NULL AND e.start >= ? ORDER BY e.start", new Date((/* @__PURE__ */ new Date()).setHours(0, 0, 0, 0)).toISOString())
      }));
      return { afterUpload };
    };
  }
});

// remote.js
var require_remote = __commonJS({
  "remote.js"(exports2, module2) {
    "use strict";
    var fs = require("node:fs");
    var path2 = require("node:path");
    var crypto = require("node:crypto");
    var { pipeline } = require("node:stream/promises");
    var { DatabaseSync } = require("node:sqlite");
    module2.exports = function install(x) {
      const { route, send, readJson, HttpError, db, DATA: DATA2, UPLOADS, now, getSetting, setSetting, audit, hasUsers, isLocal, backupDir, VERSION } = x;
      const SERVER = !!process.env.PORTAL_SERVER;
      const same = (a, b) => {
        const A = Buffer.from(String(a || "")), B = Buffer.from(String(b || ""));
        return A.length === B.length && A.length > 0 && crypto.timingSafeEqual(A, B);
      };
      const readTrim = (f) => {
        try {
          return fs.readFileSync(f, "utf8").trim();
        } catch {
          return "";
        }
      };
      const CODE_FILE = path2.join(DATA2, "einrichtungscode.txt");
      if (SERVER && !hasUsers() && !readTrim(CODE_FILE)) {
        const raw = crypto.randomBytes(9).toString("base64url").replace(/[-_]/g, "x").toUpperCase().slice(0, 12);
        fs.writeFileSync(CODE_FILE, raw.match(/.{4}/g).join("-") + "\n", { mode: 384 });
      }
      if (SERVER && !hasUsers()) console.log(`
  Einrichtungscode: ${readTrim(CODE_FILE)}
`);
      let fails = 0;
      function codeOk(code) {
        if (!SERVER || hasUsers() || fails >= 10) return false;
        const ok = same(String(code || "").trim().toUpperCase(), readTrim(CODE_FILE));
        if (!ok) fails++;
        return ok;
      }
      const codeSetup = () => SERVER && !hasUsers() && fails < 10 && !!readTrim(CODE_FILE);
      const needCode = (c) => {
        if (!codeOk(c.req.headers["x-setup-code"])) throw new HttpError(403, fails >= 10 ? "Zu viele Fehlversuche. Bitte den Dienst auf dem Server neu starten." : "Der Einrichtungscode stimmt nicht oder der Server ist bereits eingerichtet.");
      };
      const TOKEN_FILE = path2.join(DATA2, "sicherung-schluessel.txt");
      const backupToken = (create = true) => {
        let t = readTrim(TOKEN_FILE);
        if (!t && create) {
          t = crypto.randomBytes(24).toString("hex");
          fs.writeFileSync(TOKEN_FILE, t + "\n", { mode: 384 });
        }
        return t;
      };
      const needToken = (c) => {
        if (!same(c.req.headers["x-backup-token"], backupToken(false))) throw new HttpError(403, "Kein Zugriff");
      };
      route("GET", "/api/admin/backup/token", { admin: true }, async (c) => send(c.res, 200, { token: backupToken(), server: SERVER }));
      route("GET", "/api/backup/tree", { auth: false }, async (c) => {
        needToken(c);
        const root = backupDir(), files = [];
        const walk = async (dir, rel) => {
          let list = [];
          try {
            list = await fs.promises.readdir(dir, { withFileTypes: true });
          } catch {
            return;
          }
          for (const e of list) {
            if (files.length >= 3e5) return;
            const r = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) await walk(path2.join(dir, e.name), r);
            else if (e.isFile()) {
              const s = await fs.promises.stat(path2.join(dir, e.name));
              files.push({ p: r, s: s.size, m: Math.floor(s.mtimeMs) });
            }
          }
        };
        await walk(root, "");
        send(c.res, 200, { at: now(), last: (() => {
          try {
            return JSON.parse(getSetting("backup_last", "null"));
          } catch {
            return null;
          }
        })(), files });
      });
      route("GET", "/api/backup/get", { auth: false }, async (c) => {
        needToken(c);
        const root = path2.resolve(backupDir()), file = path2.resolve(root, String(c.query.get("p") || ""));
        if (!file.startsWith(root + path2.sep)) throw new HttpError(400, "Ung\xFCltiger Pfad");
        let st;
        try {
          st = await fs.promises.lstat(file);
        } catch {
          throw new HttpError(404, "Nicht gefunden");
        }
        if (!st.isFile()) throw new HttpError(404, "Nicht gefunden");
        c.res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": st.size, "Cache-Control": "no-store" });
        fs.createReadStream(file).pipe(c.res);
        c.handled = true;
      });
      const IMPORT = path2.join(DATA2, "umzug-eingang");
      const KINDS = { db: /^portal\.db$/, uploads: /^[0-9a-f]{32}$/, avatars: /^[\w.-]{1,80}$/, branding: /^[\w.-]{1,80}$/ };
      route("POST", "/api/migrate/begin", { auth: false }, async (c) => {
        needCode(c);
        fs.rmSync(IMPORT, { recursive: true, force: true });
        for (const k of Object.keys(KINDS)) fs.mkdirSync(path2.join(IMPORT, k), { recursive: true });
        send(c.res, 200, { ok: true, version: VERSION });
      });
      route("PUT", "/api/migrate/file", { auth: false }, async (c) => {
        needCode(c);
        const kind = c.query.get("kind"), name = String(c.query.get("name") || "");
        if (!KINDS[kind] || !KINDS[kind].test(name) || name.startsWith(".") || !fs.existsSync(path2.join(IMPORT, kind))) throw new HttpError(400, "Unbekannte Datei");
        const target = path2.join(IMPORT, kind, name);
        try {
          await pipeline(c.req, fs.createWriteStream(target));
        } catch {
          fs.rmSync(target, { force: true });
          throw new HttpError(400, "\xDCbertragung abgebrochen");
        }
        const size = fs.statSync(target).size;
        if (String(size) !== String(c.query.get("size"))) {
          fs.rmSync(target, { force: true });
          throw new HttpError(400, "Datei unvollst\xE4ndig \xFCbertragen");
        }
        send(c.res, 200, { ok: true, size });
      });
      route("POST", "/api/migrate/finish", { auth: false }, async (c) => {
        needCode(c);
        const file = path2.join(IMPORT, "db", "portal.db");
        if (!fs.existsSync(file)) throw new HttpError(400, "Die Datenbank fehlt");
        let users = 0;
        try {
          const imp = new DatabaseSync(file);
          if (imp.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") throw new Error("besch\xE4digt");
          const v = imp.prepare("PRAGMA user_version").get().user_version, mine = db.prepare("PRAGMA user_version").get().user_version;
          if (v > mine) throw new HttpError(409, "Der Server hat eine \xE4ltere Version als der Hauptrechner. Bitte zuerst den Server aktualisieren.");
          if (!imp.prepare("SELECT 1 FROM users WHERE role = 'admin' AND active = 1").get()) throw new HttpError(400, "In den Daten gibt es kein Administrator-Konto");
          users = imp.prepare("SELECT COUNT(*) n FROM users").get().n;
          imp.prepare("DELETE FROM settings WHERE key IN ('backup_dir', 'backup_last', 'public_url')").run();
          imp.prepare("INSERT INTO audit (at, actor, action, detail) VALUES (?,?,?,?)").run(now(), "Server", "Umzug auf den Server", `${users} Konten \xFCbernommen`);
          imp.close();
        } catch (e) {
          if (e instanceof HttpError) throw e;
          throw new HttpError(400, "Die \xFCbertragene Datenbank l\xE4sst sich nicht lesen. Bitte den Umzug erneut starten.");
        }
        const moveAll = (kind, dest) => {
          fs.mkdirSync(dest, { recursive: true });
          for (const n of fs.readdirSync(path2.join(IMPORT, kind))) fs.renameSync(path2.join(IMPORT, kind, n), path2.join(dest, n));
        };
        const token = backupToken();
        db.close();
        for (const ext of ["", "-wal", "-shm"]) fs.rmSync(path2.join(DATA2, "portal.db" + ext), { force: true });
        fs.renameSync(file, path2.join(DATA2, "portal.db"));
        moveAll("uploads", UPLOADS);
        moveAll("avatars", path2.join(DATA2, "avatars"));
        moveAll("branding", path2.join(DATA2, "branding"));
        fs.rmSync(IMPORT, { recursive: true, force: true });
        fs.rmSync(CODE_FILE, { force: true });
        send(c.res, 200, { ok: true, users, backup_token: token });
        console.log(`
  Umzug abgeschlossen: ${users} Konten \xFCbernommen. Der Dienst startet neu.`);
        setTimeout(() => process.exit(75), 500);
      });
      let job = null;
      const jobOut = () => job ? { state: job.state, done: job.done, total: job.total, bytes: job.bytes, totalBytes: job.totalBytes, error: job.error, url: job.url, token: job.state === "done" ? job.token : void 0 } : { state: "idle", moved_to: getSetting("moved_to", "") };
      function cleanUrl(input) {
        let u = String(input || "").trim();
        if (!u) throw new HttpError(400, "Bitte die Adresse des Servers angeben");
        if (!/^https?:\/\//i.test(u)) u = "https://" + u;
        let p;
        try {
          p = new URL(u);
        } catch {
          throw new HttpError(400, "Das ist keine g\xFCltige Adresse");
        }
        if (p.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(p.hostname)) throw new HttpError(400, "Die Adresse muss mit https:// beginnen");
        return p.origin;
      }
      async function runMove(url, code) {
        const H = { "x-setup-code": code };
        const call = async (method, p, opts = {}) => {
          let r;
          try {
            r = await fetch(url + p, { method, ...opts, headers: { ...H, ...opts.headers || {} } });
          } catch (e) {
            throw new Error(`Der Server ist nicht erreichbar (${e.cause?.code || e.message})`);
          }
          const d = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(d.error || `Der Server meldet einen Fehler (${r.status})`);
          return d;
        };
        const snap = path2.join(DATA2, "umzug.db");
        try {
          const info = await call("GET", "/api/setup");
          if (!info.code_setup) throw new Error(info.needed === false ? "Auf diesem Server ist das Portal bereits eingerichtet. Ein Umzug geht nur auf einen frischen Server." : "Unter dieser Adresse l\xE4uft kein Betriebsportal-Server, der auf einen Umzug wartet.");
          await call("POST", "/api/migrate/begin");
          fs.rmSync(snap, { force: true });
          db.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`);
          const list = [{ kind: "db", name: "portal.db", file: snap }];
          const add = (kind, dir) => {
            if (!fs.existsSync(dir)) return;
            for (const n of fs.readdirSync(dir)) {
              const f = path2.join(dir, n);
              if (KINDS[kind].test(n) && fs.statSync(f).isFile()) list.push({ kind, name: n, file: f });
            }
          };
          add("uploads", UPLOADS);
          add("avatars", path2.join(DATA2, "avatars"));
          add("branding", path2.join(DATA2, "branding"));
          for (const f of list) f.size = fs.statSync(f.file).size;
          job.total = list.length;
          job.totalBytes = list.reduce((n, f) => n + f.size, 0);
          job.state = "upload";
          for (const f of list) {
            const body = f.size ? await fs.openAsBlob(f.file) : new Blob([]);
            await call("PUT", `/api/migrate/file?kind=${f.kind}&name=${encodeURIComponent(f.name)}&size=${f.size}`, { body, headers: { "Content-Type": "application/octet-stream" } });
            job.done++;
            job.bytes += f.size;
          }
          job.state = "finish";
          const r = await call("POST", "/api/migrate/finish");
          job.token = r.backup_token;
          job.state = "done";
          setSetting("moved_to", url);
          audit(job.by, "Umzug auf den Server abgeschlossen", url);
        } catch (e) {
          job.state = "error";
          job.error = e.message;
        } finally {
          fs.rmSync(snap, { force: true });
        }
      }
      route("GET", "/api/admin/move", { admin: true }, async (c) => send(c.res, 200, jobOut()));
      route("POST", "/api/admin/move", { admin: true }, async (c) => {
        if (SERVER || !isLocal(c.req)) throw new HttpError(403, "Der Umzug wird direkt am Hauptrechner gestartet");
        if (job && ["start", "upload", "finish"].includes(job.state)) throw new HttpError(409, "Der Umzug l\xE4uft bereits");
        const b = await readJson(c.req), url = cleanUrl(b.url), code = String(b.code || "").trim().toUpperCase();
        if (!code) throw new HttpError(400, "Bitte den Einrichtungscode des Servers eingeben");
        job = { state: "start", done: 0, total: 0, bytes: 0, totalBytes: 0, error: null, url, by: c.user.name };
        runMove(url, code);
        send(c.res, 200, jobOut());
      });
      return { codeOk, codeSetup, SERVER };
    };
  }
});

// timecard.js
var require_timecard = __commonJS({
  "timecard.js"(exports2, module2) {
    "use strict";
    var crypto = require("node:crypto");
    var os2 = require("node:os");
    var pad = (n) => String(n).padStart(2, "0");
    var ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    var parseD = (s) => {
      const [y, m, d] = s.split("-").map(Number);
      return new Date(y, m - 1, d);
    };
    var addDays = (s, n) => {
      const d = parseD(s);
      d.setDate(d.getDate() + n);
      return ymd(d);
    };
    var weekday = (s) => parseD(s).getDay() || 7;
    var dayStartIso = (s) => parseD(s).toISOString();
    var STATES = {
      BW: "Baden-W\xFCrttemberg",
      BY: "Bayern",
      BE: "Berlin",
      BB: "Brandenburg",
      HB: "Bremen",
      HH: "Hamburg",
      HE: "Hessen",
      MV: "Mecklenburg-Vorpommern",
      NI: "Niedersachsen",
      NW: "Nordrhein-Westfalen",
      RP: "Rheinland-Pfalz",
      SL: "Saarland",
      SN: "Sachsen",
      ST: "Sachsen-Anhalt",
      SH: "Schleswig-Holstein",
      TH: "Th\xFCringen"
    };
    function easter(y) {
      const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
      const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
      return new Date(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, (h + l - 7 * m + 114) % 31 + 1);
    }
    var holidayCache = /* @__PURE__ */ new Map();
    function holidays(year, st) {
      const key = `${year}-${st}`;
      if (holidayCache.has(key)) return holidayCache.get(key);
      const m = /* @__PURE__ */ new Map(), E = easter(year);
      const fix = (mo, d, name) => m.set(`${year}-${pad(mo)}-${pad(d)}`, name);
      const rel = (n, name) => {
        const d = new Date(E);
        d.setDate(d.getDate() + n);
        m.set(ymd(d), name);
      };
      const inSt = (...list) => list.includes(st);
      fix(1, 1, "Neujahr");
      rel(-2, "Karfreitag");
      rel(1, "Ostermontag");
      fix(5, 1, "Tag der Arbeit");
      rel(39, "Christi Himmelfahrt");
      rel(50, "Pfingstmontag");
      fix(10, 3, "Tag der Deutschen Einheit");
      fix(12, 25, "1. Weihnachtstag");
      fix(12, 26, "2. Weihnachtstag");
      if (inSt("BW", "BY", "ST")) fix(1, 6, "Heilige Drei K\xF6nige");
      if (inSt("BE", "MV")) fix(3, 8, "Internationaler Frauentag");
      if (inSt("BW", "BY", "HE", "NW", "RP", "SL")) rel(60, "Fronleichnam");
      if (inSt("SL")) fix(8, 15, "Mari\xE4 Himmelfahrt");
      if (inSt("TH")) fix(9, 20, "Weltkindertag");
      if (inSt("BB", "HB", "HH", "MV", "NI", "SN", "ST", "SH", "TH")) fix(10, 31, "Reformationstag");
      if (inSt("BW", "BY", "NW", "RP", "SL")) fix(11, 1, "Allerheiligen");
      if (inSt("SN")) {
        const d = new Date(year, 10, 22);
        while (d.getDay() !== 3) d.setDate(d.getDate() - 1);
        m.set(ymd(d), "Bu\xDF- und Bettag");
      }
      holidayCache.set(key, m);
      return m;
    }
    module2.exports = function install(x) {
      const { route, send, readJson, HttpError, db, now, str, isDate, intOrNull, getSetting, setSetting, audit, PORT } = x;
      const row = (sql, ...a) => db.prepare(sql).get(...a);
      const all = (sql, ...a) => db.prepare(sql).all(...a);
      const run = (sql, ...a) => db.prepare(sql).run(...a);
      const cfg = () => ({
        state: STATES[getSetting("time_state")] ? getSetting("time_state") : "NW",
        auto_break: getSetting("time_auto_break", "1") === "1",
        // gesetzliche Pause automatisch abziehen, wenn nicht gestempelt
        // Stempeln per Knopf: 'all' = Kommen und Gehen, 'out' = nur Gehen (Kommen nur per QR-Code an der Tür), 'none' = alles nur per QR-Code
        manual: { 1: "all", 0: "none", all: "all", none: "none" }[getSetting("time_manual", "out")] || "out",
        public_url: getSetting("public_url", "")
      });
      const lanUrl = () => {
        const a = Object.values(os2.networkInterfaces()).flat().find((n) => n && n.family === "IPv4" && !n.internal);
        return `http://${a ? a.address : "localhost"}:${PORT}`;
      };
      const publicUrl = () => (cfg().public_url || process.env.PUBLIC_URL || lanUrl()).replace(/\/+$/, "");
      const holidayName = (date) => holidays(Number(date.slice(0, 4)), cfg().state).get(date) || null;
      const workdaysOf = (u) => String(u.workdays || "1,2,3,4,5").split(",").map(Number).filter((n) => n >= 1 && n <= 7);
      function targetMin(u, date) {
        const wd = workdaysOf(u);
        if (!wd.length || !wd.includes(weekday(date)) || holidayName(date)) return 0;
        return Math.round((Number(u.weekly_hours) || 0) * 60 / wd.length);
      }
      function days(u, from, to, live = true) {
        const entries = all("SELECT * FROM time_entries WHERE user_id = ? AND start >= ? AND start < ? ORDER BY start", u.id, dayStartIso(from), dayStartIso(addDays(to, 1)));
        const abs = all("SELECT * FROM absences WHERE user_id = ? AND status = 'approved' AND date_start <= ? AND date_end >= ?", u.id, to, from);
        const today = ymd(/* @__PURE__ */ new Date()), auto = cfg().auto_break, out = [], s0 = startOf(u);
        for (let d = from; d <= to; d = addDays(d, 1)) {
          const list = entries.filter((e) => ymd(new Date(e.start)) === d).map((e) => {
            const open = !e.end;
            const end = open ? live && d === today ? Date.now() : null : Date.parse(e.end);
            return { id: e.id, start: e.start, end: e.end, open, min: end === null ? 0 : Math.max(0, Math.round((end - Date.parse(e.start)) / 6e4)), _end: end, project_id: e.project_id, source: e.source, review: !!e.review || open && d !== today, note: e.note };
          });
          const gross = list.reduce((n, e) => n + e.min, 0);
          let gaps = 0;
          for (let i = 1; i < list.length; i++) if (list[i - 1]._end !== null) gaps += Math.max(0, Math.round((Date.parse(list[i].start) - list[i - 1]._end) / 6e4));
          const required = gross > 9 * 60 ? 45 : gross > 6 * 60 ? 30 : 0;
          const deduct = auto ? Math.max(0, required - gaps) : 0;
          const worked = Math.max(0, gross - deduct);
          const target = d < s0 ? 0 : targetMin(u, d);
          const a = abs.find((v) => v.date_start <= d && v.date_end >= d) || null;
          const credit = a && target && a.type !== "comp" ? a.half ? Math.round(target / 2) : target : 0;
          list.forEach((e) => delete e._end);
          out.push({ date: d, weekday: weekday(d), holiday: holidayName(d), target, entries: list, gross, pause: gaps + deduct, deducted: deduct, worked, absence: a ? { type: a.type, half: !!a.half } : null, credit, diff: worked + credit - target });
        }
        return out;
      }
      const sum = (list, k) => list.reduce((n, d) => n + d[k], 0);
      function startOf(u) {
        if (isDate(u.time_start)) return u.time_start;
        const first = row("SELECT MIN(start) s FROM time_entries WHERE user_id = ?", u.id).s;
        return first ? ymd(new Date(first)) : addDays(ymd(/* @__PURE__ */ new Date()), 1);
      }
      function balance(u) {
        const from = startOf(u), to = addDays(ymd(/* @__PURE__ */ new Date()), -1);
        const carry = Math.round((Number(u.overtime_start) || 0) * 60);
        return from > to ? carry : carry + sum(days(u, from, to, false), "diff");
      }
      function vacationDays(u, a, from, to) {
        let n = 0;
        for (let d = a.date_start < from ? from : a.date_start; d <= a.date_end && d <= to; d = addDays(d, 1)) if (targetMin(u, d) > 0) n += a.half ? 0.5 : 1;
        return n;
      }
      function vacation(u, year = (/* @__PURE__ */ new Date()).getFullYear()) {
        const from = `${year}-01-01`, to = `${year}-12-31`;
        const list = all("SELECT * FROM absences WHERE user_id = ? AND type = 'vacation' AND status IN ('approved','pending') AND date_start <= ? AND date_end >= ?", u.id, to, from);
        const taken = list.filter((a) => a.status === "approved").reduce((n, a) => n + vacationDays(u, a, from, to), 0);
        const pending = list.filter((a) => a.status === "pending").reduce((n, a) => n + vacationDays(u, a, from, to), 0);
        const entitled = Number(u.vacation_days) || 0;
        return { year, entitled, taken, pending, remaining: entitled - taken };
      }
      const openEntry = (uid) => row("SELECT * FROM time_entries WHERE user_id = ? AND end IS NULL ORDER BY id DESC LIMIT 1", uid);
      const projectName = (id) => {
        const p = id && row("SELECT number, name FROM projects WHERE id = ?", id);
        return p ? `${p.number} ${p.name}` : null;
      };
      function status(u) {
        const today = ymd(/* @__PURE__ */ new Date());
        const monday = addDays(today, 1 - weekday(today)), first = today.slice(0, 8) + "01";
        const from = monday < first ? monday : first;
        const list = days(u, from, today);
        const t = list[list.length - 1], open = openEntry(u.id);
        return {
          open: open ? { id: open.id, start: open.start, project_id: open.project_id, project: projectName(open.project_id), stale: ymd(new Date(open.start)) !== today } : null,
          today: { worked: t.worked, target: t.target, pause: t.pause, holiday: t.holiday, absence: t.absence },
          week: { worked: sum(list.filter((d) => d.date >= monday), "worked"), target: sum(list.filter((d) => d.date >= monday), "target") },
          month: { worked: sum(list.filter((d) => d.date >= first), "worked") + sum(list.filter((d) => d.date >= first), "credit"), target: sum(list.filter((d) => d.date >= first), "target") },
          balance: balance(u),
          vacation: vacation(u),
          manual: cfg().manual,
          work: { weekly_hours: u.weekly_hours, workdays: workdaysOf(u), vacation_days: u.vacation_days, time_start: startOf(u), overtime_start: u.overtime_start }
        };
      }
      const userOr404 = (id) => {
        const u = row("SELECT * FROM users WHERE id = ?", Number(id));
        if (!u) throw new HttpError(404, "Konto nicht gefunden");
        return u;
      };
      const subject = (c) => {
        const id = intOrNull(c.query.get("user"));
        if (id === null || id === c.user.id) return c.user;
        if (c.user.role !== "admin") throw new HttpError(403, "Nur f\xFCr Administratoren");
        return userOr404(id);
      };
      const windowNow = () => Math.floor(Date.now() / 3e4);
      const rotating = (st, w) => crypto.createHmac("sha256", st.secret).update(String(w)).digest("hex").slice(0, 12);
      const stationCode = (st) => st.mode === "rotating" ? rotating(st, windowNow()) : st.token;
      function checkStation(id, token) {
        const st = row("SELECT * FROM time_stations WHERE id = ? AND active = 1", Number(id));
        if (!st) throw new HttpError(404, "Diese Stempelstelle gibt es nicht mehr. Bitte den aktuellen QR-Code scannen.");
        const t = String(token || "");
        const ok = st.mode === "rotating" ? [0, 1, 2, 3, 4].some((k) => rotating(st, windowNow() - k) === t) : t.length === st.token.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(st.token));
        if (!ok) throw new HttpError(403, st.mode === "rotating" ? "Dieser QR-Code ist abgelaufen. Bitte den Code noch einmal vom Bildschirm scannen." : "Dieser QR-Code ist nicht mehr g\xFCltig.");
        return st;
      }
      const stationOut = (st) => ({
        id: st.id,
        name: st.name,
        project_id: st.project_id,
        project: projectName(st.project_id),
        mode: st.mode,
        active: !!st.active,
        url: `${publicUrl()}/#/stempeln/${st.id}/${stationCode(st)}`,
        display: `${publicUrl()}/terminal.html?id=${st.id}&s=${st.secret}`
      });
      route("GET", "/api/time/stations", { admin: true }, async (c) => send(c.res, 200, { stations: all("SELECT * FROM time_stations ORDER BY active DESC, name COLLATE NOCASE").map(stationOut), public_url: publicUrl(), lan_url: lanUrl() }));
      function stationFields(b) {
        const pid = intOrNull(b.project_id);
        return { name: str(b.name, 80, { required: true, label: "Name" }), project_id: pid !== null && row("SELECT 1 FROM projects WHERE id = ?", pid) ? pid : null, mode: b.mode === "rotating" ? "rotating" : "static" };
      }
      route("POST", "/api/time/stations", { admin: true }, async (c) => {
        const f = stationFields(await readJson(c.req));
        const r = run("INSERT INTO time_stations (name, project_id, mode, token, secret, created_at) VALUES (?,?,?,?,?,?)", f.name, f.project_id, f.mode, crypto.randomBytes(9).toString("hex"), crypto.randomBytes(16).toString("hex"), now());
        audit(c.user.name, "Stempelstelle angelegt", f.name);
        send(c.res, 201, stationOut(row("SELECT * FROM time_stations WHERE id = ?", r.lastInsertRowid)));
      });
      route("PUT", "/api/time/stations/:id", { admin: true }, async (c) => {
        const st = row("SELECT * FROM time_stations WHERE id = ?", Number(c.params.id));
        if (!st) throw new HttpError(404, "Nicht gefunden");
        const b = await readJson(c.req), f = stationFields({ ...st, ...b });
        run("UPDATE time_stations SET name = ?, project_id = ?, mode = ?, active = ? WHERE id = ?", f.name, f.project_id, f.mode, b.active === false ? 0 : 1, st.id);
        if (b.renew) {
          run("UPDATE time_stations SET token = ?, secret = ? WHERE id = ?", crypto.randomBytes(9).toString("hex"), crypto.randomBytes(16).toString("hex"), st.id);
          audit(c.user.name, "QR-Code erneuert", st.name);
        }
        send(c.res, 200, stationOut(row("SELECT * FROM time_stations WHERE id = ?", st.id)));
      });
      route("DELETE", "/api/time/stations/:id", { admin: true }, async (c) => {
        run("DELETE FROM time_stations WHERE id = ?", Number(c.params.id));
        send(c.res, 200, { ok: true });
      });
      route("GET", "/api/time/display/:id", { auth: false }, async (c) => {
        const st = row("SELECT * FROM time_stations WHERE id = ? AND active = 1", Number(c.params.id));
        if (!st || c.query.get("s") !== st.secret) throw new HttpError(404, "Stempelstelle nicht gefunden");
        send(c.res, 200, { name: st.name, project: projectName(st.project_id), mode: st.mode, url: `${publicUrl()}/#/stempeln/${st.id}/${stationCode(st)}`, company: getSetting("company_name", ""), next: 30 - Math.floor(Date.now() / 1e3) % 30 });
      });
      route("GET", "/api/time/me", async (c) => send(c.res, 200, status(c.user)));
      route("POST", "/api/time/stamp", async (c) => {
        const b = await readJson(c.req);
        let st = null;
        if (b.station) st = checkStation(b.station, b.token);
        else if (cfg().manual === "none") throw new HttpError(403, "Stempeln ist nur \xFCber den QR-Code m\xF6glich.");
        else if (cfg().manual === "out" && !openEntry(c.user.id)) throw new HttpError(403, "Zum Einstempeln bitte den QR-Code an der T\xFCr scannen.");
        const t = now(), today = ymd(/* @__PURE__ */ new Date());
        let open = openEntry(c.user.id), action;
        if (open && ymd(new Date(open.start)) !== today) {
          const end = parseD(ymd(new Date(open.start)));
          end.setHours(23, 59, 0, 0);
          run("UPDATE time_entries SET end = ?, review = 1, note = TRIM(note || ' Nicht ausgestempelt \u2013 bitte pr\xFCfen.') WHERE id = ?", end.toISOString(), open.id);
          open = null;
        }
        const last = row("SELECT * FROM time_entries WHERE user_id = ? ORDER BY COALESCE(end, start) DESC LIMIT 1", c.user.id);
        if (st && last && Date.now() - Date.parse(last.end || last.start) < 2e4) action = "repeat";
        else if (open) {
          run("UPDATE time_entries SET end = ? WHERE id = ?", t, open.id);
          action = "out";
        } else {
          run("INSERT INTO time_entries (user_id, start, project_id, station_id, source, created_at) VALUES (?,?,?,?,?,?)", c.user.id, t, st ? st.project_id : null, st ? st.id : null, st ? "qr" : "app", t);
          action = "in";
        }
        send(c.res, 200, { action, at: t, station: st ? st.name : null, project: st ? projectName(st.project_id) : null, status: status(c.user) });
      });
      route("POST", "/api/time/undo", async (c) => {
        const last = row("SELECT * FROM time_entries WHERE user_id = ? ORDER BY COALESCE(end, start) DESC LIMIT 1", c.user.id);
        if (!last || Date.now() - Date.parse(last.end || last.start) > 5 * 6e4 || last.source === "admin") throw new HttpError(400, "R\xFCckg\xE4ngig geht nur in den ersten f\xFCnf Minuten nach dem Stempeln.");
        if (last.end) run("UPDATE time_entries SET end = NULL WHERE id = ?", last.id);
        else run("DELETE FROM time_entries WHERE id = ?", last.id);
        send(c.res, 200, { status: status(c.user) });
      });
      route("GET", "/api/time/days", async (c) => {
        const u = subject(c), from = c.query.get("from"), to = c.query.get("to");
        if (!isDate(from) || !isDate(to) || to < from || addDays(from, 400) < to) throw new HttpError(400, "Ung\xFCltiger Zeitraum");
        send(c.res, 200, {
          user: { id: u.id, name: u.name },
          days: days(u, from, to),
          balance: balance(u),
          vacation: vacation(u),
          start: startOf(u),
          work: { weekly_hours: u.weekly_hours, workdays: workdaysOf(u), vacation_days: u.vacation_days, time_start: startOf(u), overtime_start: u.overtime_start, kind: u.kind === "site" ? "site" : "office" }
        });
      });
      function entryFields(b) {
        const s = new Date(b.start), e = b.end ? new Date(b.end) : null;
        if (isNaN(s) || e && isNaN(e)) throw new HttpError(400, "Bitte g\xFCltige Zeiten angeben");
        if (e && e <= s) throw new HttpError(400, "Das Ende muss nach dem Beginn liegen");
        if (e && e - s > 24 * 36e5) throw new HttpError(400, "Eine Buchung darf h\xF6chstens 24 Stunden dauern");
        if (s > new Date(Date.now() + 6e4)) throw new HttpError(400, "Der Beginn liegt in der Zukunft");
        const pid = intOrNull(b.project_id);
        return { start: s.toISOString(), end: e ? e.toISOString() : null, note: str(b.note, 300, { label: "Notiz" }), project_id: pid !== null && row("SELECT 1 FROM projects WHERE id = ?", pid) ? pid : null };
      }
      const fmt = (iso) => iso ? new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "offen";
      route("POST", "/api/time/entries", { admin: true }, async (c) => {
        const b = await readJson(c.req), u = userOr404(b.user_id), f = entryFields(b);
        run("INSERT INTO time_entries (user_id, start, end, project_id, source, note, created_at, edited_by, edited_at) VALUES (?,?,?,?,'admin',?,?,?,?)", u.id, f.start, f.end, f.project_id, f.note, now(), c.user.id, now());
        audit(c.user.name, "Arbeitszeit nachgetragen", `${u.name}: ${fmt(f.start)} \u2013 ${fmt(f.end)}`);
        send(c.res, 201, { ok: true });
      });
      route("PUT", "/api/time/entries/:id", { admin: true }, async (c) => {
        const old = row("SELECT * FROM time_entries WHERE id = ?", Number(c.params.id));
        if (!old) throw new HttpError(404, "Nicht gefunden");
        const f = entryFields(await readJson(c.req)), u = userOr404(old.user_id);
        run("UPDATE time_entries SET start = ?, end = ?, project_id = ?, note = ?, review = 0, edited_by = ?, edited_at = ? WHERE id = ?", f.start, f.end, f.project_id, f.note, c.user.id, now(), old.id);
        audit(c.user.name, "Arbeitszeit korrigiert", `${u.name}: ${fmt(old.start)} \u2013 ${fmt(old.end)} \u2192 ${fmt(f.start)} \u2013 ${fmt(f.end)}`);
        send(c.res, 200, { ok: true });
      });
      route("DELETE", "/api/time/entries/:id", { admin: true }, async (c) => {
        const old = row("SELECT * FROM time_entries WHERE id = ?", Number(c.params.id));
        if (!old) throw new HttpError(404, "Nicht gefunden");
        run("DELETE FROM time_entries WHERE id = ?", old.id);
        audit(c.user.name, "Arbeitszeit gel\xF6scht", `${userOr404(old.user_id).name}: ${fmt(old.start)} \u2013 ${fmt(old.end)}`);
        send(c.res, 200, { ok: true });
      });
      route("PUT", "/api/users/:id/work", { admin: true }, async (c) => {
        const u = userOr404(c.params.id), b = await readJson(c.req);
        const hours = Number(String(b.weekly_hours).replace(",", ".")), vac = Number(String(b.vacation_days).replace(",", ".")), carry = Number(String(b.overtime_start || 0).replace(",", "."));
        if (!(hours >= 0 && hours <= 80)) throw new HttpError(400, "Wochenstunden bitte zwischen 0 und 80 angeben");
        if (!(vac >= 0 && vac <= 60)) throw new HttpError(400, "Urlaubstage bitte zwischen 0 und 60 angeben");
        if (!(Math.abs(carry) <= 2e3)) throw new HttpError(400, "Ung\xFCltiger \xDCbertrag");
        const wd = [...new Set((Array.isArray(b.workdays) ? b.workdays : []).map(Number).filter((n) => n >= 1 && n <= 7))].sort();
        if (b.time_start && !isDate(b.time_start)) throw new HttpError(400, "Ung\xFCltiges Datum");
        run("UPDATE users SET weekly_hours = ?, workdays = ?, vacation_days = ?, time_start = ?, overtime_start = ? WHERE id = ?", hours, wd.join(","), vac, b.time_start || null, carry, u.id);
        if ("kind" in b) run("UPDATE users SET kind = ? WHERE id = ?", b.kind === "site" ? "site" : "office", u.id);
        audit(c.user.name, "Arbeitszeit-Vorgaben ge\xE4ndert", `${u.name}: ${hours} Std./Woche, ${vac} Urlaubstage`);
        send(c.res, 200, { ok: true });
      });
      const monthRange = (m) => {
        if (!/^\d{4}-\d{2}$/.test(m || "")) throw new HttpError(400, "Ung\xFCltiger Monat");
        const from = `${m}-01`, d = parseD(from);
        d.setMonth(d.getMonth() + 1);
        d.setDate(0);
        return { from, to: ymd(d) };
      };
      route("GET", "/api/time/overview", { admin: true }, async (c) => {
        const { from, to } = monthRange(c.query.get("month"));
        const today = ymd(/* @__PURE__ */ new Date());
        const list = all("SELECT * FROM users WHERE pending = 0 ORDER BY active DESC, name COLLATE NOCASE").map((u) => {
          const d = days(u, from, to < today ? to : from > today ? from : today).filter((v) => v.date >= startOf(u));
          const count = (type) => d.filter((v) => v.absence && v.absence.type === type && v.target > 0).reduce((n, v) => n + (v.absence.half ? 0.5 : 1), 0);
          const open = openEntry(u.id);
          return {
            id: u.id,
            name: u.name,
            active: !!u.active,
            weekly_hours: u.weekly_hours,
            target: sum(d, "target"),
            worked: sum(d, "worked"),
            credit: sum(d, "credit"),
            diff: sum(d, "diff"),
            vacation: count("vacation"),
            sick: count("sick"),
            review: d.some((v) => v.entries.some((e) => e.review)),
            balance: balance(u),
            remaining: vacation(u).remaining,
            present: !!open && ymd(new Date(open.start)) === today
          };
        });
        send(c.res, 200, { from, to, users: list, settings: { ...cfg(), states: STATES, public_url_effective: publicUrl() } });
      });
      const h = (min) => (min / 60).toFixed(2).replace(".", ",");
      route("GET", "/api/time/export", { admin: true }, async (c) => {
        const { from, to } = monthRange(c.query.get("month"));
        const WD = ["", "Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"], AB = { vacation: "Urlaub", sick: "Krank", other: "Abwesend", comp: "\xDCberstunden-Ausgleich" };
        const clock = (iso) => iso ? new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "";
        const rows = [["Mitarbeiter", "Datum", "Tag", "Kommen", "Gehen", "Pause (Min.)", "Ist (Std.)", "Soll (Std.)", "Gutschrift (Std.)", "Abwesenheit", "Feiertag", "Saldo (Std.)"]];
        for (const u of all("SELECT * FROM users WHERE pending = 0 ORDER BY name COLLATE NOCASE")) {
          const d = days(u, from, to, false);
          if (!d.some((v) => v.entries.length || v.absence)) continue;
          for (const v of d) rows.push([
            u.name,
            v.date.split("-").reverse().join("."),
            WD[v.weekday],
            v.entries.map((e) => clock(e.start)).join(" / "),
            v.entries.map((e) => clock(e.end)).join(" / "),
            v.pause,
            h(v.worked),
            h(v.target),
            h(v.credit),
            v.absence ? AB[v.absence.type] + (v.absence.half ? " (halber Tag)" : "") : "",
            v.holiday || "",
            h(v.diff)
          ]);
          rows.push([u.name, "Summe", "", "", "", sum(d, "pause"), h(sum(d, "worked")), h(sum(d, "target")), h(sum(d, "credit")), "", "", h(sum(d, "diff"))]);
        }
        const csv = "\uFEFF" + rows.map((r) => r.map((v) => {
          const s = String(v ?? "");
          return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        }).join(";")).join("\r\n") + "\r\n";
        c.res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="Arbeitszeiten-${from.slice(0, 7)}.csv"`, "Cache-Control": "no-store" });
        c.res.end(csv);
      });
      route("PUT", "/api/admin/time", { admin: true }, async (c) => {
        const b = await readJson(c.req);
        if ("state" in b) {
          if (!STATES[b.state]) throw new HttpError(400, "Unbekanntes Bundesland");
          setSetting("time_state", b.state);
          holidayCache.clear();
        }
        if ("auto_break" in b) setSetting("time_auto_break", b.auto_break ? "1" : "0");
        if ("manual" in b) setSetting("time_manual", ["all", "out", "none"].includes(b.manual) ? b.manual : b.manual ? "all" : "none");
        if ("public_url" in b) {
          const u = str(b.public_url, 200, { label: "Adresse" }).replace(/\/+$/, "");
          if (u && !/^https?:\/\/[^\s/]+$/i.test(u)) throw new HttpError(400, "Bitte eine Adresse wie http://192.168.1.20:3000 oder https://portal.firma.de angeben");
          setSetting("public_url", u);
        }
        audit(c.user.name, "Zeiterfassung: Einstellungen ge\xE4ndert");
        send(c.res, 200, { ...cfg(), public_url_effective: publicUrl() });
      });
      const TYPES = ["vacation", "sick", "other", "comp"];
      const LABEL = { vacation: "Urlaub", sick: "Krankmeldung", other: "Abwesenheit", comp: "\xDCberstunden-Ausgleich" };
      const span = (a) => {
        const f = (d) => d.split("-").reverse().join(".");
        return a.date_start === a.date_end ? `am ${f(a.date_start)}${a.half ? " (halber Tag)" : ""}` : `vom ${f(a.date_start)} bis ${f(a.date_end)}`;
      };
      const tell = (from, to, text) => {
        if (from !== to) run("INSERT INTO messages (sender_id, recipient_id, body, created_at) VALUES (?,?,?,?)", from, to, text, now());
      };
      const tellAdmins = (from, text) => all("SELECT id FROM users WHERE role = 'admin' AND active = 1 AND pending = 0").forEach((a) => tell(from, a.id, text));
      const absOut = (a, u) => ({
        ...a,
        half: !!a.half,
        days: a.type === "vacation" ? vacationDays(u, a, a.date_start, a.date_end) : null,
        file: a.file_id ? row("SELECT id, name, size FROM files WHERE id = ?", a.file_id) || null : null
      });
      route("GET", "/api/absences", async (c) => {
        if (c.query.get("all") && c.user.role === "admin") {
          const users = new Map(all("SELECT * FROM users").map((u2) => [u2.id, u2]));
          return send(c.res, 200, all("SELECT * FROM absences WHERE date_end >= ? OR status = 'pending' ORDER BY status = 'pending' DESC, date_start DESC LIMIT 300", addDays(ymd(/* @__PURE__ */ new Date()), -120)).filter((a) => users.has(a.user_id)).map((a) => ({ ...absOut(a, users.get(a.user_id)), user_name: users.get(a.user_id).name })));
        }
        const u = subject(c);
        send(c.res, 200, all("SELECT * FROM absences WHERE user_id = ? ORDER BY date_start DESC LIMIT 200", u.id).map((a) => absOut(a, u)));
      });
      route("GET", "/api/absences/calendar", async (c) => {
        const from = c.query.get("from"), to = c.query.get("to");
        if (!isDate(from) || !isDate(to)) throw new HttpError(400, "from/to erforderlich");
        send(c.res, 200, all("SELECT a.id, a.user_id, a.type, a.date_start, a.date_end, a.half, u.name FROM absences a JOIN users u ON u.id = a.user_id WHERE a.status = 'approved' AND a.date_start <= ? AND a.date_end >= ?", to, from).map((a) => ({ id: a.id, user_id: a.user_id, date_start: a.date_start, date_end: a.date_end, title: `${a.type === "vacation" ? "Urlaub" : "Abwesend"}: ${a.name}${a.half ? " (halber Tag)" : ""}` })));
      });
      route("POST", "/api/absences", async (c) => {
        const b = await readJson(c.req);
        const forOther = b.user_id && Number(b.user_id) !== c.user.id;
        if (forOther && c.user.role !== "admin") throw new HttpError(403, "Nur f\xFCr Administratoren");
        const who = forOther ? userOr404(b.user_id) : c.user;
        if (!TYPES.includes(b.type)) throw new HttpError(400, "Unbekannte Art");
        if (!isDate(b.date_start) || !isDate(b.date_end || b.date_start)) throw new HttpError(400, "Bitte ein g\xFCltiges Datum angeben");
        const from = b.date_start, to = b.date_end || b.date_start;
        if (to < from) throw new HttpError(400, "Das Ende darf nicht vor dem Beginn liegen");
        if (addDays(from, 370) < to) throw new HttpError(400, "Der Zeitraum ist zu lang");
        const half = b.half && from === to ? 1 : 0;
        if (row("SELECT 1 FROM absences WHERE user_id = ? AND status != 'rejected' AND date_start <= ? AND date_end >= ?", who.id, to, from)) throw new HttpError(409, "In diesem Zeitraum ist bereits eine Abwesenheit eingetragen");
        const fileId = intOrNull(b.file_id);
        if (fileId !== null && !row("SELECT 1 FROM files WHERE id = ? AND ctx = 'personal' AND owner_id = ?", fileId, who.id)) throw new HttpError(400, "Anhang nicht gefunden");
        if (b.type === "vacation") {
          const v = vacation(who, Number(from.slice(0, 4))), need = vacationDays(who, { date_start: from, date_end: to, half }, from, to);
          if (need === 0) throw new HttpError(400, "In diesem Zeitraum liegt kein Arbeitstag");
          if (need > v.remaining - v.pending) throw new HttpError(400, `Daf\xFCr reicht der Resturlaub nicht: ben\xF6tigt ${String(need).replace(".", ",")} Tage, verf\xFCgbar ${String(v.remaining - v.pending).replace(".", ",")}`);
        }
        const st = b.type === "sick" || forOther ? "approved" : "pending";
        const r = run("INSERT INTO absences (user_id, type, date_start, date_end, half, status, note, file_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)", who.id, b.type, from, to, half, st, str(b.note, 500, { label: "Notiz" }), fileId, now());
        const a = row("SELECT * FROM absences WHERE id = ?", r.lastInsertRowid);
        if (forOther) {
          run("UPDATE absences SET decided_by = ?, decided_at = ? WHERE id = ?", c.user.id, now(), a.id);
          audit(c.user.name, "Abwesenheit eingetragen", `${who.name}: ${LABEL[b.type]} ${span(a)}`);
          tell(c.user.id, who.id, `F\xFCr dich wurde eingetragen: ${LABEL[b.type]} ${span(a)}.`);
        } else tellAdmins(c.user.id, b.type === "sick" ? `Krankmeldung: Ich bin ${span(a)} krank gemeldet.` : `Antrag (${LABEL[b.type]}) ${span(a)} \u2013 bitte unter \u201EZeit \u2192 Antr\xE4ge\u201C entscheiden.`);
        send(c.res, 201, absOut(a, who));
      });
      route("PUT", "/api/absences/:id", async (c) => {
        const a = row("SELECT * FROM absences WHERE id = ?", Number(c.params.id));
        if (!a) throw new HttpError(404, "Nicht gefunden");
        const b = await readJson(c.req), u = userOr404(a.user_id);
        if ("status" in b) {
          if (c.user.role !== "admin") throw new HttpError(403, "Nur Administratoren entscheiden \xFCber Antr\xE4ge");
          if (!["approved", "rejected", "pending"].includes(b.status)) throw new HttpError(400, "Ung\xFCltiger Status");
          run("UPDATE absences SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?", b.status, c.user.id, now(), str(b.decision_note, 300, { label: "Hinweis" }), a.id);
          if (b.status !== "pending" && b.status !== a.status) tell(c.user.id, u.id, `${LABEL[a.type]} ${span(a)}: ${b.status === "approved" ? "genehmigt \u2714" : "abgelehnt"}${b.decision_note ? ` \u2013 ${str(b.decision_note, 300)}` : ""}`);
          audit(c.user.name, b.status === "approved" ? "Abwesenheit genehmigt" : b.status === "rejected" ? "Abwesenheit abgelehnt" : "Abwesenheit zur\xFCckgesetzt", `${u.name}: ${a.date_start} \u2013 ${a.date_end}`);
        }
        if ("file_id" in b) {
          if (a.user_id !== c.user.id) throw new HttpError(403, "Nur die eigene Meldung l\xE4sst sich erg\xE4nzen");
          const fid = intOrNull(b.file_id);
          if (fid !== null && !row("SELECT 1 FROM files WHERE id = ? AND ctx = 'personal' AND owner_id = ?", fid, c.user.id)) throw new HttpError(400, "Anhang nicht gefunden");
          run("UPDATE absences SET file_id = ? WHERE id = ?", fid, a.id);
        }
        send(c.res, 200, absOut(row("SELECT * FROM absences WHERE id = ?", a.id), u));
      });
      route("DELETE", "/api/absences/:id", async (c) => {
        const a = row("SELECT * FROM absences WHERE id = ?", Number(c.params.id));
        if (!a) throw new HttpError(404, "Nicht gefunden");
        const own = a.user_id === c.user.id && (a.status === "pending" || a.date_start > ymd(/* @__PURE__ */ new Date()));
        if (!own && c.user.role !== "admin") throw new HttpError(403, "Bereits genehmigte oder begonnene Abwesenheiten kann nur ein Administrator l\xF6schen");
        run("DELETE FROM absences WHERE id = ?", a.id);
        if (c.user.role === "admin" && a.user_id !== c.user.id) audit(c.user.name, "Abwesenheit gel\xF6scht", `${userOr404(a.user_id).name}: ${a.date_start} \u2013 ${a.date_end}`);
        send(c.res, 200, { ok: true });
      });
      route("GET", "/api/personal-files", async (c) => {
        const u = subject(c);
        send(c.res, 200, all("SELECT id, name, size, category, uploader_id, created_at FROM files WHERE ctx = 'personal' AND owner_id = ? ORDER BY id DESC", u.id));
      });
      route("DELETE", "/api/personal-files/:id", async (c) => {
        const f = row("SELECT * FROM files WHERE id = ? AND ctx = 'personal'", Number(c.params.id));
        if (!f) throw new HttpError(404, "Nicht gefunden");
        if (c.user.role !== "admin" && !(f.owner_id === c.user.id && f.uploader_id === c.user.id)) throw new HttpError(403, "Diese Unterlage kann nur ein Administrator l\xF6schen");
        run("UPDATE absences SET file_id = NULL WHERE file_id = ?", f.id);
        run("DELETE FROM files WHERE id = ?", f.id);
        x.removeUpload(f.stored);
        send(c.res, 200, { ok: true });
      });
      const pendingCount = () => row("SELECT COUNT(*) n FROM absences WHERE status = 'pending'").n;
      return { pendingCount, status, STATES };
    };
    module2.exports.holidays = holidays;
    module2.exports.STATES = STATES;
  }
});

// server.js
var require_server = __commonJS({
  "server.js"() {
    "use strict";
    process.removeAllListeners("warning");
    var http = require("node:http");
    var fs = require("node:fs");
    var path2 = require("node:path");
    var crypto = require("node:crypto");
    var { Transform } = require("node:stream");
    var { pipeline } = require("node:stream/promises");
    var { db, DATA: DATA2, PACKAGED, UPLOADS, now, hashPassword, verifyPassword } = require_db();
    var sea = null;
    try {
      const m = require("node:sea");
      if (m.isSea()) sea = m;
    } catch {
    }
    var PORT = Number(process.env.PORT) || 3e3;
    var HOST = process.env.HOST || "0.0.0.0";
    var MAX_UPLOAD = (Number(process.env.MAX_UPLOAD_MB) || 100) * 1024 * 1024;
    var EXT_PUBLIC = globalThis.__PORTAL_PUBLIC || null;
    var PUBLIC = EXT_PUBLIC || path2.join(__dirname, "public");
    var VERSION = require_package().version;
    var RELEASES_PAGE = true ? "https://github.com/LoniGalaBauGmbH/betriebsportal-updates/releases" : "";
    var { staged } = require_versions();
    var SUPERVISED = !!process.env.PORTAL_SUPERVISED;
    var pendingUpdate = () => SUPERVISED ? staged(DATA2, VERSION)?.version || null : null;
    var SESSION_DAYS = 30;
    var HttpError = class extends Error {
      constructor(code, msg) {
        super(msg);
        this.code = code;
      }
    };
    var sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
    var send = (res, code, obj, headers = {}) => {
      const body = JSON.stringify(obj);
      res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
      res.end(body);
    };
    async function readJson(req, limit = 1024 * 1024) {
      const chunks = [];
      let size = 0;
      for await (const c of req) {
        size += c.length;
        if (size > limit) throw new HttpError(413, "Anfrage zu gro\xDF");
        chunks.push(c);
      }
      if (!size) return {};
      try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        throw new HttpError(400, "Ung\xFCltige Anfrage");
      }
    }
    var parseCookies = (h = "") => Object.fromEntries(h.split(";").map((p) => p.trim().split("=")).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]));
    var str = (v, max, { required = false, label = "Feld" } = {}) => {
      const s = typeof v === "string" ? v.trim() : "";
      if (required && !s) throw new HttpError(400, `${label} darf nicht leer sein`);
      if (s.length > max) throw new HttpError(400, `${label} ist zu lang (max. ${max} Zeichen)`);
      return s;
    };
    var isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
    var isTime = (s) => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
    var intOrNull = (v) => v === null || v === void 0 || v === "" ? null : Number.isInteger(Number(v)) ? Number(v) : null;
    var publicUser = (u, forAdmin = false) => ({
      id: u.id,
      username: u.username,
      name: u.name,
      position: u.position,
      responsibility: u.responsibility,
      role: u.role,
      active: !!u.active,
      email: u.email || "",
      pending: !!u.pending,
      kind: u.kind === "site" ? "site" : "office",
      avatar: u.avatar_v ? `/api/users/${u.id}/avatar?v=${u.avatar_v}` : null,
      ...forAdmin ? { reset_requested: !!u.reset_requested_at } : {}
    });
    var isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
    var getSetting = (k, def = "") => db.prepare("SELECT value FROM settings WHERE key = ?").get(k)?.value ?? def;
    var setSetting = (k, v) => db.prepare("INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, String(v));
    var audit = (actor, action, detail = "") => db.prepare("INSERT INTO audit (at, actor, action, detail) VALUES (?,?,?,?)").run(now(), actor, action, detail);
    var CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    var randomCode = (n) => Array.from(crypto.randomBytes(n), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
    var normCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    var inviteCode = () => {
      let c = getSetting("invite_code");
      if (!c) {
        c = randomCode(6);
        setSetting("invite_code", c);
      }
      return c;
    };
    var registrationOpen = () => getSetting("registration", "1") === "1";
    var adminNames = () => db.prepare("SELECT name FROM users WHERE role = 'admin' AND active = 1 ORDER BY name").all().map((u) => u.name);
    var buckets = /* @__PURE__ */ new Map();
    function throttle(key, max, ms) {
      const t = Date.now(), b = buckets.get(key);
      if (!b || t - b.t > ms) {
        buckets.set(key, { n: 1, t });
        return;
      }
      if (++b.n > max) throw new HttpError(429, "Zu viele Versuche. Bitte sp\xE4ter erneut versuchen.");
    }
    var ip = (req) => req.socket.remoteAddress || "?";
    var checkPassword = (pw) => {
      if (String(pw || "").length < 8) throw new HttpError(400, "Das Passwort muss mindestens 8 Zeichen haben");
      return String(pw);
    };
    var routes = [];
    function route(method, pattern, opts, fn) {
      if (typeof opts === "function") {
        fn = opts;
        opts = {};
      }
      const keys = [];
      const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => {
        keys.push(k);
        return "([^/]+)";
      }) + "$");
      routes.push({ method, re, keys, opts: { auth: true, ...opts }, fn });
    }
    function getSession(req) {
      const token = parseCookies(req.headers.cookie).sid;
      if (!token) return null;
      const row = db.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires > ? AND u.active = 1").get(sha(token), Date.now());
      return row || null;
    }
    var isSite = (u) => !!u && u.kind === "site" && u.role !== "admin";
    var siteSees = (u, f) => f.uploader_id === u.id || f.category === "image" || f.category === "other" && f.folder_id != null;
    var SITE_DENY = [
      [/^\/api\/contacts(\/|$)/],
      [/^\/api\/search$/],
      [/^\/api\/events(\/|$)/],
      [/^\/api\/absences\/calendar$/],
      [/^\/api\/site\/feed$/],
      [/^\/api\/files$/, "GET"],
      [/^\/api\/files\/\d+\/assign$/],
      [/^\/api\/projects$/, "POST"],
      [/^\/api\/projects\/\d+$/, "PUT"],
      [/^\/api\/projects\/\d+$/, "DELETE"],
      [/^\/api\/tasks$/, "POST"],
      [/^\/api\/tasks\/\d+$/, "DELETE"]
    ];
    function siteGuard(c, method, pathname) {
      if (!isSite(c.user)) return;
      if (SITE_DENY.some(([re, m]) => re.test(pathname) && (!m || m === method))) throw new HttpError(403, "Dieser Bereich ist f\xFCr dein Konto nicht freigeschaltet");
      if (method === "POST" && pathname === "/api/files" && !["project", "message", "personal"].includes(c.query.get("ctx"))) throw new HttpError(403, "Dieser Bereich ist f\xFCr dein Konto nicht freigeschaltet");
      const t = /^\/api\/tasks\/(\d+)$/.exec(pathname);
      if (t && method === "PUT") {
        const task = db.prepare("SELECT assignee_id, creator_id FROM tasks WHERE id = ?").get(Number(t[1]));
        if (task && task.assignee_id !== c.user.id && task.creator_id !== c.user.id) throw new HttpError(403, "Das ist nicht deine Aufgabe");
      }
    }
    var fails = /* @__PURE__ */ new Map();
    route("POST", "/api/login", { auth: false }, async (c) => {
      const key = c.req.socket.remoteAddress;
      const f = fails.get(key);
      if (f && f.n >= 10 && Date.now() - f.t < 10 * 60 * 1e3) throw new HttpError(429, "Zu viele Versuche. Bitte in ein paar Minuten erneut versuchen.");
      const b = await readJson(c.req);
      const ident = String(b.username || "").trim();
      const user = db.prepare("SELECT * FROM users WHERE username = ? OR (email != '' AND email = ? COLLATE NOCASE)").get(ident, ident);
      const ok = user ? verifyPassword(String(b.password || ""), user.password_hash) : (verifyPassword("x", hashPassword("y")), false);
      if (!ok) {
        fails.set(key, { n: (f && Date.now() - f.t < 10 * 60 * 1e3 ? f.n : 0) + 1, t: Date.now() });
        throw new HttpError(401, "Benutzername oder Passwort ist falsch");
      }
      fails.delete(key);
      if (user.pending) {
        const e = new HttpError(403, "Dein Konto wartet noch auf die Freigabe durch einen Administrator.");
        e.extra = { pending: true, can_claim: isLocal(c.req) };
        throw e;
      }
      if (!user.active) throw new HttpError(403, "Dieses Konto wurde deaktiviert. Bitte wende dich an einen Administrator.");
      db.prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now());
      const token = crypto.randomBytes(32).toString("hex");
      db.prepare("INSERT INTO sessions (token_hash, user_id, expires) VALUES (?,?,?)").run(sha(token), user.id, Date.now() + SESSION_DAYS * 864e5);
      const secure = c.req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
      send(c.res, 200, { ...publicUser(user), must_change: !!user.must_change }, { "Set-Cookie": `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}` });
    });
    route("POST", "/api/logout", { auth: false }, async (c) => {
      const token = parseCookies(c.req.headers.cookie).sid;
      if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha(token));
      send(c.res, 200, { ok: true }, { "Set-Cookie": "sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" });
    });
    route("GET", "/api/me", { auth: false }, async (c) => {
      const u = getSession(c.req);
      if (!u) throw new HttpError(401, "Nicht angemeldet");
      send(c.res, 200, { ...publicUser(u), must_change: !!u.must_change });
    });
    route("POST", "/api/me/password", async (c) => {
      const b = await readJson(c.req);
      if (!c.user.must_change && !verifyPassword(String(b.current || ""), c.user.password_hash)) throw new HttpError(400, "Das aktuelle Passwort ist falsch");
      const pw = checkPassword(b.password);
      if (verifyPassword(pw, c.user.password_hash)) throw new HttpError(400, "Bitte w\xE4hle ein neues Passwort, nicht das bisherige");
      db.prepare("UPDATE users SET password_hash = ?, must_change = 0 WHERE id = ?").run(hashPassword(pw), c.user.id);
      db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").run(c.user.id, sha(parseCookies(c.req.headers.cookie).sid || ""));
      audit(c.user.name, "Passwort ge\xE4ndert");
      send(c.res, 200, { ok: true });
    });
    route("PUT", "/api/me", async (c) => {
      const b = await readJson(c.req);
      const name = str(b.name, 80, { required: true, label: "Name" });
      const email = str(b.email, 120, { label: "E-Mail" });
      if (email && !isEmail(email)) throw new HttpError(400, "Bitte eine g\xFCltige E-Mail-Adresse eingeben");
      if (email && db.prepare("SELECT 1 FROM users WHERE email = ? COLLATE NOCASE AND id != ?").get(email, c.user.id)) throw new HttpError(409, "Diese E-Mail-Adresse wird bereits verwendet");
      db.prepare("UPDATE users SET name = ?, email = ? WHERE id = ?").run(name, email, c.user.id);
      send(c.res, 200, publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(c.user.id)));
    });
    var hasUsers = () => !!db.prepare("SELECT 1 FROM users LIMIT 1").get();
    var isLocal = (req) => !process.env.PORTAL_SERVER && ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress) && !req.headers["x-forwarded-for"] && !req.headers.forwarded && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host || "");
    route("GET", "/api/setup", { auth: false }, async (c) => {
      send(c.res, 200, {
        needed: !hasUsers(),
        local: isLocal(c.req),
        code_setup: remote ? remote.codeSetup() : false,
        version: VERSION,
        registration: registrationOpen(),
        program: lastCheck()?.shell || null,
        releases: RELEASES_PAGE
      });
    });
    route("POST", "/api/setup", { auth: false }, async (c) => {
      if (hasUsers()) throw new HttpError(409, "Das Portal ist bereits eingerichtet");
      const b = await readJson(c.req);
      if (!isLocal(c.req) && !remote.codeOk(b.code)) throw new HttpError(403, remote.SERVER ? "Der Einrichtungscode stimmt nicht" : "Die Ersteinrichtung ist nur direkt am Hauptrechner m\xF6glich");
      const f = userFields({ ...b, role: "admin" }, { creating: true });
      db.prepare("INSERT INTO users (username,name,position,responsibility,role,email,password_hash,created_at) VALUES (?,?,?,?,?,?,?,?)").run(f.username, f.name, f.position, f.responsibility, "admin", f.email, hashPassword(String(b.password)), now());
      audit(f.name, "Portal eingerichtet", "Erstes Administrator-Konto angelegt");
      send(c.res, 201, { ok: true });
    });
    route("POST", "/api/register", { auth: false }, async (c) => {
      throttle("reg:" + ip(c.req), 10, 36e5);
      if (!hasUsers()) throw new HttpError(400, "Das Portal muss zuerst am Hauptrechner eingerichtet werden");
      if (!registrationOpen()) throw new HttpError(403, "Die Registrierung ist ausgeschaltet. Bitte wende dich an einen Administrator.");
      const b = await readJson(c.req);
      const f = userFields({ ...b, role: "user", responsibility: "" }, { creating: true });
      if (db.prepare("SELECT 1 FROM users WHERE username = ?").get(f.username)) throw new HttpError(409, "Dieser Benutzername ist bereits vergeben");
      const given = normCode(b.code);
      if (given && given !== inviteCode()) throw new HttpError(400, "Der Einladungscode stimmt nicht. Ohne Code wird dein Konto von einem Administrator freigegeben.");
      const direct = !!given;
      db.prepare("INSERT INTO users (username,name,position,responsibility,role,email,password_hash,active,pending,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(f.username, f.name, f.position, "", "user", f.email, hashPassword(String(b.password)), direct ? 1 : 0, direct ? 0 : 1, now());
      audit(f.name, direct ? "Registriert (mit Einladungscode)" : "Registrierung angefragt", f.username);
      send(c.res, 201, { status: direct ? "active" : "pending", admins: adminNames(), can_claim: !direct && isLocal(c.req) });
    });
    route("POST", "/api/password/request", { auth: false }, async (c) => {
      throttle("pwreq:" + ip(c.req), 8, 36e5);
      const ident = String((await readJson(c.req)).username || "").trim();
      const u = db.prepare("SELECT * FROM users WHERE (username = ? OR (email != '' AND email = ? COLLATE NOCASE)) AND active = 1").get(ident, ident);
      if (u) {
        db.prepare("UPDATE users SET reset_requested_at = ? WHERE id = ?").run(now(), u.id);
        audit(u.name, "Passwort-R\xFCcksetzung angefragt");
      }
      send(c.res, 200, { ok: true, admins: adminNames() });
    });
    route("POST", "/api/password/reset", { auth: false }, async (c) => {
      throttle("pwreset:" + ip(c.req), 15, 36e5);
      const b = await readJson(c.req);
      const ident = String(b.username || "").trim();
      const bad = new HttpError(400, "Benutzername oder Code stimmt nicht \u2013 oder der Code ist abgelaufen.");
      const u = db.prepare("SELECT * FROM users WHERE (username = ? OR (email != '' AND email = ? COLLATE NOCASE)) AND active = 1").get(ident, ident);
      const rc = u && db.prepare("SELECT * FROM reset_codes WHERE user_id = ?").get(u.id);
      if (!rc || rc.expires < Date.now()) throw bad;
      if (rc.attempts >= 5) {
        db.prepare("DELETE FROM reset_codes WHERE user_id = ?").run(u.id);
        throw new HttpError(400, "Zu viele falsche Eingaben \u2013 bitte einen neuen Code anfordern.");
      }
      if (sha(normCode(b.code)) !== rc.code_hash) {
        db.prepare("UPDATE reset_codes SET attempts = attempts + 1 WHERE user_id = ?").run(u.id);
        throw bad;
      }
      const pw = checkPassword(b.password);
      db.prepare("UPDATE users SET password_hash = ?, must_change = 0, reset_requested_at = NULL WHERE id = ?").run(hashPassword(pw), u.id);
      db.prepare("DELETE FROM reset_codes WHERE user_id = ?").run(u.id);
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(u.id);
      audit(u.name, "Passwort mit Einmal-Code neu gesetzt");
      send(c.res, 200, { ok: true });
    });
    route("POST", "/api/local/claim", { auth: false }, async (c) => {
      if (!isLocal(c.req)) throw new HttpError(403, "Nur direkt am Hauptrechner m\xF6glich");
      throttle("claim:" + ip(c.req), 20, 36e5);
      const b = await readJson(c.req);
      const ident = String(b.username || "").trim();
      const u = db.prepare("SELECT * FROM users WHERE username = ? OR (email != '' AND email = ? COLLATE NOCASE)").get(ident, ident);
      if (!u || !verifyPassword(String(b.password || ""), u.password_hash)) throw new HttpError(401, "Benutzername oder Passwort ist falsch");
      if (!u.pending) throw new HttpError(400, "Dieses Konto ist bereits freigeschaltet");
      db.prepare("UPDATE users SET pending = 0, active = 1, role = 'admin' WHERE id = ?").run(u.id);
      audit("Hauptrechner", "Konto am Hauptrechner als Administrator freigeschaltet", u.name);
      const old = db.prepare("SELECT * FROM users WHERE username = 'admin' AND name = 'Administrator' AND id != ?").get(u.id);
      if (old) {
        const used = ["SELECT 1 FROM tasks WHERE creator_id = ?1 OR assignee_id = ?1", "SELECT 1 FROM events WHERE creator_id = ?1", "SELECT 1 FROM messages WHERE sender_id = ?1 OR recipient_id = ?1", "SELECT 1 FROM files WHERE uploader_id = ?1"].some((q) => db.prepare(q + " LIMIT 1").get(old.id)) || !!db.prepare("SELECT 1 FROM audit WHERE actor = 'Administrator' LIMIT 1").get();
        if (!used) {
          db.prepare("DELETE FROM users WHERE id = ?").run(old.id);
          audit("Hauptrechner", "Unbenutztes Alt-Konto \u201Eadmin\u201C entfernt");
        }
      }
      send(c.res, 200, { ok: true, username: u.username });
    });
    route("GET", "/api/local/admins", { auth: false }, async (c) => {
      if (!isLocal(c.req)) throw new HttpError(403, "Nur direkt am Hauptrechner m\xF6glich");
      send(c.res, 200, db.prepare("SELECT id, name, username FROM users WHERE role = 'admin' AND active = 1 ORDER BY name").all());
    });
    route("POST", "/api/local/reset", { auth: false }, async (c) => {
      if (!isLocal(c.req)) throw new HttpError(403, "Nur direkt am Hauptrechner m\xF6glich");
      const b = await readJson(c.req);
      const u = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'admin' AND active = 1").get(Number(b.user_id));
      if (!u) throw new HttpError(404, "Konto nicht gefunden");
      const pw = checkPassword(b.password);
      db.prepare("UPDATE users SET password_hash = ?, must_change = 0, reset_requested_at = NULL WHERE id = ?").run(hashPassword(pw), u.id);
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(u.id);
      audit("Hauptrechner", "Administrator-Passwort am Hauptrechner neu gesetzt", u.name);
      send(c.res, 200, { ok: true, username: u.username });
    });
    route("GET", "/api/users", async (c) => {
      const admin = c.user.role === "admin";
      const list = db.prepare("SELECT * FROM users ORDER BY active DESC, name COLLATE NOCASE").all().filter((u) => admin || !u.pending).map((u) => publicUser(u, admin));
      send(c.res, 200, isSite(c.user) ? list.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name, position: u.position, role: u.role, active: true, avatar: u.avatar, kind: u.kind })) : list);
    });
    function userFields(b, { creating }) {
      const out = {
        name: str(b.name, 80, { required: true, label: "Name" }),
        position: str(b.position, 80, { label: "Position" }),
        responsibility: str(b.responsibility, 500, { label: "Verantwortungsbereich" }),
        role: b.role === "admin" ? "admin" : "user",
        email: str(b.email, 120, { label: "E-Mail" })
      };
      if (out.email && !isEmail(out.email)) throw new HttpError(400, "Bitte eine g\xFCltige E-Mail-Adresse eingeben");
      if (out.email && db.prepare("SELECT 1 FROM users WHERE email = ? COLLATE NOCASE AND id != ?").get(out.email, Number(b.__id) || 0)) throw new HttpError(409, "Diese E-Mail-Adresse wird bereits verwendet");
      if (creating) {
        out.username = str(b.username, 40, { required: true, label: "Benutzername" });
        if (!/^[\w.\-@]+$/.test(out.username)) throw new HttpError(400, "Benutzername: nur Buchstaben, Zahlen sowie . _ - @");
      }
      if (creating || b.password) {
        if (String(b.password || "").length < 8) throw new HttpError(400, "Das Passwort muss mindestens 8 Zeichen haben");
      }
      return out;
    }
    route("POST", "/api/users", { admin: true }, async (c) => {
      const b = await readJson(c.req);
      const f = userFields(b, { creating: true });
      if (db.prepare("SELECT 1 FROM users WHERE username = ?").get(f.username)) throw new HttpError(409, "Dieser Benutzername ist bereits vergeben");
      const r = db.prepare("INSERT INTO users (username,name,position,responsibility,role,email,password_hash,must_change,created_at) VALUES (?,?,?,?,?,?,?,1,?)").run(f.username, f.name, f.position, f.responsibility, f.role, f.email, hashPassword(String(b.password)), now());
      audit(c.user.name, "Konto angelegt", f.name);
      send(c.res, 201, publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(r.lastInsertRowid)));
    });
    route("PUT", "/api/users/:id", { admin: true }, async (c) => {
      const id = Number(c.params.id);
      const u = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
      if (!u) throw new HttpError(404, "Nicht gefunden");
      const b = await readJson(c.req);
      const f = userFields({ ...b, __id: id }, { creating: false });
      const active = u.pending ? 0 : b.active === false ? 0 : 1;
      if (id === c.user.id && (f.role !== "admin" || !active)) throw new HttpError(400, "Du kannst dir selbst weder die Admin-Rechte entziehen noch dich deaktivieren");
      if (u.role === "admin" && (f.role !== "admin" || !active) && db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND active = 1").get().n <= 1) throw new HttpError(400, "Es muss mindestens ein aktiver Administrator \xFCbrig bleiben");
      db.prepare("UPDATE users SET name=?, position=?, responsibility=?, role=?, email=?, active=? WHERE id=?").run(f.name, f.position, f.responsibility, f.role, f.email, active, id);
      if (u.role !== f.role) audit(c.user.name, f.role === "admin" ? "Zum Administrator gemacht" : "Administrator-Rechte entzogen", u.name);
      if (!!u.active !== !!active && !u.pending) audit(c.user.name, active ? "Konto wieder aktiviert" : "Konto deaktiviert", u.name);
      if (!active) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
      send(c.res, 200, publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(id), true));
    });
    route("POST", "/api/users/:id/approve", { admin: true }, async (c) => {
      const u = db.prepare("SELECT * FROM users WHERE id = ? AND pending = 1").get(Number(c.params.id));
      if (!u) throw new HttpError(404, "Keine offene Anfrage gefunden");
      db.prepare("UPDATE users SET pending = 0, active = 1 WHERE id = ?").run(u.id);
      audit(c.user.name, "Registrierung freigegeben", u.name);
      send(c.res, 200, { ok: true });
    });
    route("DELETE", "/api/users/:id", { admin: true }, async (c) => {
      const u = db.prepare("SELECT * FROM users WHERE id = ? AND pending = 1").get(Number(c.params.id));
      if (!u) throw new HttpError(400, "Nur offene Registrierungen k\xF6nnen abgelehnt werden. Bestehende Konten bitte deaktivieren.");
      db.prepare("DELETE FROM users WHERE id = ?").run(u.id);
      audit(c.user.name, "Registrierung abgelehnt", u.name);
      send(c.res, 200, { ok: true });
    });
    route("POST", "/api/users/:id/reset-code", { admin: true }, async (c) => {
      const u = db.prepare("SELECT * FROM users WHERE id = ? AND active = 1").get(Number(c.params.id));
      if (!u) throw new HttpError(404, "Konto nicht gefunden");
      const code = randomCode(8);
      db.prepare("INSERT INTO reset_codes (user_id, code_hash, expires, attempts) VALUES (?,?,?,0) ON CONFLICT(user_id) DO UPDATE SET code_hash = excluded.code_hash, expires = excluded.expires, attempts = 0").run(u.id, sha(code), Date.now() + 24 * 36e5);
      db.prepare("UPDATE users SET reset_requested_at = NULL WHERE id = ?").run(u.id);
      audit(c.user.name, "Einmal-Code zum Passwort-Zur\xFCcksetzen erzeugt", u.name);
      send(c.res, 200, { code: code.slice(0, 4) + "-" + code.slice(4), username: u.username, name: u.name });
    });
    route("POST", "/api/users/:id/dismiss-reset", { admin: true }, async (c) => {
      db.prepare("UPDATE users SET reset_requested_at = NULL WHERE id = ?").run(Number(c.params.id));
      send(c.res, 200, { ok: true });
    });
    route("GET", "/api/admin/settings", { admin: true }, async (c) => {
      send(c.res, 200, { registration: registrationOpen(), invite_code: inviteCode() });
    });
    route("PUT", "/api/admin/settings", { admin: true }, async (c) => {
      const b = await readJson(c.req);
      if ("registration" in b) {
        setSetting("registration", b.registration ? "1" : "0");
        audit(c.user.name, b.registration ? "Registrierung eingeschaltet" : "Registrierung ausgeschaltet");
      }
      if (b.new_code) {
        setSetting("invite_code", randomCode(6));
        audit(c.user.name, "Neuen Einladungscode erzeugt");
      }
      send(c.res, 200, { registration: registrationOpen(), invite_code: inviteCode() });
    });
    route("GET", "/api/admin/audit", { admin: true }, async (c) => {
      send(c.res, 200, db.prepare("SELECT at, actor, action, detail FROM audit ORDER BY id DESC LIMIT 200").all());
    });
    var PRIORITIES = ["low", "normal", "high"];
    var STATUSES = ["open", "progress", "done"];
    var userExists = (id) => !!db.prepare("SELECT 1 FROM users WHERE id = ? AND active = 1").get(id);
    route("GET", "/api/tasks", async (c) => {
      const list = db.prepare(`SELECT * FROM tasks
    WHERE status != 'done' OR done_at > ? ORDER BY id DESC`).all(new Date(Date.now() - 30 * 864e5).toISOString());
      send(c.res, 200, isSite(c.user) ? list.filter((t) => t.assignee_id === c.user.id || t.creator_id === c.user.id) : list);
    });
    function taskFields(b, base = {}) {
      const t = { ...base };
      if ("title" in b) t.title = str(b.title, 200, { required: true, label: "Titel" });
      if ("description" in b) t.description = str(b.description, 5e3, { label: "Beschreibung" });
      if ("assignee_id" in b) {
        const a = intOrNull(b.assignee_id);
        if (a !== null && !userExists(a)) throw new HttpError(400, "Unbekannte Person");
        t.assignee_id = a;
      }
      if ("priority" in b) {
        if (!PRIORITIES.includes(b.priority)) throw new HttpError(400, "Ung\xFCltige Priorit\xE4t");
        t.priority = b.priority;
      }
      if ("status" in b) {
        if (!STATUSES.includes(b.status)) throw new HttpError(400, "Ung\xFCltiger Status");
        t.status = b.status;
      }
      if ("due" in b) {
        if (b.due && !isDate(b.due)) throw new HttpError(400, "Ung\xFCltiges Datum");
        t.due = b.due || null;
      }
      if ("project_id" in b) {
        const p = intOrNull(b.project_id);
        t.project_id = p !== null && db.prepare("SELECT 1 FROM projects WHERE id = ?").get(p) ? p : null;
      }
      return t;
    }
    route("POST", "/api/tasks", async (c) => {
      const b = await readJson(c.req);
      const t = taskFields(b, { description: "", assignee_id: c.user.id, priority: "normal", status: "open", due: null });
      if (!t.title) throw new HttpError(400, "Titel darf nicht leer sein");
      const r = db.prepare("INSERT INTO tasks (title,description,assignee_id,creator_id,priority,status,due,created_at,done_at) VALUES (?,?,?,?,?,?,?,?,?)").run(t.title, t.description, t.assignee_id, c.user.id, t.priority, t.status, t.due, now(), t.status === "done" ? now() : null);
      db.prepare("UPDATE tasks SET project_id = ? WHERE id = ?").run(t.project_id ?? null, r.lastInsertRowid);
      send(c.res, 201, db.prepare("SELECT * FROM tasks WHERE id = ?").get(r.lastInsertRowid));
    });
    route("PUT", "/api/tasks/:id", async (c) => {
      const old = db.prepare("SELECT * FROM tasks WHERE id = ?").get(Number(c.params.id));
      if (!old) throw new HttpError(404, "Nicht gefunden");
      if (c.user.role !== "admin" && old.creator_id !== c.user.id && old.assignee_id !== c.user.id) throw new HttpError(403, "Nur Ersteller:in, Zust\xE4ndige:r oder Admins d\xFCrfen diese Aufgabe \xE4ndern");
      const t = taskFields(await readJson(c.req), old);
      const doneAt = t.status === "done" ? old.status === "done" ? old.done_at : now() : null;
      db.prepare("UPDATE tasks SET title=?, description=?, assignee_id=?, priority=?, status=?, due=?, done_at=? WHERE id=?").run(t.title, t.description, t.assignee_id, t.priority, t.status, t.due, doneAt, old.id);
      db.prepare("UPDATE tasks SET project_id = ? WHERE id = ?").run(t.project_id ?? null, old.id);
      send(c.res, 200, db.prepare("SELECT * FROM tasks WHERE id = ?").get(old.id));
    });
    route("DELETE", "/api/tasks/:id", async (c) => {
      const old = db.prepare("SELECT * FROM tasks WHERE id = ?").get(Number(c.params.id));
      if (!old) throw new HttpError(404, "Nicht gefunden");
      if (c.user.role !== "admin" && old.creator_id !== c.user.id) throw new HttpError(403, "Nur die Person, die die Aufgabe erstellt hat, oder Admins d\xFCrfen sie l\xF6schen");
      db.prepare("DELETE FROM tasks WHERE id = ?").run(old.id);
      send(c.res, 200, { ok: true });
    });
    var KINDS = ["meeting", "absence", "deadline", "other"];
    function withAttendees(rows) {
      if (!rows.length) return rows;
      const att = db.prepare(`SELECT event_id, user_id FROM event_attendees WHERE event_id IN (${rows.map(() => "?").join(",")})`).all(...rows.map((r) => r.id));
      const map = /* @__PURE__ */ new Map();
      for (const a of att) (map.get(a.event_id) || map.set(a.event_id, []).get(a.event_id)).push(a.user_id);
      return rows.map((r) => ({ ...r, attendees: map.get(r.id) || [] }));
    }
    route("GET", "/api/events", async (c) => {
      const from = c.query.get("from"), to = c.query.get("to");
      if (!isDate(from) || !isDate(to)) throw new HttpError(400, "from/to erforderlich");
      send(c.res, 200, withAttendees(db.prepare("SELECT * FROM events WHERE date_start <= ? AND date_end >= ? ORDER BY date_start, time_start").all(to, from)));
    });
    function eventFields(b) {
      const e = {
        title: str(b.title, 200, { required: true, label: "Titel" }),
        description: str(b.description, 5e3, { label: "Beschreibung" }),
        kind: KINDS.includes(b.kind) ? b.kind : "meeting",
        date_start: b.date_start,
        date_end: b.date_end || b.date_start,
        time_start: b.time_start || null,
        time_end: b.time_end || null
      };
      if (!isDate(e.date_start) || !isDate(e.date_end)) throw new HttpError(400, "Bitte ein g\xFCltiges Datum angeben");
      if (e.date_end < e.date_start) throw new HttpError(400, "Das Ende darf nicht vor dem Beginn liegen");
      if (e.time_start && !isTime(e.time_start)) throw new HttpError(400, "Ung\xFCltige Uhrzeit");
      if (e.time_end && !isTime(e.time_end)) throw new HttpError(400, "Ung\xFCltige Uhrzeit");
      if (!e.time_start) e.time_end = null;
      if (e.time_start && e.time_end && e.date_start === e.date_end && e.time_end < e.time_start) throw new HttpError(400, "Das Ende darf nicht vor dem Beginn liegen");
      const attendees = Array.isArray(b.attendees) ? [...new Set(b.attendees.map(Number).filter((id) => Number.isInteger(id) && userExists(id)))] : [];
      return { e, attendees };
    }
    function saveAttendees(id, list) {
      db.prepare("DELETE FROM event_attendees WHERE event_id = ?").run(id);
      const ins = db.prepare("INSERT INTO event_attendees (event_id, user_id) VALUES (?,?)");
      for (const u of list) ins.run(id, u);
    }
    route("POST", "/api/events", async (c) => {
      const { e, attendees } = eventFields(await readJson(c.req));
      const r = db.prepare("INSERT INTO events (title,description,kind,date_start,date_end,time_start,time_end,creator_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(e.title, e.description, e.kind, e.date_start, e.date_end, e.time_start, e.time_end, c.user.id, now());
      saveAttendees(r.lastInsertRowid, attendees);
      send(c.res, 201, withAttendees([db.prepare("SELECT * FROM events WHERE id = ?").get(r.lastInsertRowid)])[0]);
    });
    route("PUT", "/api/events/:id", async (c) => {
      const old = db.prepare("SELECT * FROM events WHERE id = ?").get(Number(c.params.id));
      if (!old) throw new HttpError(404, "Nicht gefunden");
      if (c.user.role !== "admin" && old.creator_id !== c.user.id) throw new HttpError(403, "Nur die Person, die den Termin erstellt hat, oder Admins d\xFCrfen ihn \xE4ndern");
      const { e, attendees } = eventFields(await readJson(c.req));
      db.prepare("UPDATE events SET title=?, description=?, kind=?, date_start=?, date_end=?, time_start=?, time_end=? WHERE id=?").run(e.title, e.description, e.kind, e.date_start, e.date_end, e.time_start, e.time_end, old.id);
      saveAttendees(old.id, attendees);
      send(c.res, 200, withAttendees([db.prepare("SELECT * FROM events WHERE id = ?").get(old.id)])[0]);
    });
    route("DELETE", "/api/events/:id", async (c) => {
      const old = db.prepare("SELECT * FROM events WHERE id = ?").get(Number(c.params.id));
      if (!old) throw new HttpError(404, "Nicht gefunden");
      if (c.user.role !== "admin" && old.creator_id !== c.user.id) throw new HttpError(403, "Nur die Person, die den Termin erstellt hat, oder Admins d\xFCrfen ihn l\xF6schen");
      db.prepare("DELETE FROM events WHERE id = ?").run(old.id);
      send(c.res, 200, { ok: true });
    });
    var cleanName = (n) => String(n || "Datei").replace(/[\\/\0\r\n]/g, "_").trim().slice(0, 200) || "Datei";
    var fileRow = `SELECT f.id, f.name, f.size, f.note, f.ctx, f.uploader_id, f.created_at, f.project_id, f.category FROM files f`;
    var feat;
    route("GET", "/api/files", async (c) => {
      send(c.res, 200, db.prepare(`${fileRow} WHERE ctx = 'files' ORDER BY id DESC`).all());
    });
    route("POST", "/api/files", async (c) => {
      const name = cleanName(c.query.get("name"));
      const note = str(c.query.get("note") || "", c.query.get("ctx") === "project" ? 2e3 : 300, { label: "Beschreibung" });
      let ctx = c.query.get("ctx") === "message" ? "message" : "files", projectId = null, category = "";
      if (c.query.get("ctx") === "project") {
        projectId = Number(c.query.get("project_id"));
        if (!db.prepare("SELECT 1 FROM projects WHERE id = ?").get(projectId)) throw new HttpError(400, "Projekt nicht gefunden");
        category = feat.CATEGORIES.includes(c.query.get("category")) ? c.query.get("category") : "other";
        ctx = "project";
      }
      let ownerId = null;
      if (c.query.get("ctx") === "personal") {
        ownerId = intOrNull(c.query.get("owner")) ?? c.user.id;
        if (ownerId !== c.user.id && (c.user.role !== "admin" || !userExists(ownerId))) throw new HttpError(403, "Keine Berechtigung");
        category = ["sick", "payslip", "contract", "certificate", "other"].includes(c.query.get("category")) ? c.query.get("category") : "other";
        ctx = "personal";
      }
      const len = Number(c.req.headers["content-length"]);
      if (!len) throw new HttpError(400, "Leere Datei");
      if (len > MAX_UPLOAD) throw new HttpError(413, `Datei zu gro\xDF (max. ${Math.round(MAX_UPLOAD / 1048576)} MB)`);
      const stored = crypto.randomBytes(16).toString("hex");
      const target = path2.join(UPLOADS, stored);
      let size = 0;
      const limiter = new Transform({
        transform(chunk, _e, cb) {
          size += chunk.length;
          size > MAX_UPLOAD ? cb(new HttpError(413, "Datei zu gro\xDF")) : cb(null, chunk);
        }
      });
      try {
        await pipeline(c.req, limiter, fs.createWriteStream(target, { flags: "wx" }));
      } catch (e) {
        fs.rm(target, { force: true }, () => {
        });
        throw e instanceof HttpError ? e : new HttpError(400, "Upload abgebrochen");
      }
      const r = db.prepare("INSERT INTO files (name,stored,size,note,ctx,uploader_id,created_at,project_id,category,owner_id) VALUES (?,?,?,?,?,?,?,?,?,?)").run(name, stored, size, note, ctx, c.user.id, now(), projectId, category, ownerId);
      if (projectId) field.afterUpload(Number(r.lastInsertRowid), projectId, c.query);
      if (projectId) feat.event(projectId, c.user.id, `hat ${{ delivery: "Lieferschein", invoice: "Rechnung", image: "Bild", other: "Dokument" }[category]} \u201E${name}\u201C hochgeladen`, Number(r.lastInsertRowid));
      send(c.res, 201, db.prepare(`${fileRow} WHERE id = ?`).get(r.lastInsertRowid));
    });
    function canAccessFile(user, f) {
      if (f.ctx === "personal") return f.owner_id === user.id || user.role === "admin";
      if (isSite(user) && f.ctx === "files") return f.uploader_id === user.id;
      if (isSite(user) && f.ctx === "project") return siteSees(user, f);
      if (f.ctx === "files" || f.ctx === "project" || f.uploader_id === user.id) return true;
      return !!db.prepare("SELECT 1 FROM messages WHERE file_id = ? AND (recipient_id IS NULL OR sender_id = ? OR recipient_id = ?)").get(f.id, user.id, user.id);
    }
    route("GET", "/api/files/:id/download", async (c) => {
      const f = db.prepare("SELECT * FROM files WHERE id = ?").get(Number(c.params.id));
      if (!f || !canAccessFile(c.user, f)) throw new HttpError(404, "Nicht gefunden");
      const file = path2.join(UPLOADS, f.stored);
      if (!fs.existsSync(file)) throw new HttpError(404, "Datei nicht mehr vorhanden");
      c.res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": f.size,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.name).replace(/['()*]/g, (ch) => "%" + ch.charCodeAt(0).toString(16))}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store"
      });
      fs.createReadStream(file).pipe(c.res);
      c.handled = true;
    });
    var VIEW_TYPES = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".pdf": "application/pdf" };
    route("GET", "/api/files/:id/view", async (c) => {
      const f = db.prepare("SELECT * FROM files WHERE id = ?").get(Number(c.params.id));
      if (!f || !canAccessFile(c.user, f)) throw new HttpError(404, "Nicht gefunden");
      const type = VIEW_TYPES[path2.extname(f.name).toLowerCase()];
      const file = path2.join(UPLOADS, f.stored);
      if (!type || !fs.existsSync(file)) throw new HttpError(404, "Keine Vorschau m\xF6glich");
      c.res.setHeader("X-Frame-Options", "SAMEORIGIN");
      c.res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; object-src 'self'; frame-ancestors 'self'");
      c.res.writeHead(200, { "Content-Type": type, "Content-Length": f.size, "Content-Disposition": "inline", "Cache-Control": "private, max-age=86400" });
      fs.createReadStream(file).pipe(c.res);
    });
    route("PUT", "/api/files/:id", async (c) => {
      const f = db.prepare("SELECT * FROM files WHERE id = ? AND ctx = ?").get(Number(c.params.id), "files");
      if (!f) throw new HttpError(404, "Nicht gefunden");
      if (c.user.role !== "admin" && f.uploader_id !== c.user.id) throw new HttpError(403, "Keine Berechtigung");
      const b = await readJson(c.req);
      db.prepare("UPDATE files SET name = ?, note = ? WHERE id = ?").run(cleanName(b.name ?? f.name), str(b.note ?? f.note, 300, { label: "Beschreibung" }), f.id);
      send(c.res, 200, db.prepare(`${fileRow} WHERE id = ?`).get(f.id));
    });
    route("DELETE", "/api/files/:id", async (c) => {
      const f = db.prepare("SELECT * FROM files WHERE id = ? AND ctx = ?").get(Number(c.params.id), "files");
      if (!f) throw new HttpError(404, "Nicht gefunden");
      if (c.user.role !== "admin" && f.uploader_id !== c.user.id) throw new HttpError(403, "Nur die Person, die die Datei hochgeladen hat, oder Admins d\xFCrfen sie l\xF6schen");
      db.prepare("DELETE FROM files WHERE id = ?").run(f.id);
      fs.rm(path2.join(UPLOADS, f.stored), { force: true }, () => {
      });
      send(c.res, 200, { ok: true });
    });
    var convKey = (w) => w === "all" ? "all" : "dm:" + w;
    function convWhere(me, w) {
      if (w === "all") return { sql: "m.recipient_id IS NULL", args: [] };
      const other = Number(w);
      if (!Number.isInteger(other) || !userExists(other) || other === me) throw new HttpError(400, "Unbekannte Unterhaltung");
      return { sql: "((m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?))", args: [me, other, other, me] };
    }
    var msgSelect = `SELECT m.id, m.sender_id, m.recipient_id, m.body, m.created_at, m.file_id, f.name AS file_name, f.size AS file_size
  FROM messages m LEFT JOIN files f ON f.id = m.file_id`;
    route("GET", "/api/conversations", async (c) => {
      const me = c.user.id;
      const readOf = (k) => db.prepare("SELECT last_id FROM reads WHERE user_id = ? AND conv = ?").get(me, k)?.last_id || 0;
      const list = [];
      const last = db.prepare(`${msgSelect} WHERE m.recipient_id IS NULL ORDER BY m.id DESC LIMIT 1`).get() || null;
      list.push({ key: "all", last, unread: db.prepare("SELECT COUNT(*) n FROM messages WHERE recipient_id IS NULL AND sender_id != ? AND id > ?").get(me, readOf("all")).n });
      for (const u of db.prepare("SELECT id FROM users WHERE active = 1 AND id != ?").all(me)) {
        const l = db.prepare(`${msgSelect} WHERE (m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?) ORDER BY m.id DESC LIMIT 1`).get(me, u.id, u.id, me) || null;
        const unread = db.prepare("SELECT COUNT(*) n FROM messages WHERE sender_id = ? AND recipient_id = ? AND id > ?").get(u.id, me, readOf("dm:" + u.id)).n;
        list.push({ key: String(u.id), last: l, unread });
      }
      send(c.res, 200, list);
    });
    route("GET", "/api/summary", async (c) => {
      const me = c.user.id;
      const allRead = db.prepare("SELECT last_id FROM reads WHERE user_id = ? AND conv = 'all'").get(me)?.last_id || 0;
      const a = db.prepare("SELECT COUNT(*) n FROM messages WHERE recipient_id IS NULL AND sender_id != ? AND id > ?").get(me, allRead).n;
      const d = db.prepare(`SELECT COUNT(*) n FROM messages m WHERE m.recipient_id = ?
    AND m.id > COALESCE((SELECT last_id FROM reads WHERE user_id = ? AND conv = 'dm:' || m.sender_id), 0)`).get(me, me).n;
      const todo = c.user.role === "admin" ? db.prepare("SELECT COUNT(*) n FROM users WHERE pending = 1 OR (reset_requested_at IS NOT NULL AND active = 1)").get().n : 0;
      const requests = c.user.role === "admin" ? timecard.pendingCount() : 0;
      const open = db.prepare("SELECT start FROM time_entries WHERE user_id = ? AND end IS NULL ORDER BY id DESC LIMIT 1").get(me);
      const latest = a + d ? db.prepare(`SELECT m.id, m.sender_id, m.recipient_id, m.body, f.name AS file_name, u.name AS sender_name FROM messages m LEFT JOIN files f ON f.id = m.file_id LEFT JOIN users u ON u.id = m.sender_id
    WHERE m.sender_id != ?1 AND ((m.recipient_id IS NULL AND m.id > ?2) OR (m.recipient_id = ?1 AND m.id > COALESCE((SELECT last_id FROM reads WHERE user_id = ?1 AND conv = 'dm:' || m.sender_id), 0)))
    ORDER BY m.id DESC LIMIT 1`).get(me, allRead) : null;
      send(c.res, 200, {
        unread: a + d,
        version: VERSION,
        update: c.user.role === "admin" ? pendingUpdate() : null,
        todo,
        requests,
        stamped: open ? open.start : null,
        latest: latest ? { id: latest.id, sender_id: latest.sender_id, sender_name: latest.sender_name || "", conv: latest.recipient_id === null ? "all" : String(latest.sender_id), text: (latest.body || "\u{1F4CE} " + (latest.file_name || "Datei")).slice(0, 160) } : null
      });
    });
    route("GET", "/api/messages", async (c) => {
      const w = c.query.get("with") || "all";
      const { sql, args } = convWhere(c.user.id, w);
      const after = Number(c.query.get("after")) || 0;
      const rows = after ? db.prepare(`${msgSelect} WHERE ${sql} AND m.id > ? ORDER BY m.id`).all(...args, after) : db.prepare(`SELECT * FROM (${msgSelect} WHERE ${sql} ORDER BY m.id DESC LIMIT 200) ORDER BY id`).all(...args);
      send(c.res, 200, rows);
    });
    route("POST", "/api/messages", async (c) => {
      const b = await readJson(c.req);
      const w = String(b.to ?? "all");
      convWhere(c.user.id, w);
      const body = str(b.body, 1e4, { label: "Nachricht" });
      const fileId = intOrNull(b.file_id);
      if (fileId !== null) {
        const f = db.prepare("SELECT 1 FROM files WHERE id = ? AND uploader_id = ? AND ctx = 'message'").get(fileId, c.user.id);
        if (!f) throw new HttpError(400, "Anhang nicht gefunden");
      }
      if (!body && fileId === null) throw new HttpError(400, "Die Nachricht ist leer");
      const r = db.prepare("INSERT INTO messages (sender_id, recipient_id, body, file_id, created_at) VALUES (?,?,?,?,?)").run(c.user.id, w === "all" ? null : Number(w), body, fileId, now());
      send(c.res, 201, db.prepare(`${msgSelect} WHERE m.id = ?`).get(r.lastInsertRowid));
    });
    route("POST", "/api/messages/read", async (c) => {
      const b = await readJson(c.req);
      const w = String(b.with ?? "all");
      const { sql, args } = convWhere(c.user.id, w);
      const max = db.prepare(`SELECT COALESCE(MAX(m.id), 0) AS id FROM messages m WHERE ${sql}`).get(...args).id;
      db.prepare("INSERT INTO reads (user_id, conv, last_id) VALUES (?,?,?) ON CONFLICT(user_id, conv) DO UPDATE SET last_id = MAX(last_id, excluded.last_id)").run(c.user.id, convKey(w), max);
      send(c.res, 200, { ok: true });
    });
    feat = require_features()({ route, send, readJson, HttpError, db, DATA: DATA2, UPLOADS, now, str, isDate, intOrNull, getSetting, setSetting, audit, userExists, fileRow, isSite, siteSees });
    var field = require_fieldwork()({ route, send, readJson, HttpError, db, now, str, isDate, intOrNull, getSetting, setSetting, audit, event: (...a) => feat.event(...a), isSite, siteSees });
    var remote = require_remote()({ route, send, readJson, HttpError, db, DATA: DATA2, UPLOADS, now, getSetting, setSetting, audit, hasUsers, isLocal, backupDir: () => feat.backupCfg().dir, VERSION });
    var timecard = require_timecard()({ route, send, readJson, HttpError, db, now, str, isDate, intOrNull, getSetting, setSetting, audit, PORT, removeUpload: (stored) => fs.rm(path2.join(UPLOADS, stored), { force: true }, () => {
    }) });
    route("POST", "/api/update/apply", { admin: true }, async (c) => {
      const v = pendingUpdate();
      if (!v) throw new HttpError(400, "Es liegt kein Update bereit");
      try {
        fs.writeFileSync(path2.join(DATA2, "app", v, "approved"), now());
      } catch {
      }
      audit(c.user.name, "Update installiert", `Version ${v}`);
      send(c.res, 200, { ok: true, version: v });
      console.log(`
  [Update] Installation von Version ${v} durch ${c.user.name} gestartet \u2026`);
      setTimeout(() => process.exit(75), 400);
    });
    var updateModeFile = path2.join(DATA2, "update-mode.txt");
    var updateMode = () => require_versions().updateMode(DATA2);
    var lastCheck = () => {
      try {
        return JSON.parse(fs.readFileSync(path2.join(DATA2, "app", "check-result.json"), "utf8"));
      } catch {
        return null;
      }
    };
    var updateInfo = () => ({ version: VERSION, pending: pendingUpdate(), mode: updateMode(), supervised: SUPERVISED, last: lastCheck(), server: !!process.env.PORTAL_SERVER });
    route("GET", "/api/admin/update", { admin: true }, async (c) => send(c.res, 200, updateInfo()));
    route("PUT", "/api/admin/update", { admin: true }, async (c) => {
      const b = await readJson(c.req);
      const m = b.mode === "manual" ? "manual" : "auto";
      fs.writeFileSync(updateModeFile, m);
      audit(c.user.name, m === "auto" ? "Updates: automatische Installation eingeschaltet" : "Updates: Installation nur noch per Klick");
      send(c.res, 200, updateInfo());
    });
    route("POST", "/api/update/check", { admin: true }, async (c) => {
      if (!SUPERVISED) throw new HttpError(400, "Die Update-Suche gibt es nur im installierten Programm");
      const before = lastCheck()?.at || "";
      fs.mkdirSync(path2.join(DATA2, "app"), { recursive: true });
      fs.writeFileSync(path2.join(DATA2, "app", "check-now"), now());
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if ((lastCheck()?.at || "") !== before) return send(c.res, 200, updateInfo());
      }
      throw new HttpError(504, "Die Update-Suche hat nicht geantwortet. Bitte sp\xE4ter erneut versuchen.");
    });
    var MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json" };
    function serveStatic(req, res, pathname) {
      const rel = pathname === "/" ? "/index.html" : pathname;
      if (sea && !EXT_PUBLIC) {
        let asset = null;
        try {
          asset = Buffer.from(sea.getAsset(rel.slice(1)));
        } catch {
        }
        if (!asset) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          return res.end("Nicht gefunden");
        }
        res.writeHead(200, { "Content-Type": MIME[path2.extname(rel)] || "application/octet-stream", "Cache-Control": "no-cache" });
        return res.end(asset);
      }
      const file = path2.normalize(path2.join(PUBLIC, rel));
      if (!file.startsWith(PUBLIC + path2.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Nicht gefunden");
      }
      res.writeHead(200, { "Content-Type": MIME[path2.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
      fs.createReadStream(file).pipe(res);
    }
    var server = http.createServer(async (req, res) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Referrer-Policy", "same-origin");
      res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-ancestors 'none'");
      const url = new URL(req.url, "http://x");
      try {
        if (!url.pathname.startsWith("/api/")) {
          if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "Nicht erlaubt");
          return serveStatic(req, res, decodeURIComponent(url.pathname));
        }
        for (const r of routes) {
          if (r.method !== req.method) continue;
          const m = r.re.exec(url.pathname);
          if (!m) continue;
          const c = { req, res, query: url.searchParams, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])), user: null };
          if (r.opts.auth) {
            c.user = getSession(req);
            if (!c.user) throw new HttpError(401, "Nicht angemeldet");
            if (r.opts.admin && c.user.role !== "admin") throw new HttpError(403, "Nur f\xFCr Admins");
            siteGuard(c, req.method, url.pathname);
            const origin = req.headers.origin;
            if (req.method !== "GET" && origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, "Ung\xFCltige Herkunft");
          }
          return await r.fn(c);
        }
        throw new HttpError(404, "Nicht gefunden");
      } catch (e) {
        if (res.headersSent) return res.destroy();
        if (e instanceof HttpError) return send(res, e.code, { error: e.message, ...e.extra || {} });
        console.error(e);
        send(res, 500, { error: "Interner Fehler" });
      }
    });
    if (!process.env.PORTAL_DESKTOP && !process.env.PORTAL_SERVER && !db.prepare("SELECT 1 FROM users LIMIT 1").get()) {
      const pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(6).toString("base64url");
      db.prepare("INSERT INTO users (username,name,position,responsibility,role,password_hash,created_at) VALUES ('admin','Administrator','Gesch\xE4ftsf\xFChrung','','admin',?,?)").run(hashPassword(pw), now());
      console.log("\n  Erster Start: Administrator-Zugang angelegt");
      console.log("  Benutzername: admin");
      console.log(`  Passwort:     ${pw}`);
      console.log("  (Bitte nach der Anmeldung unter \u201EPasswort \xE4ndern\u201C ersetzen.)\n");
    }
    var { spawn: spawn2 } = require("node:child_process");
    var openBrowser = (url) => {
      try {
        const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
        spawn2(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {
        }).unref();
      } catch {
      }
    };
    var lanUrls = () => Object.values(require("node:os").networkInterfaces()).flat().filter((n) => n && n.family === "IPv4" && !n.internal).map((n) => `http://${n.address}:${PORT}`);
    var DESKTOP = !!process.env.PORTAL_DESKTOP;
    if (DESKTOP) {
      process.stdin.on("end", () => process.exit(0)).on("error", () => process.exit(0));
      process.stdin.resume();
    }
    var waitAndExit = (code) => {
      if (DESKTOP) return process.exit(code);
      console.log("\nZum Beenden Enter dr\xFCcken \u2026");
      process.stdin.resume();
      process.stdin.once("data", () => process.exit(code));
    };
    server.on("error", (e) => {
      if (e.code === "EADDRINUSE") {
        console.log(`
Das Betriebsportal l\xE4uft bereits (Port ${PORT} ist belegt) \u2013 \xF6ffne es im Browser.`);
        if (DESKTOP) return process.exit(3);
        if (PACKAGED) {
          if (!process.env.NO_BROWSER) openBrowser(`http://localhost:${PORT}`);
          setTimeout(() => process.exit(0), 1500);
          return;
        }
      } else console.error("\nFehler:", e.message);
      PACKAGED ? waitAndExit(1) : process.exit(1);
    });
    if (process.env.PORTAL_SERVER && SUPERVISED) {
      let active = 0;
      server.on("request", (_req, res) => {
        active++;
        res.once("close", () => {
          active--;
        });
      });
      setInterval(() => {
        try {
          fs.writeFileSync(path2.join(DATA2, "app", "check-now"), now());
        } catch {
        }
      }, Math.max(1, Number(process.env.PORTAL_UPDATE_MINUTES) || 10) * 6e4).unref?.();
      setInterval(() => {
        const v = pendingUpdate();
        if (!v || updateMode() !== "auto" || active > 0) return;
        console.log(`
  [Update] Version ${v} wird automatisch installiert \u2026`);
        try {
          audit("Server", "Update automatisch installiert", `Version ${v}`);
        } catch {
        }
        process.exit(75);
      }, 2e4).unref?.();
    }
    server.listen(PORT, HOST, () => {
      if (EXT_PUBLIC) {
        try {
          fs.writeFileSync(path2.join(path2.dirname(EXT_PUBLIC), "started"), now());
        } catch {
        }
      }
      console.log(`
  Betriebsportal ${VERSION} l\xE4uft.`);
      console.log(`  Auf diesem Computer:  http://localhost:${PORT}`);
      const lan = lanUrls();
      if (lan.length) console.log(`  F\xFCr die Kollegen im Netzwerk:  ${lan.join("   ")}`);
      console.log(`  Daten gespeichert in: ${DATA2}`);
      console.log("  Dieses Fenster offen lassen \u2013 beim Schlie\xDFen wird das Portal beendet.\n");
      if (PACKAGED && !DESKTOP && !process.env.NO_BROWSER) openBrowser(`http://localhost:${PORT}`);
    });
    process.on("uncaughtException", (e) => {
      console.error("\nUnerwarteter Fehler:", e);
      PACKAGED ? waitAndExit(1) : process.exit(1);
    });
  }
});

// supervisor.js
var require_supervisor = __commonJS({
  "supervisor.js"(exports2, module2) {
    "use strict";
    var fs = require("node:fs");
    var path2 = require("node:path");
    var crypto = require("node:crypto");
    var zlib = require("node:zlib");
    var { RE, cmp, staged, updateMode, pick: pick2 } = require_versions();
    function createSupervisor({ dataDir, embedded, pubkey, bakedUrl, spawnChild, log = () => {
    }, onExit = () => {
    }, onStart = () => {
    }, fetch: doFetch = (u, o) => fetch(u, o) }) {
      const APPDIR = path2.join(dataDir, "app");
      let child = null, running = null, restarting = false, stopping = false, first = true, busy = false;
      const fails = /* @__PURE__ */ new Map();
      let lastShell = null;
      const mode = () => updateMode(dataDir);
      const writeStatus = (extra) => {
        try {
          fs.writeFileSync(path2.join(APPDIR, "check-result.json"), JSON.stringify({ at: (/* @__PURE__ */ new Date()).toISOString(), running, current: current(), configured: !!updateUrl(), shell: lastShell, ...extra }));
        } catch {
        }
      };
      function updateUrl() {
        let u = process.env.PORTAL_UPDATE_URL || "";
        if (!u) {
          try {
            u = fs.readFileSync(path2.join(dataDir, "update-url.txt"), "utf8").trim();
          } catch {
          }
        }
        u = (u || bakedUrl || "").replace(/\/+$/, "");
        if (!u) return null;
        let p;
        try {
          p = new URL(u);
        } catch {
          return null;
        }
        if (p.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(p.hostname)) return null;
        return u;
      }
      const current = () => pick2(dataDir, embedded)?.version || embedded;
      const newest = () => staged(dataDir, embedded)?.version || embedded;
      async function check() {
        const url = updateUrl();
        if (!url || !pubkey) return null;
        const r = await doFetch(`${url}/update.json?t=${Date.now()}`, { signal: AbortSignal.timeout(15e3), cache: "no-store" });
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(`Update-Server antwortet mit ${r.status}`);
        const m = await r.json();
        lastShell = m.shell && RE.test(m.shell.version || "") && /^https:\/\//.test(m.shell.url || "") ? { version: m.shell.version, url: m.shell.url } : lastShell;
        if (!RE.test(m.version) || !/^[\w.\-]+$/.test(m.file || "") || !/^[0-9a-f]{64}$/.test(m.sha256 || "") || typeof m.sig !== "string") throw new Error("Ung\xFCltige Update-Beschreibung");
        if (cmp(m.version, newest()) <= 0) return null;
        if (fs.existsSync(path2.join(APPDIR, m.version, "bad"))) return null;
        const okSig = crypto.verify(null, Buffer.from(`${m.version}
${m.sha256}`), crypto.createPublicKey(pubkey), Buffer.from(m.sig, "base64"));
        if (!okSig) throw new Error("Signatur des Updates ist ung\xFCltig \u2013 Update wird NICHT installiert");
        const fr = await doFetch(String(new URL(m.file, url + "/")), { signal: AbortSignal.timeout(12e4), cache: "no-store" });
        if (!fr.ok) throw new Error(`Update-Paket nicht ladbar (${fr.status})`);
        const buf = Buffer.from(await fr.arrayBuffer());
        if (buf.length > 60 * 1024 * 1024) throw new Error("Update-Paket ist zu gro\xDF");
        if (crypto.createHash("sha256").update(buf).digest("hex") !== m.sha256) throw new Error("Pr\xFCfsumme des Updates stimmt nicht \u2013 Update wird NICHT installiert");
        const pkg = JSON.parse(zlib.gunzipSync(buf, { maxOutputLength: 200 * 1024 * 1024 }).toString("utf8"));
        if (pkg.version !== m.version || !pkg.files || !pkg.files["portal.js"]) throw new Error("Update-Paket ist unvollst\xE4ndig");
        const tmp = path2.join(APPDIR, `.tmp-${m.version}`), dest = path2.join(APPDIR, m.version);
        fs.rmSync(tmp, { recursive: true, force: true });
        fs.rmSync(dest, { recursive: true, force: true });
        fs.mkdirSync(path2.join(tmp, "public"), { recursive: true });
        for (const [name, b64] of Object.entries(pkg.files)) {
          if (!/^(portal\.js|public\/[\w.\-]+)$/.test(name) || name.includes("..")) throw new Error(`Unerwartete Datei im Update: ${name}`);
          fs.writeFileSync(path2.join(tmp, name), Buffer.from(b64, "base64"));
        }
        fs.renameSync(tmp, dest);
        fs.writeFileSync(path2.join(dest, "ok"), (/* @__PURE__ */ new Date()).toISOString());
        for (const n of fs.readdirSync(APPDIR)) {
          if (n === m.version || n === running) continue;
          const d = path2.join(APPDIR, n);
          try {
            if (RE.test(n) && fs.existsSync(path2.join(d, "bad"))) {
              for (const f of fs.readdirSync(d)) if (f !== "bad") fs.rmSync(path2.join(d, f), { recursive: true, force: true });
            } else fs.rmSync(d, { recursive: true, force: true });
          } catch {
          }
        }
        return m.version;
      }
      function start() {
        running = current();
        restarting = false;
        const usedStaged = running !== embedded;
        child = spawnChild({ PORTAL_CHILD: "1", PORTAL_PACKAGED: "1", PORTAL_SUPERVISED: "1", ...first ? {} : { NO_BROWSER: "1" } });
        const isRestart = !first;
        first = false;
        onStart({ version: running, isRestart });
        child.on("exit", (code, signal) => {
          if (stopping) return;
          if (restarting || code === 75) return start();
          if (code === 0) return onExit(0);
          const dir = path2.join(APPDIR, running);
          if (usedStaged && !signal && !fs.existsSync(path2.join(dir, "started"))) {
            fails.set(running, (fails.get(running) || 0) + 1);
            if (fails.get(running) >= 2) {
              try {
                fs.writeFileSync(path2.join(dir, "bad"), String(code));
              } catch {
              }
              log(`Version ${running} l\xE4sst sich nicht starten \u2013 zur\xFCck zur vorherigen Version.`);
            }
            return start();
          }
          onExit(code || 1);
        });
      }
      const restart = () => {
        if (child && !restarting) {
          restarting = true;
          child.kill();
        }
      };
      const stop = () => {
        stopping = true;
        if (child) child.kill();
      };
      async function tick(initial) {
        if (busy) return;
        busy = true;
        try {
          const v = await check();
          if (v) log(`Version ${v} heruntergeladen und gepr\xFCft.`);
          writeStatus({ ok: true, found: v });
        } catch (e) {
          log(`Pr\xFCfung nicht m\xF6glich: ${e.message}`);
          writeStatus({ ok: false, error: e.message });
        } finally {
          busy = false;
        }
        if (initial) return;
        const pending = current() !== running;
        const h = (/* @__PURE__ */ new Date()).getHours();
        if (pending && mode() === "auto" && (h >= 2 && h < 5 || process.env.PORTAL_SERVER)) {
          log(`Installiere Version ${current()} \u2026`);
          restart();
        } else if (pending) log(`Version ${current()} liegt bereit \u2013 wird heute Nacht, beim n\xE4chsten Start oder per Klick (\u201EJetzt installieren\u201C) eingespielt.`);
        else if (newest() !== running && mode() === "manual") log(`Version ${newest()} liegt bereit \u2013 wartet auf die Freigabe durch einen Administrator (\u201EJetzt installieren\u201C).`);
      }
      async function run() {
        fs.mkdirSync(APPDIR, { recursive: true });
        if (updateUrl()) {
          log("Suche nach Updates \u2026");
          await tick(true);
        }
        start();
        const every = Math.max(1, Number(process.env.PORTAL_UPDATE_MINUTES) || 60) * 6e4;
        const t = setInterval(() => tick(false), every);
        t.unref?.();
        const flag = path2.join(APPDIR, "check-now");
        const w = setInterval(() => {
          if (fs.existsSync(flag)) {
            fs.rmSync(flag, { force: true });
            tick(false);
          }
        }, 2e3);
        w.unref?.();
      }
      return { run, stop, restart, check, current, updateUrl, runningVersion: () => running };
    }
    module2.exports = { createSupervisor };
  }
});

// launcher.js
var path = require("node:path");
var os = require("node:os");
var { spawn } = require("node:child_process");
var { pick } = require_versions();
var EMBEDDED = require_package().version;
var PUBKEY = true ? "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAyws5xZoB3KzaP/iGvCj6eyJoX0BTrYeUknfkEitCP2I=\n-----END PUBLIC KEY-----\n" : "";
var BAKED_URL = true ? "https://github.com/LoniGalaBauGmbH/betriebsportal-updates/releases/latest/download" : "";
var isSea = false;
try {
  isSea = require("node:sea").isSea();
} catch {
}
var DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(os.homedir(), "Betriebsportal-Daten");
if (process.env.PORTAL_CHILD === "1") {
  const s = pick(DATA, EMBEDDED);
  if (s) {
    globalThis.__PORTAL_PUBLIC = path.join(s.dir, "public");
    require("node:module").createRequire(__filename)(path.join(s.dir, "portal.js"));
  } else {
    require_server();
  }
} else {
  const { createSupervisor } = require_supervisor();
  const sup = createSupervisor({
    dataDir: DATA,
    embedded: EMBEDDED,
    pubkey: PUBKEY,
    bakedUrl: BAKED_URL,
    log: (m) => console.log(`  [Update] ${m}`),
    spawnChild: (env) => spawn(process.execPath, isSea ? [] : [__filename], { stdio: "inherit", env: { ...process.env, ...env } }),
    onExit: (code) => process.exit(code)
  });
  sup.run();
  setInterval(() => {
  }, 1 << 30);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => {
    sup.stop();
    process.exit(0);
  });
}
