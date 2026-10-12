# Déploiement

## 1. Frontend (GitHub Pages)

Rien à faire : le dépôt est déjà poussé, active **Settings → Pages → Deploy from a branch →
`main` / `/root`** si ce n'est pas déjà fait.

Site : `https://yoksip.github.io/site-airbus/`
Admin : `https://yoksip.github.io/site-airbus/admin.html`

Renseigne ensuite l'adresse du backend dans `assets/config.js` :

```js
window.SITE_CONFIG = { apiBase: "http://192.168.1.123:8080" };
```

(ou l'URL HTTPS publique si tu l'exposes via NPM, ex. `https://admin-airbus.tondomaine`).

## 2. Backend (LXC Proxmox, Python standard — aucune dépendance)

### a) Créer un conteneur Debian 12 (1 vCPU / 512 Mo / 8 Go), IP statique (ex. 192.168.1.123).

### b) Installer les fichiers

```bash
apt-get update && apt-get install -y python3      # python3 est déjà là sur Debian 12

# utilisateur système dédié
useradd --system --home /opt/airbus-admin --shell /usr/sbin/nologin airbus
mkdir -p /opt/airbus-admin /etc/airbus-admin /var/lib/airbus-admin
cp server/app.py /opt/airbus-admin/
cp server/config.example.json /etc/airbus-admin/config.json

# token GitHub (scope repo) et chemins
chmod 600 /etc/airbus-admin/config.json
chown -R airbus:airbus /opt/airbus-admin /var/lib/airbus-admin

# service
cp server/airbus-admin.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now airbus-admin
systemctl status airbus-admin --no-pager
```

### c) Config `config.json`

- `github.token` : jeton *fine-grained* limité au dépôt `site-airbus`, permission
  **Contents: Read and write** (ou un jeton classique scope `repo`).
- `allowed_origins` : mets l'origine exacte de la page d'admin
  (`https://yoksip.github.io`).
- `seed_users` : crée `thibaud` / `airbus123` au premier démarrage (base vide).

### d) Vérifier

```bash
curl http://192.168.1.123:8080/api/health
# {"ok": true, "github": true}
```

## 3. Exposition via NPM (optionnel, pour l'accès depuis Internet)

NPM (CT106, 192.168.1.250) → **Add Proxy Host** :
- Domain : `admin-airbus.<ton-domaine>`
- Forward Hostname/IP : `192.168.1.123`, Port : `8080`
- WebSocket Support : on, SSL Let's Encrypt : on
- Puis mets `apiBase` dans `assets/config.js` sur l'URL HTTPS, et ajoute cette origine
  dans `allowed_origins`.

## 4. Utilisation

1. `admin.html` → connexion `thibaud` / `airbus123`.
2. **Mon compte** → change ton mot de passe.
3. **Utilisateurs** → crée `Alain` (rôle *éditeur*, groupes : `ZQIRO`).
4. **Pages** → crée/édite les pages ; Alain ne verra en édition que les pages `ZQIRO`.
5. **Enregistrer** → commit dans GitHub ; GitHub Pages met à jour le site en ~1 min.
