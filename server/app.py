#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Backend d'administration pour le site "site-airbus".
- Python 3 standard library uniquement (aucune dépendance à installer).
- Gère : comptes, connexion (jeton), changement de mot de passe,
  permission d'édition par GROUPE de pages, et commit de data/pages.json
  dans le dépôt GitHub (le jeton reste ici, côté serveur).

Lancer :  python3 app.py            (lit ./config.json)
          python3 app.py /chemin/config.json
Variables d'environnement (prioritaires) : AIRBUS_CONFIG, GITHUB_TOKEN,
GITHUB_REPO (owner/repo), GITHUB_BRANCH, PAGES_PATH, PORT, BIND, DB_PATH.
"""
import base64, hashlib, hmac, json, os, secrets, sqlite3, sys, time, urllib.request, urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULTS = {
    "bind": "0.0.0.0",
    "port": 8080,
    "db_path": os.path.join(HERE, "users.db"),
    "session_days": 7,
    "allowed_origins": ["https://yoksip.github.io", "http://localhost:8099", "http://127.0.0.1:8099"],
    "github": {"token": "", "owner": "yoksip", "repo": "site-airbus", "branch": "main", "path": "data/pages.json"},
    "seed_users": [{"username": "thibaud", "password": "airbus123", "role": "admin", "groups": []}],
}

def load_config():
    cfg = json.loads(json.dumps(DEFAULTS))  # deep copy
    path = os.environ.get("AIRBUS_CONFIG") or (sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "config.json"))
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            user_cfg = json.load(f)
        for k, v in user_cfg.items():
            if k == "github" and isinstance(v, dict):
                cfg["github"].update(v)
            else:
                cfg[k] = v
    # env overrides
    env = os.environ
    if env.get("GITHUB_TOKEN"):  cfg["github"]["token"] = env["GITHUB_TOKEN"]
    if env.get("GITHUB_REPO"):   cfg["github"]["owner"], cfg["github"]["repo"] = env["GITHUB_REPO"].split("/", 1)
    if env.get("GITHUB_BRANCH"): cfg["github"]["branch"] = env["GITHUB_BRANCH"]
    if env.get("PAGES_PATH"):    cfg["github"]["path"] = env["PAGES_PATH"]
    if env.get("PORT"): cfg["port"] = int(env["PORT"])
    if env.get("BIND"): cfg["bind"] = env["BIND"]
    if env.get("DB_PATH"): cfg["db_path"] = env["DB_PATH"]
    return cfg

CFG = load_config()
GH = CFG["github"]

# ----------------------------------------------------------------------------
# Base de données
# ----------------------------------------------------------------------------
def db():
    con = sqlite3.connect(CFG["db_path"])
    con.row_factory = sqlite3.Row
    return con

def init_db():
    con = db()
    con.executescript("""
      CREATE TABLE IF NOT EXISTS users(
        username TEXT PRIMARY KEY, pwhash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'editor', groups TEXT NOT NULL DEFAULT '[]',
        created REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(
        token TEXT PRIMARY KEY, username TEXT NOT NULL,
        created REAL NOT NULL, expires REAL NOT NULL);
    """)
    con.commit()
    n = con.execute("SELECT COUNT(*) c FROM users").fetchone()["c"]
    if n == 0:
        for u in CFG.get("seed_users", []):
            con.execute("INSERT INTO users(username,pwhash,role,groups,created) VALUES(?,?,?,?,?)",
                        (u["username"].lower(), hash_password(u["password"]),
                         u.get("role", "editor"), json.dumps(u.get("groups", [])), time.time()))
        con.commit()
    con.close()

def hash_password(pw):
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, 200_000)
    return "pbkdf2_sha256$200000$%s$%s" % (salt.hex(), dk.hex())

def verify_password(pw, stored):
    try:
        algo, iters, salt_hex, hash_hex = stored.split("$")
        dk = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), bytes.fromhex(salt_hex), int(iters))
        return hmac.compare_digest(dk.hex(), hash_hex)
    except Exception:
        return False

def user_public(row):
    if row is None:
        return None
    return {"username": row["username"], "role": row["role"], "groups": json.loads(row["groups"] or "[]")}

# ----------------------------------------------------------------------------
# GitHub (Contents API)
# ----------------------------------------------------------------------------
def gh_request(method, url, token, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + token)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "airbus-admin")
    if data: req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        try: payload = json.loads(e.read().decode("utf-8"))
        except Exception: payload = {"message": str(e)}
        return e.code, payload

def gh_fetch_pages():
    url = f"https://api.github.com/repos/{GH['owner']}/{GH['repo']}/contents/{GH['path']}?ref={GH['branch']}"
    status, data = gh_request("GET", url, GH["token"])
    if status == 404:
        return {"site": {}, "pages": [], "footer": {}}, None
    if status != 200:
        raise RuntimeError("GitHub GET %s: %s" % (status, data.get("message")))
    raw = base64.b64decode(data["content"]).decode("utf-8")
    return json.loads(raw), data["sha"]

def gh_commit_pages(obj, sha):
    url = f"https://api.github.com/repos/{GH['owner']}/{GH['repo']}/contents/{GH['path']}"
    content = base64.b64encode(json.dumps(obj, ensure_ascii=False, indent=2).encode("utf-8")).decode("ascii")
    body = {"message": "Mise à jour du contenu — " + time.strftime("%Y-%m-%d %H:%M:%S"),
            "content": content, "branch": GH["branch"]}
    if sha: body["sha"] = sha
    status, data = gh_request("PUT", url, GH["token"], body)
    if status not in (200, 201):
        raise RuntimeError("GitHub PUT %s: %s" % (status, data.get("message")))
    return data.get("commit", {}).get("sha")

# ----------------------------------------------------------------------------
# Fusion respectant les permissions
# ----------------------------------------------------------------------------
def merge_content(current, incoming, user):
    """N'applique que ce que `user` a le droit de modifier."""
    admin = user["role"] == "admin"
    def allowed(group): return admin or (group in (user.get("groups") or []))

    out = {"site": current.get("site", {}), "footer": current.get("footer", {}), "pages": []}
    if admin:
        out["site"] = incoming.get("site", current.get("site", {}))
        out["footer"] = incoming.get("footer", current.get("footer", {}))

    cur_by_id = {p.get("id"): p for p in current.get("pages", [])}
    incoming_ids = set()
    for p in incoming.get("pages", []):
        pid = p.get("id")
        incoming_ids.add(pid)
        if allowed(p.get("group")):
            out["pages"].append(p)
        elif pid in cur_by_id:
            out["pages"].append(cur_by_id[pid])   # conservé, non modifiable
    # pages actuelles non mentionnées : supprimables seulement si autorisé
    for p in current.get("pages", []):
        if p.get("id") not in incoming_ids:
            if not allowed(p.get("group")):
                out["pages"].append(p)            # protégée : on la garde
    return out

# ----------------------------------------------------------------------------
# HTTP
# ----------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    server_version = "airbus-admin/1.0"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    # --- helpers ---
    def cors(self):
        origin = self.headers.get("Origin", "")
        origins = CFG.get("allowed_origins", ["*"])
        allow = "*" if "*" in origins else (origin if origin in origins else "")
        if allow:
            self.send_header("Access-Control-Allow-Origin", allow)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization,Content-Type")

    def send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.cors()
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n == 0: return {}
        try: return json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception: return {}

    def auth_user(self):
        h = self.headers.get("Authorization", "")
        if not h.startswith("Bearer "): return None
        token = h[7:].strip()
        con = db()
        row = con.execute("SELECT * FROM sessions WHERE token=?", (token,)).fetchone()
        if not row or row["expires"] < time.time():
            con.close(); return None
        u = con.execute("SELECT * FROM users WHERE username=?", (row["username"],)).fetchone()
        con.close()
        return user_public(u) if u else None

    def current_user_row(self):
        h = self.headers.get("Authorization", "")
        if not h.startswith("Bearer "): return None
        con = db()
        row = con.execute("SELECT * FROM sessions WHERE token=?", (h[7:].strip(),)).fetchone()
        if not row or row["expires"] < time.time():
            con.close(); return None
        u = con.execute("SELECT * FROM users WHERE username=?", (row["username"],)).fetchone()
        con.close()
        return u

    # --- verbs ---
    def do_OPTIONS(self):
        self.send_response(204); self.cors()
        self.send_header("Content-Length", "0"); self.end_headers()

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/health":
            return self.send_json(200, {"ok": True, "github": bool(GH.get("token"))})
        if path == "/api/content":
            if not self.auth_user(): return self.send_json(401, {"error": "Non authentifié"})
            try:
                obj, _ = gh_fetch_pages()
                return self.send_json(200, obj)
            except Exception as e:
                return self.send_json(502, {"error": str(e)})
        if path == "/api/me":
            u = self.auth_user()
            return self.send_json(200, {"user": u}) if u else self.send_json(401, {"error": "Non authentifié"})
        if path == "/api/users":
            u = self.current_user_row()
            if not u: return self.send_json(401, {"error": "Non authentifié"})
            if u["role"] != "admin": return self.send_json(403, {"error": "Réservé à l'administrateur"})
            con = db()
            rows = con.execute("SELECT * FROM users ORDER BY username").fetchall()
            con.close()
            return self.send_json(200, {"users": [user_public(r) for r in rows]})
        return self.send_json(404, {"error": "Route inconnue"})

    def do_POST(self):
        path = self.path.split("?")[0]
        body = self.read_json()

        if path == "/api/login":
            uname = (body.get("username") or "").lower().strip()
            pw = body.get("password") or ""
            con = db()
            row = con.execute("SELECT * FROM users WHERE username=?", (uname,)).fetchone()
            if not row or not verify_password(pw, row["pwhash"]):
                con.close(); return self.send_json(401, {"error": "Identifiant ou mot de passe incorrect."})
            token = secrets.token_urlsafe(32)
            now = time.time(); exp = now + CFG["session_days"] * 86400
            con.execute("INSERT INTO sessions(token,username,created,expires) VALUES(?,?,?,?)", (token, uname, now, exp))
            con.commit(); con.close()
            return self.send_json(200, {"token": token, "user": user_public(row)})

        if path == "/api/logout":
            h = self.headers.get("Authorization", "")
            if h.startswith("Bearer "):
                con = db(); con.execute("DELETE FROM sessions WHERE token=?", (h[7:].strip(),)); con.commit(); con.close()
            return self.send_json(200, {"ok": True})

        if path == "/api/change-password":
            u = self.current_user_row()
            if not u: return self.send_json(401, {"error": "Non authentifié"})
            old = body.get("old") or ""; new = body.get("new") or ""
            if not verify_password(old, u["pwhash"]):
                return self.send_json(400, {"error": "Mot de passe actuel incorrect."})
            if len(new) < 6:
                return self.send_json(400, {"error": "Nouveau mot de passe trop court (min. 6 caractères)."})
            con = db(); con.execute("UPDATE users SET pwhash=? WHERE username=?", (hash_password(new), u["username"]))
            con.execute("DELETE FROM sessions WHERE username=? AND token<>?", (u["username"], self.headers.get("Authorization","")[7:].strip()))
            con.commit(); con.close()
            return self.send_json(200, {"ok": True})

        if path == "/api/save":
            u = self.auth_user()
            if not u: return self.send_json(401, {"error": "Non authentifié"})
            try:
                current, sha = gh_fetch_pages()
                merged = merge_content(current, body, u)
                commit = gh_commit_pages(merged, sha)
                return self.send_json(200, {"ok": True, "commit": commit, "content": merged})
            except Exception as e:
                return self.send_json(502, {"error": str(e)})

        # /api/users  (création)  et  /api/users/<name>/password  (reset)
        if path == "/api/users":
            u = self.current_user_row()
            if not u: return self.send_json(401, {"error": "Non authentifié"})
            if u["role"] != "admin": return self.send_json(403, {"error": "Réservé à l'administrateur"})
            uname = (body.get("username") or "").lower().strip()
            pw = body.get("password") or ""
            role = body.get("role") or "editor"
            groups = body.get("groups") or []
            if not uname or not pw: return self.send_json(400, {"error": "Identifiant et mot de passe requis."})
            if role not in ("admin", "editor"): role = "editor"
            con = db()
            try:
                con.execute("INSERT INTO users(username,pwhash,role,groups,created) VALUES(?,?,?,?,?)",
                            (uname, hash_password(pw), role, json.dumps(groups), time.time()))
                con.commit()
            except sqlite3.IntegrityError:
                con.close(); return self.send_json(409, {"error": "Cet identifiant existe déjà."})
            con.close()
            return self.send_json(200, {"ok": True})

        if path.startswith("/api/users/") and path.endswith("/password"):
            u = self.current_user_row()
            if not u: return self.send_json(401, {"error": "Non authentifié"})
            if u["role"] != "admin": return self.send_json(403, {"error": "Réservé à l'administrateur"})
            target = path[len("/api/users/"):-len("/password")].strip("/")
            pw = body.get("password") or ""
            if not pw: return self.send_json(400, {"error": "Mot de passe requis."})
            con = db()
            cur = con.execute("UPDATE users SET pwhash=? WHERE username=?", (hash_password(pw), target.lower()))
            con.execute("DELETE FROM sessions WHERE username=?", (target.lower(),))
            con.commit(); con.close()
            if cur.rowcount == 0: return self.send_json(404, {"error": "Utilisateur inconnu."})
            return self.send_json(200, {"ok": True})

        return self.send_json(404, {"error": "Route inconnue"})

    def do_PATCH(self):
        path = self.path.split("?")[0]
        if path.startswith("/api/users/"):
            u = self.current_user_row()
            if not u: return self.send_json(401, {"error": "Non authentifié"})
            if u["role"] != "admin": return self.send_json(403, {"error": "Réservé à l'administrateur"})
            target = path[len("/api/users/"):].strip("/").lower()
            body = self.read_json()
            con = db()
            row = con.execute("SELECT * FROM users WHERE username=?", (target,)).fetchone()
            if not row: con.close(); return self.send_json(404, {"error": "Utilisateur inconnu."})
            role = body.get("role", row["role"])
            if role not in ("admin", "editor"): role = row["role"]
            groups = body.get("groups", json.loads(row["groups"] or "[]"))
            if target == CFG.get("seed_users", [{}])[0].get("username", "").lower() and role != "admin":
                con.close(); return self.send_json(400, {"error": "Le compte administrateur principal doit rester administrateur."})
            con.execute("UPDATE users SET role=?, groups=? WHERE username=?", (role, json.dumps(groups), target))
            con.commit(); con.close()
            return self.send_json(200, {"ok": True})
        return self.send_json(404, {"error": "Route inconnue"})

    def do_DELETE(self):
        path = self.path.split("?")[0]
        if path.startswith("/api/users/"):
            u = self.current_user_row()
            if not u: return self.send_json(401, {"error": "Non authentifié"})
            if u["role"] != "admin": return self.send_json(403, {"error": "Réservé à l'administrateur"})
            target = path[len("/api/users/"):].strip("/").lower()
            if target == u["username"]:
                return self.send_json(400, {"error": "Impossible de supprimer ton propre compte."})
            if target == CFG.get("seed_users", [{}])[0].get("username", "").lower():
                return self.send_json(400, {"error": "Impossible de supprimer le compte administrateur principal."})
            con = db()
            cur = con.execute("DELETE FROM users WHERE username=?", (target,))
            con.execute("DELETE FROM sessions WHERE username=?", (target,))
            con.commit(); con.close()
            if cur.rowcount == 0: return self.send_json(404, {"error": "Utilisateur inconnu."})
            return self.send_json(200, {"ok": True})
        return self.send_json(404, {"error": "Route inconnue"})

def main():
    init_db()
    srv = ThreadingHTTPServer((CFG["bind"], CFG["port"]), Handler)
    print("airbus-admin en écoute sur %s:%s  (GitHub: %s/%s, token %s)" % (
        CFG["bind"], CFG["port"], GH["owner"], GH["repo"], "OK" if GH.get("token") else "MANQUANT"), flush=True)
    srv.serve_forever()

if __name__ == "__main__":
    main()
