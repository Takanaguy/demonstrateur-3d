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

**Fait (ticket 2, formes de base et fichiers OBJ)**
- Un panneau au-dessus de la 3D : choix de la forme (cube, sphère, plan, cône), champ « Charger un fichier .obj », nombre de sommets et de triangles de ce qui est affiché, bouton pour revenir au cube.
- Un type commun `Mesh` (positions, normales, indices) pour tout ce qui s'affiche, avec boîte englobante et normalisation : un objet est recentré et mis à l'échelle pour tenir dans un cube de côté 2, quelle que soit son unité (un fichier en centimètres s'affiche comme un fichier en mètres).
- Un analyseur de fichiers OBJ écrit à la main (`core/obj.ts`) : faces à 3 sommets ou plus (triangulées en éventail), indices négatifs, normales du fichier ou calculées, erreurs en français avec le numéro de ligne, et des limites de taille pour qu'un fichier géant ne fige pas l'onglet.
- Un fichier refusé affiche un message d'erreur et laisse l'objet précédent à l'écran.
- Les indices 32 bits sont gérés (maillages de plus de 65 535 sommets).
- Le face culling est désactivé et la normale est retournée pour les faces vues par l'arrière : plans et fichiers ouverts sont visibles et éclairés des deux côtés.
- 363 tests (Vitest) répartis dans 17 fichiers de test. Bundle de production (sortie de `npm run build`) : JavaScript 244,12 kB (78,15 kB compressés en gzip), CSS 10,58 kB (2,91 kB compressés).
- Un maillage que le GPU refuse faute de mémoire (erreur `OUT_OF_MEMORY` lue avec `getError`, car `bufferData` ne lève rien) est signalé, et l'objet précédent reste affiché.

**Pas encore fait**
- Modèles d'éclairage (Blinn-Phong, gaussien).
- Affichage en fil de fer, des normales, de la boîte englobante (la boîte est calculée, pas encore dessinée).
- Rotation et zoom à la souris.
- Textures (les coordonnées `vt` d'un fichier OBJ sont lues puis ignorées) et matériaux (`.mtl`).
- Intégration dans l'éditeur de présentations.
- Vérification dans un vrai navigateur : les tests tournent dans jsdom, qui n'a pas de WebGL. Les maths, la géométrie, l'analyseur OBJ et les appels WebGL (vérifiés avec un faux contexte) sont testés, mais le rendu réel (formes visibles, éclairage des deux faces, rotation, redimensionnement, chargement d'un vrai fichier OBJ) reste à regarder à la main.

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
             maillage commun, boîte englobante, normalisation, normales lisses (mesh.ts),
             cube (cube.ts), plan, sphère, cône (shapes.ts), analyseur OBJ (obj.ts),
             couleurs (color.ts), rotation, détection de WebGL.
  gl/        Tout ce qui parle à WebGL, sans React : compilation des shaders (shader.ts),
             buffers et VAO (buffers.ts), dessin d'un maillage (meshRenderer.ts).
    shaders/   Les shaders en GLSL ES 3.00 : mesh.vert (sommets) et mesh.frag (fragments).
  ui/        Le panneau de choix (MeshPanel.tsx) et l'état « quel maillage afficher »
             avec le chargement des fichiers (useMeshSelection.ts).
  viewer/    Ce qui touche à React pour la 3D : le composant Viewer3D (canvas, boucle
             d'animation, redimensionnement, changement de maillage, perte de contexte, nettoyage).
  test/      Réglage des tests (setup.ts), faux contexte WebGL (fakeGl.ts) et son installation
             dans jsdom (installFakeWebGL.ts).
  App.tsx    Page d'accueil : un titre, le panneau de choix et le Viewer3D.
docs/
  DECISIONS.md   Choix techniques, raisons, limites connues.
```

Règle de dépendance : `core/` n'importe ni React ni WebGL. `gl/` peut importer `core/`. `viewer/` peut importer `gl/` et `core/`. `ui/` peut importer `core/`, pas `gl/`. Jamais dans l'autre sens. Pour réutiliser la 3D dans un autre projet, on reprend `viewer/Viewer3D.tsx` (et `gl/`, `core/`) : le composant remplit son parent, qui fixe sa taille.

## Comment un objet arrive à l'écran (le pipeline WebGL)

1. **Shaders.** Deux petits programmes écrits en GLSL tournent sur le GPU : le *vertex shader* (`mesh.vert`) place chaque sommet à l'écran, le *fragment shader* (`mesh.frag`) choisit la couleur de chaque pixel (éclairage). `gl/shader.ts` les compile et les lie en un *programme*, et lit le journal du compilateur si cela échoue.
2. **Buffers et VAO.** Les sommets du maillage (positions, normales) et ses indices (3 par triangle ; 16 bits, ou 32 bits au-delà de 65 535 sommets) sont copiés dans des *buffers*, des blocs de mémoire du GPU. Un *VAO* retient quel buffer alimente quelle entrée du shader : on le configure une fois, puis un seul appel le rebranche à chaque image.
3. **Matrices.** Trois matrices 4x4 transforment les points : *modèle* (la rotation du cube), *vue* (la position de la caméra), *projection* (la perspective, qui rapetisse ce qui est loin). La *matrice normale* (3x3, inverse transposée du modèle) fait tourner les normales sans les fausser, pour que l'éclairage reste juste. Avant l'envoi, le maillage est recentré et mis à l'échelle (cube de côté 2) : la caméra, elle, ne bouge pas. Elles sont calculées en TypeScript (`core/mat4.ts`) puis envoyées au shader sous forme d'*uniforms*, des valeurs communes à tous les sommets d'un même dessin.
4. **Boucle.** À chaque image (`requestAnimationFrame`), on avance l'angle selon le temps écoulé, on envoie les uniforms du modèle, puis `drawElements` lance le dessin. Le GPU applique le vertex shader à chaque sommet, transforme les triangles en pixels, applique le fragment shader à chaque pixel, et le test de profondeur garde le pixel le plus proche.

## Comment un fichier OBJ devient un maillage (`core/obj.ts`)

Un fichier OBJ est du texte, une instruction par ligne : `v x y z` (un point), `vn` (une normale), `f 1 2 3` (une face qui relie des points déjà cités).

1. **Lecture ligne par ligne**, en gardant le numéro de ligne pour les messages d'erreur. Les commentaires (`#`), lignes vides, fins de ligne Windows (CRLF) et directives inconnues sont ignorés. Les fins de ligne « Mac classique » (retour chariot seul) sont refusées avec un message clair.
2. **Indices.** Dans une face, les indices commencent à **1** (pas à 0), et un indice **négatif** compte depuis la fin (`-1` = le dernier point lu jusque-là). 0 ou un indice qui sort des bornes est une erreur avec son numéro de ligne.
3. **Triangulation en éventail.** Une face à 4 sommets ou plus est coupée en triangles autour de son premier sommet : `(0,1,2)`, `(0,2,3)`, `(0,3,4)`... Cela suppose un polygone convexe.
4. **Déduplication.** Un sommet GPU est une paire (position, normale). Une `Map` garde la liste des paires déjà vues : un point cité par dix triangles n'est envoyé qu'une fois.
5. **Normales.** Si le fichier n'en donne pas, on les calcule : pour chaque sommet, la moyenne des normales des triangles qui le touchent, pondérée par leur aire (aspect lisse).

Le fichier venant de l'utilisateur, des limites bornent la taille du texte, des lignes, le nombre de points, de faces, de triangles et de sommets par face (constantes `MAX_OBJ_*` en tête de `obj.ts`). Le fichier est aussi refusé avant lecture s'il pèse plus de 50 Mo.

### Taille du composant

Le parent doit avoir une taille, le canvas la remplit : par défaut `Viewer3D` est rendu avec `block h-full w-full`. On peut passer un `className` pour le dimensionner autrement (par exemple `aspect-video w-full`), mais il REMPLACE la taille par défaut au lieu de s'y ajouter : il doit donc fixer lui-même la taille. Sans aucune taille CSS, le canvas prendrait la taille de ses attributs `width` et `height`, que le composant réécrit à chaque redimensionnement (taille affichée multipliée par le ratio de pixels) : il grossirait sans fin sur un écran à haute densité de pixels.

## Technologies

React 19, Vite 8, TypeScript 6 (mode strict), Tailwind CSS 4, WebGL2 (sans bibliothèque 3D), Vitest avec React Testing Library et jsdom, ESLint 10. Mêmes versions d'outils que le projet frère « éditeur de présentations ».
