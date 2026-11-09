# Démonstrateur 3D

Démonstrateur 3D pédagogique, dans le navigateur : à terme, on pourra y charger des formes de base ou des fichiers OBJ, changer le modèle d'éclairage, afficher le fil de fer, les normales et la boîte englobante, et tourner autour de l'objet à la souris. Il s'inspire d'un projet de cours d'OpenGL écrit sans moteur 3D, refait ici avec les technologies du web : du WebGL2 écrit à la main, sans Three.js ni autre bibliothèque 3D.

Projet personnel de Tanguy Horard. Il pourra plus tard être intégré comme élément dans un autre projet à lui (un éditeur de présentations) : c'est pour cela que la logique est séparée de l'interface (voir [Structure](#structure-des-dossiers)).

Réalisé avec l'assistance de Claude Code. Les choix et leurs raisons sont dans [docs/DECISIONS.md](docs/DECISIONS.md).

## Où en est le projet

**Fait (ticket 1, mise en place)**
- Projet Vite, React 19, TypeScript strict, Tailwind CSS 4, ESLint, tests Vitest.
- Un cube sur fond uni, qui tourne lentement.
- La rotation s'arrête si l'utilisateur a demandé moins de mouvement (réglage système `prefers-reduced-motion`).
- Si WebGL n'est pas disponible, un message en français s'affiche à la place de la 3D.

**Fait (ticket 1b, WebGL2 pur à la place de Three.js)**
- Three.js est retiré. Le cube est dessiné avec du WebGL2 écrit à la main : maths des matrices en TypeScript (`core/mat4.ts`), shaders GLSL (`gl/shaders/`), buffers et VAO (`gl/`).
- Éclairage : une lumière directionnelle (modèle de Lambert) plus une part ambiante, calculés dans le fragment shader.
- Les ressources GPU (programme, buffers, VAO) sont créées et supprimées proprement, y compris avec le double montage de StrictMode.
- Si le navigateur perd le contexte WebGL puis le rend (veille, pilote), le dessin est recréé et reprend tout seul.
- Si les shaders sont refusés, le message de repli s'affiche et le journal du compilateur va dans la console.
- 163 tests (Vitest) : maths, géométrie, helpers WebGL avec un faux contexte, cycle de vie du composant. Bundle de production : 232 kB (752 kB avec Three.js).

**Pas encore fait**
- Formes de base (sphère, cylindre, etc.) et chargement de fichiers OBJ (il n'y a pas d'analyseur OBJ).
- Modèles d'éclairage (Blinn-Phong, gaussien).
- Affichage en fil de fer, des normales, de la boîte englobante.
- Rotation et zoom à la souris.
- Intégration dans l'éditeur de présentations.
- Vérification dans un vrai navigateur : les tests tournent dans jsdom, qui n'a pas de WebGL. Les maths, la géométrie et les appels WebGL (vérifiés avec un faux contexte) sont testés, mais le rendu réel (cube visible, couleurs, éclairage, rotation, redimensionnement) reste à regarder à la main.

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
  core/      Logique pure, sans React ni WebGL : matrices (mat4.ts), vecteurs (vec3.ts),
             géométrie du cube (cube.ts), couleurs (color.ts), rotation, détection de WebGL.
             Le futur analyseur OBJ et les calculs (normales, boîte englobante) iront ici.
  gl/        Tout ce qui parle à WebGL, sans React : compilation des shaders (shader.ts),
             buffers et VAO (buffers.ts), dessin du cube (cubeRenderer.ts).
    shaders/   Les shaders en GLSL ES 3.00 : cube.vert (sommets) et cube.frag (fragments).
  viewer/    Ce qui touche à React : le composant Viewer3D (canvas, boucle d'animation,
             redimensionnement, perte de contexte, nettoyage).
  test/      Réglage des tests (setup.ts) et faux contexte WebGL (fakeGl.ts).
  App.tsx    Page d'accueil : un titre et le Viewer3D.
docs/
  DECISIONS.md   Choix techniques, raisons, limites connues.
```

Règle de dépendance : `core/` n'importe ni React ni WebGL. `gl/` peut importer `core/`. `viewer/` peut importer `gl/` et `core/`. Jamais dans l'autre sens. Pour réutiliser la 3D dans un autre projet, on reprend `viewer/Viewer3D.tsx` (et `gl/`, `core/`) : le composant remplit son parent, qui fixe sa taille.

## Comment le cube arrive à l'écran (le pipeline WebGL)

1. **Shaders.** Deux petits programmes écrits en GLSL tournent sur le GPU : le *vertex shader* (`cube.vert`) place chaque sommet à l'écran, le *fragment shader* (`cube.frag`) choisit la couleur de chaque pixel (éclairage). `gl/shader.ts` les compile et les lie en un *programme*, et lit le journal du compilateur si cela échoue.
2. **Buffers et VAO.** Les 24 sommets du cube (positions, normales) et les 36 indices (12 triangles) sont copiés dans des *buffers*, des blocs de mémoire du GPU. Un *VAO* retient quel buffer alimente quelle entrée du shader : on le configure une fois, puis un seul appel le rebranche à chaque image.
3. **Matrices.** Trois matrices 4x4 transforment les points : *modèle* (la rotation du cube), *vue* (la position de la caméra), *projection* (la perspective, qui rapetisse ce qui est loin). La *matrice normale* (3x3, inverse transposée du modèle) fait tourner les normales sans les fausser, pour que l'éclairage reste juste. Elles sont calculées en TypeScript (`core/mat4.ts`) puis envoyées au shader sous forme d'*uniforms*, des valeurs communes à tous les sommets d'un même dessin.
4. **Boucle.** À chaque image (`requestAnimationFrame`), on avance l'angle selon le temps écoulé, on envoie les uniforms du modèle, puis `drawElements` lance le dessin. Le GPU applique le vertex shader à chaque sommet, transforme les triangles en pixels, applique le fragment shader à chaque pixel, et le test de profondeur garde le pixel le plus proche.

### Taille du composant

Le parent doit avoir une taille, le canvas la remplit : par défaut `Viewer3D` est rendu avec `block h-full w-full`. On peut passer un `className` pour le dimensionner autrement (par exemple `aspect-video w-full`), mais il REMPLACE la taille par défaut au lieu de s'y ajouter : il doit donc fixer lui-même la taille. Sans aucune taille CSS, le canvas prendrait la taille de ses attributs `width` et `height`, que le composant réécrit à chaque redimensionnement (taille affichée multipliée par le ratio de pixels) : il grossirait sans fin sur un écran à haute densité de pixels.

## Technologies

React 19, Vite 8, TypeScript 6 (mode strict), Tailwind CSS 4, WebGL2 (sans bibliothèque 3D), Vitest avec React Testing Library et jsdom, ESLint 10. Mêmes versions d'outils que le projet frère « éditeur de présentations ».
