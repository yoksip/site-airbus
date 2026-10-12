# Déploiement & connexion

## 0. Vue d'ensemble

Tout est **statique sur GitHub**. Il n'y a **aucun backend**. Conséquence importante :

> Dans un dépôt **privé**, rien n'est lisible sans authentification. Le « login » du site
> **passe donc obligatoirement par GitHub** (jeton ou OAuth). Un simple mot de passe maison
> ne suffirait pas : il faudrait quand même un jeton pour lire/écrire le contenu.

Trois niveaux, à choisir/combinner :

1. **Accès au site (lecture)** — GitHub Pages d'un dépôt privé : accessible uniquement aux
   membres de l'organisation (SSO d'entreprise). *Nécessite GitHub Enterprise.*
2. **Identité pour éditer** — l'utilisateur se connecte avec son compte GitHub (voir §1).
3. **Droits par page** — `data/access.json` mappe chaque login GitHub → rôle + groupes.

## 1. Options de connexion

### A) Jeton d'accès personnel (PAT) — le plus simple

Chaque éditeur crée **une fois** un jeton et le colle dans le panneau. Le jeton reste dans
son navigateur (localStorage), jamais dans le dépôt.

Créer le jeton : GitHub → *Settings → Developer settings → **Fine-grained tokens*** →
*Repository access* = **ton dépôt** → *Repository permissions → **Contents : Read and write***.

> Pour un dépôt d'entreprise, un jeton **fine-grained** limité au seul dépôt est préférable à
> un jeton classique (scope `repo`).

### B) OAuth « device flow » (recommandé en entreprise : pas de jeton à coller)

Permet un bouton **« Se connecter avec GitHub »** sans secret côté client (donc sans serveur).

1. Créer une **OAuth App** (org → *Settings → Developer settings → OAuth Apps*) :
   - *Authorization callback URL* : n'importe quelle URL valide (ex. `https://<ton-site>`).
   - **Activer « Enable Device Flow »**.
2. Récupérer le **Client ID**.
3. Dans `assets/config.js` : `oauthClientId: "<client_id>"` (et `oauthScope: "repo"`).
   Le bouton apparaît ; l'utilisateur saisit un code sur `github.com/login/device`.

### C) Mot de passe maison — non recommandé

Sur un site statique, c'est **purement cosmétique** (le code est côté navigateur) et il faut
**quand même** un jeton pour enregistrer. À réserver à une démo publique en lecture.

## 2. Droits (`data/access.json`)

```json
{ "users": {
    "login-github-admin":  { "role": "admin",  "groups": [] },
    "login-github-alain":  { "role": "editor", "groups": ["ZQIRO"] }
} }
```

- Clé = **login GitHub** exact.
- `role` : `admin` (tout) ou `editor` (limité à `groups`).
- Modifiable depuis l'onglet **Droits d'accès** (admin), qui committe le fichier.

## 3. Migration vers un GitHub d'entreprise privé

1. Crée le dépôt **privé** dans l'org ; pousse le contenu de ce dossier.
2. Active **Pages** (Enterprise) — l'accès à la page suit les droits de l'org.
3. Adapte `assets/config.js` : `owner`, `repo`, `branch`.
4. Chaque éditeur : PAT fine-grained (option A) ou OAuth App de l'org (option B).
5. `data/access.json` : remplace les logins par ceux de tes collègues.

## 4. Vérifier

- Page publique : `https://<owner>.github.io/<repo>/`
- Admin : `https://<owner>.github.io/<repo>/admin.html`
- 1er login (dépôt sans `access.json`) → ce compte devient administrateur.
