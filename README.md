# site-airbus — site + administration multi-utilisateurs

Site statique (thème aéronautique) publié sur **GitHub Pages**, avec une administration
**multi-utilisateurs** reposant sur un petit backend qui :

- gère les comptes et la connexion (jeton),
- applique des **permissions d'édition par groupe de pages**,
- permettent à chacun de **changer son mot de passe**,
- **enregistre le contenu** (`data/pages.json`) dans ce dépôt via l'API GitHub,
  avec un jeton conservé **côté serveur** (jamais exposé au navigateur).

## Rôles

- **thibaud** (administrateur) : peut tout modifier, gérer les utilisateurs.
- **Alain** (éditeur) : ne peut modifier que les pages du/des groupe(s) qui lui sont attribués
  (ex. le groupe **ZQIRO**). Toutes les autres pages lui apparaissent en **lecture seule**.

Les permissions sont vérifiées **côté serveur** à l'enregistrement : un éditeur ne peut pas
toucher aux pages d'un groupe qu'il n'a pas, même en trafiquant le navigateur.

## Structure

```
index.html            Page publique (lit data/pages.json)
admin.html            Panneau d'administration (connexion + édition)
data/pages.json        Contenu du site (pages + groupes + identité)
assets/style.css       Thème public
assets/app.js          Rendu de la page publique
assets/admin.css       Styles du panneau
assets/admin.js        Logique d'administration (appelle le backend)
assets/config.js       ← définir apiBase = adresse du backend
assets/plane.svg        Illustration d'avion
server/app.py          Backend (Python standard, 0 dépendance)
server/config.example.json   Config du backend (à copier en config.json)
server/airbus-admin.service  Unité systemd
.nojekyll             (GitHub Pages)
```

## Mise en ligne

Voir **DEPLOY.md** (déploiement du backend sur un LXC Proxmox, en LAN, puis via NPM).

## Modèle de données — `data/pages.json`

```json
{
  "site": { "brand": "...", "tagline": "...", "hero": { "kicker": "", "title": "", "subtitle": "" } },
  "pages": [
    { "id": "zqiro", "group": "ZQIRO", "title": "Projet ZQIRO", "html": "<p>…</p>" }
  ],
  "footer": { "text": "", "copyright": "" }
}
```

Le **groupe** d'une page (`"group"`) détermine qui peut l'éditer.

## Identifiants par défaut

- `thibaud` / `airbus123` — **à changer dès la première connexion** (onglet *Mon compte*).

> Sécurité : le backend n'est pour l'instant **exposé qu'en réseau local**. Pour un accès
> depuis Internet, place-le derrière Nginx Proxy Manager (HTTPS) et restreins l'accès si besoin.
