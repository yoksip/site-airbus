# site-airbus — site + administration, 100 % sur GitHub

Site statique (thème aéronautique) publié sur **GitHub Pages**, avec une administration
**sans aucun serveur** : la connexion et l'enregistrement passent directement par **l'API GitHub**.

- **Contenu** : `data/pages.json` (pages + groupes + identité du site), committé dans le dépôt.
- **Droits d'accès** : `data/access.json` — pour chaque **compte GitHub**, un rôle (`admin` /
  `editor`) et la liste des **groupes de pages** qu'il peut modifier.
- **Connexion** : compte GitHub (jeton d'accès personnel, ou OAuth « device flow »).
- Rien à héberger : tout vit dans le dépôt, GitHub Pages sert le site.

## Modèle de droits

- Un **administrateur** (`role: "admin"`) modifie tout et gère les droits.
- Un **éditeur** (`role: "editor"`, `groups: ["ZQIRO"]`) ne modifie que les pages du/des
  groupe(s) indiqué(s) ; les autres pages apparaissent en **lecture seule**.

`data/access.json` :
```json
{
  "users": {
    "yoksip":   { "role": "admin",  "groups": [] },
    "alain-d":  { "role": "editor", "groups": ["ZQIRO"] }
  }
}
```
La clé est le **login GitHub** du compte. En dépôt **privé**, garder ce fichier est sans risque.

> ⚠️ Un site statique n'a pas de contrôle serveur : les droits sont appliqués par l'interface
> (grisage des pages non autorisées). La **vraie barrière** est GitHub lui-même : en dépôt
> **privé**, seuls les membres du dépôt peuvent lire/écrire, et chaque écriture est signée par
> l'identité GitHub de l'auteur (historique dans les commits).

## Structure

```
index.html            Page publique (lit data/pages.json)
admin.html            Panneau d'administration (connexion GitHub + édition WYSIWYG)
data/pages.json        Contenu du site
data/access.json       Droits par compte GitHub
assets/style.css       Thème public
assets/app.js          Rendu de la page publique
assets/admin.css       Styles du panneau
assets/admin.js        Logique d'administration (API GitHub)
assets/config.js       ← owner / repo / branche / chemins / OAuth client_id
assets/plane.svg        Illustration d'avion
.nojekyll
```

## Mise en route

1. Pousse ce dossier dans ton dépôt (sous ton compte/organisation).
2. **Settings → Pages** → *Deploy from a branch* → `main` / `/root`.
3. Ouvre `admin.html`, connecte-toi avec un compte GitHub (jeton ou OAuth).
   Au **premier login**, si `data/access.json` n'existe pas, ce compte devient **administrateur**
   et le fichier est créé automatiquement.
4. Édite, puis **Enregistrer** → commit dans le dépôt ; le site se met à jour en ~1 min.

Détails (jetons, OAuth App, questions de sécurité) → **DEPLOY.md**.
