# CLAUDE.md : Démonstrateur 3D

Démonstrateur 3D pédagogique dans le navigateur (WebGL2 pur, sans moteur 3D), projet personnel de Tanguy Horard. Contexte, état d'avancement et structure : [README.md](README.md). Choix et limites : [docs/DECISIONS.md](docs/DECISIONS.md).

## Commandes

- `npm run dev` : serveur de développement
- `npm run lint`, `npx tsc -b`, `npm run build`, `npm test` : à lancer avant de rendre une tâche

## Conventions

- Tout en français (texte, commentaires, documentation). Les identifiants du code restent en anglais.
- Aucun tiret cadratin ni demi-cadratin, nulle part (code, commentaires, docs).
- Les commentaires expliquent le pourquoi, pas le quoi.
- Une tâche à la fois : on ne commence pas la suivante sans validation.
- Tests obligatoires pour tout comportement ajouté. Un test doit protéger un vrai comportement, pas répéter le code.
- Architecture : `src/core/` (maths, géométrie, logique) ne dépend ni de React ni de WebGL ; `src/gl/` (WebGL, sans React) peut dépendre de `core/` ; `src/viewer/` (React) peut dépendre de `gl/` et `core/`. Jamais dans l'autre sens. Tout ce que `Viewer3D` crée (programme, shaders, buffers, VAO, boucle d'animation, observateurs, écouteurs de contexte) est libéré dans le nettoyage de son effet.
- Ne jamais committer de secret (.env, clés, jetons). Ne jamais pousser sans accord explicite.
- Le dépôt est public : pas de code ou de fichier copié d'un autre projet, pas de mention de tiers.
- Commits conventionnels (feat:, fix:, docs:, chore:...).
