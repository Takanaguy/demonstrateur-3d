# Démonstrateur 3D

Démonstrateur 3D pédagogique, dans le navigateur : on peut y charger des formes de base ou des fichiers OBJ, changer le modèle d'éclairage et tourner autour de l'objet à la souris, au doigt ou au clavier ; à terme, on pourra aussi afficher le fil de fer, les normales et la boîte englobante. Il s'inspire d'un projet de cours d'OpenGL écrit sans moteur 3D, refait ici avec les technologies du web : du WebGL2 écrit à la main, sans Three.js ni autre bibliothèque 3D.

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
- Éclairage de départ : une lumière directionnelle (modèle de Lambert) plus une part ambiante, calculés dans le fragment shader (remplacé au ticket 3 par une lumière ponctuelle réglable).
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

**Fait (ticket 3, modèles d'éclairage et lumière réglable)**
- Trois modèles au choix, dans un seul fragment shader : Lambert (diffus seul, sans reflet), Blinn-Phong et Gaussien (qui ajoutent un reflet au diffus). Le modèle est choisi par un uniform entier, sans recompiler le programme.
- La lumière est maintenant ponctuelle : sa position se règle dans le monde (x, y, z), la direction vers la lumière est calculée pour chaque pixel. La caméra est envoyée au shader pour calculer la direction vers l'oeil.
- Un panneau d'éclairage sous (ou à côté de) celui du maillage : modèle, position, couleur de la lumière, lumière ambiante, intensité du reflet, brillance (Blinn-Phong), moyenne et écart type (Gaussien), bouton « Réinitialiser l'éclairage ». Les réglages inutiles pour le modèle choisi sont masqués.
- Les réglages (`core/lighting.ts`) sont bornés avant d'aller au GPU : jamais de NaN dans un uniform. Les deux formules de reflet existent aussi en TypeScript, comme référence testable (les shaders ne sont pas exécutés par les tests).
- Un changement d'éclairage ne recrée ni le canvas, ni le contexte, ni le maillage ; après une perte de contexte, les derniers réglages reviennent.
- 473 tests (Vitest) répartis dans 20 fichiers de test. Bundle de production (sortie de `npm run build`) : JavaScript 252,94 kB (80,73 kB compressés en gzip), CSS 11,71 kB (3,16 kB compressés).

**Fait (ticket 4a, caméra orbitale et options de vue)**
- La caméra n'est plus fixe : on tourne autour de l'objet et on zoome (voir [Commandes](#commandes)). La caméra est décrite en coordonnées sphériques (azimut, élévation, distance) dans `core/camera.ts`, bornée (l'élévation n'atteint jamais les pôles, la distance reste entre 2,5 et 12) et assainie avant d'aller au GPU.
- L'objet ne reçoit plus d'inclinaison fixe : il tourne seulement sur lui-même autour de l'axe vertical, et l'inclinaison de départ vient de la caméra (élévation 0,4 rad).
- Un panneau « vue » : case « Rotation automatique de l'objet », case « Masquer les faces vues de dos (culling) » (avec un avertissement : un fichier OBJ aux triangles à l'envers devient invisible), bouton « Réinitialiser la caméra ».
- La 3D est placée avant les panneaux et reste collée en haut de l'écran sur petit écran, pour voir l'effet des réglages sans remonter (hauteur plafonnée à 45 % de l'écran, et marge de défilement pour que le focus clavier ne passe pas derrière elle).
- Un glisser abandonné si le bouton a été lâché hors de la fenêtre (`buttons === 0`, `lostpointercapture`), et une phrase d'explication sous la case de rotation automatique quand le système demande moins de mouvement.
- Le canvas est un composant clavier : il prend le focus, a un contour de focus visible et un rôle ARIA adapté (voir la décision 18).
- Après une perte de contexte WebGL, la caméra COURANTE et les options de vue reviennent.
- 617 tests (Vitest) répartis dans 25 fichiers de test. Bundle de production (sortie de `npm run build`) : JavaScript 258,58 kB (82,43 kB compressés en gzip), CSS 12,77 kB (3,52 kB compressés).

**Pas encore fait**
- Affichage en fil de fer, des normales, de la boîte englobante, de la grille et des axes (ticket 4b ; la boîte est calculée, pas encore dessinée).
- Pincement à deux doigts pour zoomer, déplacement latéral (pan).
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

## Commandes

Sur l'image 3D (le canvas) :

| Action | Souris | Doigt | Clavier (l'image doit avoir le focus) |
| --- | --- | --- | --- |
| Tourner autour de l'objet | Glisser avec le bouton gauche | Glisser | Flèches |
| Zoomer / dézoomer | Molette | non géré (pas de pincement) | `+` (ou `=`) / `-` |
| Revenir au point de vue de départ | Bouton « Réinitialiser la caméra » | idem | idem |

Faire glisser de toute la largeur de l'image fait un tour complet. Une flèche a le même effet qu'un glisser dans sa direction. Ctrl, Cmd et Alt avec `+` ou `-` gardent leur rôle de zoom du navigateur. Pour que le glisser tactile tourne la caméra au lieu de faire défiler la page, le canvas désactive le défilement par le toucher (`touch-action: none`) : sur mobile, la page ne défile plus quand le doigt est sur l'image 3D (voir les limites dans [docs/DECISIONS.md](docs/DECISIONS.md)).

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
             couleurs (color.ts), réglages et formules d'éclairage (lighting.ts), caméra
             orbitale (camera.ts), options de vue (viewOptions.ts), rotation, détection de WebGL.
  gl/        Tout ce qui parle à WebGL, sans React : compilation des shaders (shader.ts),
             buffers et VAO (buffers.ts), dessin d'un maillage (meshRenderer.ts).
    shaders/   Les shaders en GLSL ES 3.00 : mesh.vert (sommets) et mesh.frag (fragments).
  ui/        Le panneau de choix du maillage (MeshPanel.tsx), l'état « quel maillage afficher »
             avec le chargement des fichiers (useMeshSelection.ts), le panneau d'éclairage
             (LightingPanel.tsx) et le panneau de la vue (ViewPanel.tsx).
  viewer/    Ce qui touche à React pour la 3D : le composant Viewer3D (canvas, boucle
             d'animation, redimensionnement, changement de maillage, d'éclairage et d'options de vue,
             commandes de la caméra à la souris, au doigt et au clavier, perte de contexte, nettoyage).
  test/      Réglage des tests (setup.ts), faux contexte WebGL (fakeGl.ts) et son installation
             dans jsdom (installFakeWebGL.ts).
  App.tsx    Page d'accueil : un titre, le Viewer3D puis les trois panneaux (maillage, éclairage, vue).
docs/
  DECISIONS.md   Choix techniques, raisons, limites connues.
```

Règle de dépendance : `core/` n'importe ni React ni WebGL. `gl/` peut importer `core/`. `viewer/` peut importer `gl/` et `core/`. `ui/` peut importer `core/`, pas `gl/`. Jamais dans l'autre sens. Pour réutiliser la 3D dans un autre projet, on reprend `viewer/Viewer3D.tsx` (et `gl/`, `core/`) : le composant remplit son parent, qui fixe sa taille.

## Comment un objet arrive à l'écran (le pipeline WebGL)

1. **Shaders.** Deux petits programmes écrits en GLSL tournent sur le GPU : le *vertex shader* (`mesh.vert`) place chaque sommet à l'écran, le *fragment shader* (`mesh.frag`) choisit la couleur de chaque pixel (éclairage : Lambert, Blinn-Phong ou gaussien, voir plus bas). `gl/shader.ts` les compile et les lie en un *programme*, et lit le journal du compilateur si cela échoue.
2. **Buffers et VAO.** Les sommets du maillage (positions, normales) et ses indices (3 par triangle ; 16 bits, ou 32 bits au-delà de 65 535 sommets) sont copiés dans des *buffers*, des blocs de mémoire du GPU. Un *VAO* retient quel buffer alimente quelle entrée du shader : on le configure une fois, puis un seul appel le rebranche à chaque image.
3. **Matrices.** Trois matrices 4x4 transforment les points : *modèle* (la rotation de l'objet sur lui-même), *vue* (la position de la caméra), *projection* (la perspective, qui rapetisse ce qui est loin). La *matrice normale* (3x3, inverse transposée du modèle) fait tourner les normales sans les fausser, pour que l'éclairage reste juste. Avant l'envoi, le maillage est recentré et mis à l'échelle (cube de côté 2) : la caméra, elle, tourne toujours autour de l'origine, donc autour du centre de l'objet. La matrice de vue est recalculée à chaque image depuis la caméra courante (`lookAt`, avec la même position envoyée au fragment shader pour le reflet). Elles sont calculées en TypeScript (`core/mat4.ts`) puis envoyées au shader sous forme d'*uniforms*, des valeurs communes à tous les sommets d'un même dessin.
4. **Éclairage.** Les réglages de la lumière (modèle, position, couleur, reflet) sont aussi des uniforms, envoyés par `setLighting` seulement quand l'utilisateur les change, pas à chaque image. Voir la section suivante.
5. **Boucle.** À chaque image (`requestAnimationFrame`), on avance l'angle selon le temps écoulé (si la rotation automatique est active), on envoie la caméra courante et les uniforms du modèle, puis `drawElements` lance le dessin. Le GPU applique le vertex shader à chaque sommet, transforme les triangles en pixels, applique le fragment shader à chaque pixel, et le test de profondeur garde le pixel le plus proche.

## Comment un pixel est éclairé (`mesh.frag`)

Pour chaque pixel, le fragment shader connaît sa position dans le monde (`vWorldPosition`, calculée par le vertex shader puis interpolée) et sa normale. Il en déduit trois vecteurs de longueur 1 : **N** la normale, **L** la direction vers la lumière (position de la lumière moins position du pixel, normalisée) et **V** la direction vers l'oeil (la position de la caméra, qui change quand on tourne autour de l'objet, est envoyée avec la matrice de vue).

1. **Diffus (les trois modèles).** `max(N·L, 0)` : le cosinus de l'angle entre la normale et la lumière. Une face de face à la lumière est pleine, une face de côté ou dos à la lumière ne reçoit rien.
2. **Reflet (Blinn-Phong et Gaussien seulement).** On calcule **H**, le vecteur de demi-angle (le milieu entre L et V, normalisé). Quand la normale pointe vers H, la lumière se réfléchit droit vers l'oeil : c'est le point le plus brillant. Le reflet n'existe que si N·L > 0.
   - Blinn-Phong : `max(N·H, 0) ^ brillance`. Une brillance grande donne un petit reflet net.
   - Gaussien : `exp(-(theta - moyenne)^2 / (2 * ecartType^2))` avec `theta = acos(N·H)`. Une courbe en cloche de l'angle.
3. **Composition.** `couleur = objet * ambiant + objet * lumière * (1 - ambiant) * diffus + lumière * intensité * reflet`, bornée à 1. Avec la lumière blanche, le modèle Lambert et l'ambiant par défaut (0,35), on retrouve l'éclairage diffus d'avant.

Les deux formules du reflet sont recopiées en TypeScript dans `core/lighting.ts` (`blinnPhongSpecular`, `gaussianSpecular`) : les tests ne peuvent pas exécuter un shader, ils vérifient donc ces versions-là sur des valeurs connues.

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
