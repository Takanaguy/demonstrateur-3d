# CLAUDE.md : Démonstrateur 3D

Démonstrateur 3D pédagogique dans le navigateur (Three.js), projet personnel de Tanguy Horard. Contexte, état d'avancement et structure : [README.md](README.md). Choix et limites : [docs/DECISIONS.md](docs/DECISIONS.md).

## Commandes

- `npm run dev` : serveur de développement
- `npm run lint`, `npx tsc -b`, `npm run build`, `npm test` : à lancer avant de rendre une tâche

## Conventions

- Tout en français (texte, commentaires, documentation). Les identifiants du code restent en anglais.
- Aucun tiret cadratin ni demi-cadratin, nulle part (code, commentaires, docs).
- Les commentaires expliquent le pourquoi, pas le quoi.
- Une tâche à la fois : on ne commence pas la suivante sans validation.
- Tests obligatoires pour tout comportement ajouté. Un test doit protéger un vrai comportement, pas répéter le code.
- Architecture : `src/core/` ne dépend ni de React ni de Three.js ; `src/viewer/` peut dépendre de `core/`, jamais l'inverse. Tout ce que `Viewer3D` crée (renderer, géométries, matériaux, boucle d'animation, observateurs) est libéré dans le nettoyage de son effet.
- Ne jamais committer de secret (.env, clés, jetons). Ne jamais pousser sans accord explicite.
- Le dépôt est public : pas de code ou de fichier copié d'un autre projet, pas de mention de tiers.
- Commits conventionnels (feat:, fix:, docs:, chore:...).
