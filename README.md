# Démonstrateur 3D

Démonstrateur 3D pédagogique, dans le navigateur : à terme, on pourra y charger des formes de base ou des fichiers OBJ, changer le modèle d'éclairage, afficher le fil de fer, les normales et la boîte englobante, et tourner autour de l'objet à la souris. Il s'inspire d'un projet de cours d'OpenGL, refait ici avec les technologies du web.

Projet personnel de Tanguy Horard. Il pourra plus tard être intégré comme élément dans un autre projet à lui (un éditeur de présentations) : c'est pour cela que la logique est séparée de l'interface (voir [Structure](#structure-des-dossiers)).

Réalisé avec l'assistance de Claude Code. Les choix et leurs raisons sont dans [docs/DECISIONS.md](docs/DECISIONS.md).

## Où en est le projet

**Fait (ticket 1, mise en place)**
- Projet Vite, React 19, TypeScript strict, Tailwind CSS 4, ESLint, tests Vitest.
- Un cube éclairé sur fond uni, qui tourne lentement.
- La rotation s'arrête si l'utilisateur a demandé moins de mouvement (réglage système `prefers-reduced-motion`).
- Si WebGL n'est pas disponible, un message en français s'affiche à la place de la 3D.
- Le renderer Three.js est créé et détruit proprement (compatible avec le double montage de StrictMode).

**Pas encore fait**
- Formes de base (sphère, cylindre, etc.) et chargement de fichiers OBJ (il n'y a pas d'analyseur OBJ).
- Modèles d'éclairage (Blinn-Phong, gaussien).
- Affichage en fil de fer, des normales, de la boîte englobante.
- Rotation et zoom à la souris.
- Intégration dans l'éditeur de présentations.
- Vérification dans un vrai navigateur : les tests tournent dans jsdom, qui n'a pas de WebGL. Le rendu réel (cube visible, rotation, redimensionnement) reste à regarder à la main.

## Lancer le projet

Il faut Node.js (version 24 utilisée pour le développement) et npm.

```bash
npm install
npm run dev
```

Puis ouvrir l'adresse affichée par Vite (en général http://localhost:5173).

## Scripts

| Commande | Rôle |
| --- | --- |
| `npm run dev` | Serveur de développement avec rechargement à chaud |
| `npm run build` | Vérification TypeScript puis build de production dans `dist/` |
| `npm run preview` | Sert le build de production en local |
| `npm run lint` | ESLint sur tout le projet |
| `npm test` | Lance tous les tests une fois (Vitest) |
| `npm run test:watch` | Relance les tests à chaque modification |

## Structure des dossiers

```
src/
  core/      Logique sans React ni Three.js : détection de WebGL, calcul de la rotation.
             Le futur analyseur OBJ et les calculs (normales, boîte englobante) iront ici.
  viewer/    Ce qui touche à Three.js et à React : le composant Viewer3D (canvas, renderer,
             boucle d'animation, nettoyage) et la construction de la scène.
  test/      Réglage des tests (setup.ts).
  App.tsx    Page d'accueil : un titre et le Viewer3D.
docs/
  DECISIONS.md   Choix techniques, raisons, limites connues.
```

Règle de dépendance : `core/` n'importe ni React ni Three.js. `viewer/` peut importer `core/`, jamais l'inverse. Pour réutiliser la 3D dans un autre projet, on reprend `viewer/Viewer3D.tsx` (et `core/`) : le composant remplit son parent, qui fixe sa taille.

### Taille du composant

Le parent doit avoir une taille, le canvas la remplit : par défaut `Viewer3D` est rendu avec `block h-full w-full`. On peut passer un `className` pour le dimensionner autrement (par exemple `aspect-video w-full`), mais il REMPLACE la taille par défaut au lieu de s'y ajouter : il doit donc fixer lui-même la taille. Sans aucune taille CSS, Three.js réécrirait la taille du canvas à chaque redimensionnement et il grossirait sans fin sur un écran à haute densité de pixels.

## Technologies

React 19, Vite 8, TypeScript 6 (mode strict), Tailwind CSS 4, Three.js, Vitest avec React Testing Library et jsdom, ESLint 10. Mêmes versions d'outils que le projet frère « éditeur de présentations ».
