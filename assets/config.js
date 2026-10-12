/* Configuration du site (100 % GitHub, sans backend).
   - Renseigne owner/repo/branch de TON dépôt (privé, côté entreprise).
   - contentPath / accessPath : chemins des fichiers de contenu et d'accès.
   - oauthClientId : laisse "" pour se connecter via un jeton d'accès,
     ou mets le client_id d'une OAuth App GitHub pour activer
     "Se connecter avec GitHub" (device flow, sans secret). */
window.SITE_CONFIG = {
  owner: "yoksip",
  repo: "site-airbus",
  branch: "main",
  contentPath: "data/pages.json",
  accessPath: "data/access.json",
  oauthClientId: "",
  oauthScope: "repo"
};
