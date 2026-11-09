# Choix techniques et limites

Ce document explique les décisions du démonstrateur 3D. Chaque décision suit le même plan : contexte, décision, pourquoi, compromis. Quand une décision est remplacée, son texte d'origine est gardé tel quel, avec une ligne « Statut » qui renvoie à la décision qui la remplace : on voit ainsi comment le projet a évolué. Pour l'usage du projet (lancement, scripts, structure), voir le [README](../README.md).

## Méthode de travail

Le projet est réalisé étape par étape (un ticket à la fois) avec l'assistance de Claude Code : chaque étape a son commit et ses tests. La section suivante est réservée à Tanguy.

## Ma part et ce que j'en retiens

À compléter par Tanguy.

- Ce que j'ai décidé :
- Ce que j'ai appris :
- Ce que je referais autrement :

## Les décisions

### 1. Three.js plutôt qu'OpenGL brut

**Statut : remplacée le 09/11/2026 par la décision 7 (WebGL2 pur). Texte conservé pour l'historique.**

**Contexte.** Le projet de cours d'origine était écrit en OpenGL, sans moteur : tout était fait à la main (matrices, shaders, boucle de rendu).

**Décision.** Ce démonstrateur utilise Three.js, au-dessus de WebGL.

**Pourquoi.** Refaire le même exercice avec WebGL brut n'apporterait rien de nouveau. Ici le but est de montrer de l'intégration web : un composant React qui gère le cycle de vie d'un renderer, le redimensionnement, l'accessibilité (`prefers-reduced-motion`, message de repli), les tests. Three.js fournit la scène, la caméra, les matériaux et les lumières, et laisse la place d'écrire soi-même les parties intéressantes plus tard (modèles d'éclairage, analyseur OBJ).

**Compromis.** Three.js cache une partie de ce qu'OpenGL oblige à comprendre. Les modèles d'éclairage prévus (Blinn-Phong, gaussien) devront être écrits explicitement (shader personnalisé) pour que le travail reste instructif, plutôt que de se contenter des matériaux fournis.

### 2. Un dossier `core/` sans React

**Contexte.** Le démonstrateur doit pouvoir être réutilisé dans un autre projet, et une bonne partie du futur code est du calcul pur (analyse d'un fichier OBJ, normales, boîte englobante).

**Décision.** Tout ce qui n'a pas besoin de React vit dans `src/core/`, sans import de React. Le composant `src/viewer/Viewer3D.tsx` ne fait que brancher cette logique sur un canvas.

**Pourquoi.** Du code sans React se teste sans interface, vite, avec des entrées et des sorties simples. Il se déplace aussi dans un autre projet sans embarquer d'interface. Exemple actuel : `advanceRotation` (calcul de la rotation selon le temps écoulé) et `isWebGLAvailable` (qui reçoit une fabrique de canvas pour pouvoir être testée avec un faux).

**Compromis.** Pour l'instant `core/` est petit : la séparation est surtout une règle posée tôt, avant que le code grossisse. Si un jour `core/` a besoin de types de Three.js, la règle sera à rediscuter.

**Mise à jour (09/11/2026).** Three.js n'est plus utilisé : `core/` n'importe ni React ni WebGL. Il contient maintenant les maths (`mat4.ts`, `vec3.ts`), la géométrie du cube (`cube.ts`) et la conversion des couleurs, toutes testables avec de simples nombres. Une couche `gl/` s'est ajoutée entre `core/` et `viewer/` (voir la décision 7).

### 3. Un dépôt séparé

**Contexte.** Le démonstrateur sera un jour montré dans l'éditeur de présentations de Tanguy.

**Décision.** Un dépôt autonome, avec ses propres tests et sa propre documentation, plutôt qu'un dossier dans le dépôt de l'éditeur.

**Pourquoi.** Il garde un historique lisible, peut être présenté seul, et son interface avec l'extérieur reste étroite (un composant qui remplit son parent). Cela oblige à garder le composant indépendant de son contexte.

**Compromis.** L'intégration demandera un vrai travail (publier le composant ou le copier, gérer les versions). Ce travail n'est pas fait : il fera l'objet d'un ticket.

### 4. Cycle de vie du renderer et StrictMode

**Statut : le principe est conservé, mais la mise en oeuvre est remplacée par la décision 8 (ressources WebGL, perte de contexte). Texte conservé pour l'historique : il décrit la version Three.js.**

**Contexte.** En développement, StrictMode monte, démonte puis remonte chaque composant. Un renderer WebGL non libéré, ou une boucle d'animation non annulée, s'accumule alors.

**Décision.** Tout ce que l'effet de `Viewer3D` crée est libéré dans sa fonction de nettoyage : annulation de `requestAnimationFrame`, déconnexion du `ResizeObserver`, `dispose` de la géométrie et du matériau, `dispose` du renderer. Le canvas est rendu par React (pas créé à la main), il n'y a donc jamais deux canvas.

**Pourquoi.** Les géométries et matériaux Three.js vivent sur le GPU : le ramasse-miettes de JavaScript ne les libère pas, il faut appeler `dispose`. Les tests vérifient ces appels, y compris le cas StrictMode (deux renderers créés, le premier libéré, une seule boucle vivante).

**Compromis.** On n'appelle volontairement pas `renderer.forceContextLoss()` : le second montage de StrictMode réutilise le même canvas, et un contexte perdu volontairement ne se récupère pas. Conséquence : le contexte WebGL n'est libéré qu'à la disparition du canvas. C'est suffisant pour un composant monté une fois, à surveiller si le composant est monté et démonté très souvent.

### 5. Détection de WebGL avant le renderer

**Décision.** `isWebGLAvailable` crée un canvas jetable, demande un contexte `webgl2`, le libère aussitôt, et renvoie un booléen. Le composant affiche un message en français si c'est faux, ou si la création du renderer échoue quand même.

**Pourquoi.** Sans cela, `new WebGLRenderer()` lève une exception et l'écran reste blanc. Seul WebGL 2 est testé car Three.js ne gère plus WebGL 1 depuis sa version r163.

**Compromis.** Le message est le même pour toutes les causes (navigateur trop ancien, accélération matérielle désactivée, etc.) : on ne sait pas les distinguer de façon fiable.

**Mise à jour (09/11/2026).** La détection est inchangée, mais la raison de ne tester que WebGL 2 n'est plus celle de Three.js : c'est que les shaders sont écrits en GLSL ES 3.00 (`#version 300 es`), qui n'existe qu'en WebGL 2. Le message de repli sert aussi quand le contexte est refusé ou quand les shaders sont rejetés à la compilation.

### 6. Mouvement réduit

**Décision.** Si la requête `prefers-reduced-motion: reduce` est vraie, le cube reste fixe (il est quand même affiché). La requête est lue à chaque image, donc un changement du réglage système en cours d'utilisation est pris en compte sans écouteur supplémentaire.

**Compromis.** La boucle de rendu tourne même quand rien ne bouge. C'est simple et sans conséquence pour un cube ; elle devra de toute façon tourner quand la souris fera pivoter la scène. À revoir si la consommation devient un sujet (rendu à la demande).

**Mise à jour (ticket 4a).** La rotation automatique peut maintenant aussi être coupée par une case du panneau de la vue ; elle s'arrête si la case est décochée OU si `prefers-reduced-motion` est actif. La caméra, elle, obéit toujours à l'utilisateur : le réglage système concerne les mouvements que l'on n'a pas demandés (décision 18).

### 7. WebGL2 pur à la place de Three.js

**Contexte.** La décision 1 avait choisi Three.js pour se concentrer sur l'intégration web. Tanguy a ensuite choisi de faire du « WebGL pur » : le projet de cours d'origine était écrit sans moteur, et le démonstrateur doit rester au même niveau.

**Décision.** Three.js est retiré (`three` et `@types/three` désinstallés). Les matrices sont calculées en TypeScript (`core/mat4.ts`), les shaders sont des fichiers GLSL ES 3.00 (`gl/shaders/cube.vert` et `cube.frag`, importés avec `?raw`), la compilation, les buffers et les VAO sont dans `gl/`. Le cube garde la même taille, la même inclinaison, la même couleur (#2E5D7C) et le même fond (#F7F4EE), mais il est maintenant éclairé par notre propre shader : une lumière directionnelle (modèle de Lambert) plus une part ambiante.

**Pourquoi.**
- Même niveau que le projet de cours d'origine : chaque étape (matrice, shader, buffer) est écrite à la main et donc explicable ligne par ligne, ce qui est le but du projet.
- Rien n'est caché : il n'y a pas de couche intermédiaire dont il faudrait deviner le comportement.
- Aucune dépendance 3D : le bundle de production passe de 752 kB (200 kB compressés) à 232 kB (74 kB compressés). Ce qui reste est presque entièrement React : notre code WebGL et nos shaders pèsent très peu.
- Les parties intéressantes à venir (modèles d'éclairage, normales, boîte englobante) s'écrivent directement dans les shaders, sans contourner un moteur.

**Mise à jour (ticket 2, taille mesurée).** Les chiffres 752 kB et 232 kB ci-dessus datent du ticket 1b. Après le ticket 2 (formes, analyseur OBJ, panneau), `npm run build` affiche 244,12 kB pour le JavaScript (78,15 kB compressés en gzip) et 10,58 kB pour le CSS (2,91 kB compressés).

**Mise à jour (ticket 2).** Les shaders s'appellent maintenant `mesh.vert` et `mesh.frag` (ils ne dessinent plus que des cubes), et `cubeRenderer.ts` est devenu `meshRenderer.ts` (décisions 10 à 14).

**Mise à jour (ticket 3).** La lumière directionnelle fixe décrite ci-dessus est remplacée par une lumière ponctuelle réglable et trois modèles d'éclairage (décisions 16 et 17).

**Compromis (coûts réels).**
- Beaucoup plus de code à écrire, à relire et à tester : maths des matrices, compilation des shaders, gestion des buffers, nettoyage des ressources GPU, perte de contexte. Three.js faisait tout cela.
- Pas de chargeur OBJ ni de contrôles à la souris fournis : il faudra les écrire aussi.
- jsdom n'a pas de WebGL. Les maths, la géométrie et les appels WebGL (avec un faux contexte) sont testés, mais le rendu réel n'est vérifié qu'à la main dans un navigateur. Une faute dans un shader ou un cube mal orienté ne serait pas détecté par les tests automatiques.
- L'éclairage est calculé directement sur les valeurs de couleur sRGB, sans correction gamma. C'est simple à expliquer mais pas physiquement exact : les teintes ne sont donc pas identiques à celles de la version Three.js.

### 8. Cycle de vie des ressources WebGL et perte de contexte

**Contexte.** Contrairement à un moteur, WebGL ne libère rien automatiquement : programme, buffers et VAO vivent sur le GPU, hors de portée du ramasse-miettes de JavaScript. Le navigateur peut aussi reprendre le GPU à tout moment (veille, trop de contextes ouverts, pilote qui plante) : il envoie alors l'événement `webglcontextlost`.

**Décision.** Le nettoyage du `useEffect` de `Viewer3D` annule la boucle, déconnecte le `ResizeObserver`, retire les écouteurs de contexte et supprime le programme (ce qui libère aussi ses shaders), les buffers et le VAO. Les fonctions de création libèrent d'elles-mêmes ce qu'elles ont déjà créé si une étape échoue. Sur `webglcontextlost`, on appelle `preventDefault()` (sans cela le navigateur ne restaure jamais le contexte) et on arrête la boucle. Sur `webglcontextrestored`, on recrée toutes les ressources et on relance la boucle. Les réglages d'état (profondeur, culling, couleur de fond) sont refaits à chaque création, car un contexte restauré repart de zéro.

**Pourquoi.** Sans nettoyage, StrictMode (qui monte, démonte puis remonte le composant) cumulerait des ressources. Sans les deux événements, une mise en veille de l'ordinateur pourrait laisser un canvas figé pour toujours.

**Compromis.** On n'appelle volontairement pas `loseContext()` au démontage : le second montage de StrictMode réutilise le même canvas, et un contexte perdu volontairement ne se récupère pas. Conséquence : le contexte n'est libéré qu'à la disparition du canvas. Si la recréation échoue à la restauration, on bascule sur le message de repli. Tout cela n'est testé qu'avec un faux contexte, jamais avec une vraie perte de contexte.

### 9. Tester du WebGL sans GPU

**Contexte.** jsdom n'implémente pas WebGL : aucun test ne peut compiler un shader ni dessiner.

**Décision.** Trois niveaux. (a) Tout ce qui est calcul (matrices, vecteurs, géométrie, couleurs) est du code pur, testé avec des valeurs connues. (b) Les fonctions de `gl/` sont testées avec un faux contexte (`src/test/fakeGl.ts`) qui enregistre les appels et compte les ressources encore vivantes. (c) Le composant est testé avec ce même faux contexte : démontage, StrictMode, échec de shader, perte et restauration, redimensionnement. Les shaders eux-mêmes ne sont vérifiés que par leur texte (première ligne `#version 300 es`, noms des entrées et des uniforms attendus par le code). Un `.gitattributes` force les fins de ligne LF sur les `.vert` et `.frag` : `#version` doit rester le tout premier octet du source et les fins de ligne ne doivent pas dépendre de la machine (avec `core.autocrlf` sous Windows, un clone neuf les passerait en CRLF). Le test accepte malgré tout `\r?\n` après `#version`, car le GLSL reste valide en CRLF ; il refuse tout caractère avant (BOM, ligne vide).

**Pourquoi.** Le faux contexte permet de vérifier la logique qui est de notre responsabilité (ordre des appels, libération, cycle de vie) sans navigateur. Compter les ressources vivantes est plus fiable que vérifier chaque `delete*` : un oubli se voit immédiatement.

**Compromis.** Un faux contexte ne prouve pas que le GPU dessine quelque chose de juste, et il peut s'écarter du comportement réel de WebGL (par exemple l'effet de `deleteShader` sur un shader encore attaché à un programme). Le rendu réel reste à contrôler à la main. Un test de bout en bout dans un vrai navigateur serait la suite logique, mais il n'est pas fait.

### 10. Un type `Mesh` commun, et la normalisation dans la boîte unité

**Contexte.** Le démonstrateur doit afficher des formes générées par le code et des fichiers OBJ de n'importe quelle origine, avec le même éclairage et la même caméra (fixe à l'époque ; depuis le ticket 4a elle tourne autour de l'origine, voir la décision 18).

**Décision.** Tout ce qui s'affiche est un `Mesh` (`core/mesh.ts`) : `positions` et `normals` (3 flottants par sommet) et `indices` (3 par triangle, `Uint16Array` ou `Uint32Array`). Le cube, le plan, la sphère, le cône et l'analyseur OBJ produisent tous ce type. Au moment de l'envoi au GPU, le renderer appelle `normalizeToUnitBox` : le maillage est recentré sur l'origine et mis à l'échelle (UNE échelle pour les trois axes) pour que son plus grand côté mesure 2. Le maillage d'origine n'est pas modifié (les statistiques affichées restent celles du fichier).

**Pourquoi.** Un OBJ n'a pas d'unité : un modèle exporté en centimètres mesure cent fois plus qu'en mètres, et peut être loin de l'origine. Sans normalisation, il sortirait de la vue ou resterait minuscule. Une échelle unique garde les proportions. Faire la normalisation à l'envoi (et non dans l'analyseur) garde l'analyseur fidèle au fichier et permet de réutiliser la boîte englobante plus tard (affichage de la boîte englobante, à venir).

**Cas dégénérés.** Maillage sans sommet : `boundingBox` renvoie `null` et la normalisation renvoie un maillage vide (l'envoi au GPU le refuse alors avec une erreur claire). Boîte de taille nulle (tous les sommets au même point) : le point est centré sur l'origine sans mise à l'échelle, car diviser par 0 produirait des NaN.

**Compromis.** Le cube est maintenant affiché avec un côté de 2 au lieu de 1,5 : tout est ramené à la même taille, y compris le cube. Un objet très allongé, en tournant, peut sortir légèrement du cadre sur un écran très étroit (la caméra ne s'adapte pas encore).

### 11. Un analyseur OBJ écrit à la main, et ses hypothèses

**Contexte.** Dans l'esprit du projet (rien de caché derrière une bibliothèque), le chargement des fichiers OBJ est écrit à la main dans `core/obj.ts`, sans React ni WebGL.

**Décision et hypothèses.**
- Un sommet GPU est une paire (indice de position, indice de normale). Une `Map` retrouve les paires déjà créées : un point partagé par plusieurs faces avec la même normale n'est créé qu'une fois. Un point qui change de normale d'une face à l'autre (arête vive) donne volontairement plusieurs sommets.
- Les faces à plus de 3 sommets sont triangulées **en éventail** autour du premier sommet. **Hypothèse : les polygones sont convexes** (et plans). Sur un polygone concave, des triangles peuvent déborder de la forme. Aucune vraie triangulation (oreilles) n'est faite.
- Les indices commencent à 1, un indice négatif compte depuis le dernier élément **déjà lu** (la règle du format OBJ). Les coordonnées `vt` sont lues, vérifiées, puis jetées (pas de textures pour le moment) ; les indices de texture hors bornes sont une erreur.
- **Normales calculées** quand le fichier n'en donne pas : moyenne des normales des triangles voisins, pondérée par l'aire, par position. Pourquoi lisses : un fichier sans normales ne dit pas où sont les arêtes vives, et des normales par face donneraient un aspect facetté sur les surfaces courbes (le cas le plus fréquent). Le prix : un cube sans normales a ses arêtes adoucies.
- Si **une seule** face n'a pas de normale, toutes les normales du fichier sont ignorées et recalculées : mélanger deux sources donnerait un éclairage incohérent d'une face à l'autre.
- Une normale du fichier de longueur nulle est refusée (sa direction n'existe pas). Une normale de longueur différente de 1 est normalisée.
- Les points qu'aucune face n'utilise sont écartés du maillage. Les sommets sont rangés dans l'ordre où les faces les citent.
- Nombres : lus strictement (chiffres, signes, point, exposant ; ni `NaN`, ni `Infinity`, ni hexadécimal) puis arrondis à la précision 32 bits ; un nombre trop grand pour un flottant 32 bits est refusé plutôt que transformé en infini.
- Directives ignorées sans erreur : `o`, `g`, `s`, `usemtl`, `mtllib`, `l` et toute directive inconnue. Un `#` commence un commentaire jusqu'à la fin de la ligne.
- Sommet de face : `v`, `v/vt`, `v/vt/vn` ou `v//vn`. Un `/` doit être suivi d'un indice : `1/`, `1/2/` et `1//` sont refusés (« Sommet de face mal formé »), de même que `//1` (position absente).
- La clé de déduplication `position × nbNormales + normale` est un entier exact tant que `maxVertices × nbNormales` reste sous 2^53 : c'est vrai avec les limites par défaut, mais pas garanti si on les relève via `overrides`.
- Chaque erreur est une `ObjParseError` en français avec le numéro de ligne (`Ligne 12 : ...`), sauf « aucune face » qui concerne tout le fichier.

**Pourquoi découper avec `split` et non des expressions régulières.** Le fichier est une entrée non fiable. Les seules expressions régulières utilisées testent un caractère répété une fois (`[0-9eE+-.]+`, `[+-]?[0-9]+`), sans répétition imbriquée : leur temps reste proportionnel à la longueur du texte. Il n'y a ni récursion ni `eval`.

**Compromis (non gérés).** Textures et matériaux (`.mtl`) ; les lignes continuées par une barre oblique inverse (`\`) ne sont pas recollées ; les fins de ligne « Mac classique » (CR seul) ne sont pas lues : un fichier sans aucun `\n` mais avec au moins un `\r` est refusé avec un message qui dit quoi faire (sans cela, tout le fichier serait lu comme une seule ligne et l'erreur serait incompréhensible) ; les surfaces courbes et les lignes (`l`, `curv`...) sont ignorées. Un OBJ dont les faces sont en sens horaire (non conforme à l'usage) sera éclairé à l'envers (voir la décision 13).

### 12. Limites de sécurité sur le fichier

**Contexte.** Le fichier est choisi par l'utilisateur. Un fichier géant ou piégé ne doit pas figer l'onglet ni épuiser la mémoire.

**Décision.** Des limites nommées en tête de `core/obj.ts`, toutes dépassables en pratique seulement par un fichier hors du commun, avec une erreur claire (et le numéro de ligne quand il existe) :

| Limite | Valeur | Rôle |
| --- | --- | --- |
| `MAX_OBJ_TEXT_LENGTH` | 50 Mo (52 428 800 caractères) | Taille du texte. L'interface contrôle aussi `file.size` AVANT de lire le fichier (`File.text()` charge tout en mémoire). |
| `MAX_OBJ_LINE_LENGTH` | 100 000 caractères | Une ligne démesurée est refusée avant d'être découpée. Une face à 1 000 sommets en fait moins de 20 000. |
| `MAX_OBJ_VERTICES` | 1 000 000 | Lignes `v`, `vn` et `vt` (un plafond pour chacune). |
| `MAX_OBJ_FACES` | 500 000 | Lignes `f`. |
| `MAX_OBJ_TRIANGLES` | 1 000 000 | Triangles après découpage (un polygone à n sommets en donne n - 2). |
| `MAX_OBJ_FACE_VERTICES` | 1 000 | Sommets d'une seule face. |

**Pourquoi ces valeurs.** Ce sont des choix de prudence faits pour ce projet, pas des chiffres imposés : à 1 000 000 de triangles, les tableaux restent de l'ordre de quelques dizaines de Mo, et un fichier de cette taille fait déjà plusieurs dizaines de Mo de texte. Les limites sont des paramètres de `parseObj` (les tests les abaissent au lieu de fabriquer des fichiers énormes).

**Compromis.** L'analyse tourne sur le fil principal de la page : un fichier proche des limites peut figer l'onglet quelques secondes. Un Web Worker réglerait cela ; ce n'est pas fait. Le contrôle `file.size` est en octets et la limite du texte en caractères : un caractère prend au moins un octet, donc le contrôle d'octets est le plus strict.

### 13. Face culling désactivé, normale retournée pour les faces arrière

**Contexte.** Jusqu'ici le face culling (ne pas dessiner les triangles vus par l'arrière) était actif : sur un cube plein, ces triangles sont cachés de toute façon. Mais un plan est mince et doit se voir des deux côtés, et beaucoup de fichiers OBJ sont des surfaces ouvertes ou ont des faces mal orientées.

**Décision.** `gl.disable(gl.CULL_FACE)`. Pour que l'envers d'un triangle soit éclairé correctement, le fragment shader retourne la normale quand `gl_FrontFacing` vaut faux (triangle vu par l'arrière).

**Pourquoi.** Sans le retournement, l'envers d'un plan dont la normale est +Y garderait cette normale : vu d'en dessous, il serait éclairé comme s'il regardait vers le haut (clair alors que la lumière vient du dessus et ne le touche pas). `gl_FrontFacing` est déterminé par le sens des sommets à l'écran (anti-horaire = avant), c'est donc le même critère que le culling.

**Compromis.** Le retournement suppose que le fichier suit la convention : sommets anti-horaires vu de l'extérieur, normales vers l'extérieur. Un OBJ dont les triangles sont en sens horaire verra tout son extérieur considéré comme un « envers » : normales retournées, éclairage inversé. Le culling pourra redevenir une option dans un ticket suivant.

**Mise à jour (ticket 4a).** Le culling est maintenant une option de la vue, désactivée par défaut : la décision ci-dessus reste le comportement de départ, et le retournement de la normale ne sert plus qu'avec le culling désactivé (décision 18).

### 14. Indices 32 bits au-delà de 65 535 sommets

**Décision.** Un maillage a des indices `Uint16Array` tant qu'il compte au plus 65 535 sommets, `Uint32Array` au-delà (`createIndexArray` dans `core/mesh.ts`). `createIndexedMesh` choisit `gl.UNSIGNED_INT` ou `gl.UNSIGNED_SHORT` pour `drawElements` selon le type du tableau. WebGL2 accepte les indices 32 bits sans extension (WebGL1 en demandait une).

**Pourquoi.** Un `Uint16Array` tronque sans erreur ni avertissement les valeurs supérieures à 65 535 : le dessin serait faux sans qu'on sache pourquoi. Le seuil est 65 535 et pas 65 536 parce que l'indice 65 535 vaut aussi « redémarrage de primitive » en 16 bits ; par prudence on évite qu'un sommet réel porte cet indice.

**Compromis.** Les indices 32 bits prennent deux fois plus de mémoire GPU : on ne les utilise que quand c'est nécessaire.

### 15. Remplacer le maillage affiché sans recréer le contexte

**Décision.** `Viewer3D` reçoit le maillage en prop. Un second `useEffect` appelle `renderer.setMesh` quand la prop change : le canvas, le contexte WebGL, le programme et la boucle d'animation restent les mêmes. `setMesh` crée le nouveau VAO et ses buffers AVANT de supprimer les anciens : si la création échoue, l'erreur remonte et l'ancien maillage reste affiché et intact. Deux façons d'échouer sont détectées dans `createIndexedMesh` (`gl/buffers.ts`) : (1) `createBuffer` ou `createVertexArray` renvoie `null` (contexte perdu) ; (2) un manque de mémoire GPU. Ce second cas est piégeux : en WebGL, `gl.bufferData` qui échoue ne lève AUCUNE exception, il pose seulement un drapeau d'erreur que seul `gl.getError()` révèle (code `OUT_OF_MEMORY`). Le mécanisme : avant de créer quoi que ce soit, on vide les erreurs en attente en lisant `getError` jusqu'à `NO_ERROR` (avec une borne de 32 lectures, pour ne pas boucler sans fin sur un contexte défaillant), afin de ne pas reprocher à ce maillage une erreur plus ancienne ; puis, après les trois `bufferData` (positions, normales, indices) et AVANT de débrancher le VAO, on lit `getError` une fois. Si le code n'est pas `NO_ERROR`, on lève une erreur en français (« Mémoire graphique insuffisante pour ce modèle » pour `OUT_OF_MEMORY`, sinon « Erreur WebGL ... (code N) »). Le `catch` existant supprime alors le VAO et les buffers déjà créés, et l'erreur remonte par `setMesh` jusqu'à `onMeshError`. Le composant retient le maillage affiché dans une référence, pour que le renderer recréé après une perte de contexte redessine le DERNIER maillage choisi (y compris un maillage choisi pendant la perte). L'état « quelle forme ou quel fichier » vit dans un hook (`ui/useMeshSelection.ts`) : un fichier refusé laisse la sélection précédente en place, et si le GPU refuse un maillage, la sélection revient à la précédente pour que le panneau reste cohérent avec l'écran.

**Pourquoi.** Recréer le contexte à chaque changement de forme gaspillerait l'un des contextes WebGL limités par navigateur et ferait clignoter l'écran. Le chargement d'un fichier est asynchrone : un numéro de requête ignore le résultat d'une lecture devenue périmée (l'utilisateur a changé d'avis entre-temps).

**Compromis.** Pendant un court instant, ancien et nouveau maillage existent ensemble sur le GPU (le temps de la création). C'est le prix de la garantie « l'ancien reste si le nouveau échoue ». Le contrôle par `getError` n'est vérifié qu'avec un faux contexte qui simule `OUT_OF_MEMORY` : un vrai manque de mémoire GPU n'a pas été provoqué. Certains pilotes peuvent aussi différer l'allocation et ne signaler l'échec qu'au dessin ; ce cas n'est pas couvert.

### 16. Lumière ponctuelle et trois modèles d'éclairage dans un seul shader

**Contexte.** L'éclairage du ticket 1b était une lumière directionnelle fixe (Lambert + ambiant 0,35). Le projet de cours d'origine comparait plusieurs modèles d'éclairage, et le démonstrateur doit permettre de les comparer en direct sur la même forme.

**Décision.**
- La lumière devient **ponctuelle** : elle a une position réglable dans le monde (x, y, z, chacune de -10 à 10) et, pour chaque pixel, la direction vers elle est `L = normalize(positionLumière - positionPixel)`. Le vertex shader transmet donc la position du pixel dans le monde (`vWorldPosition = (uModel * vec4(aPosition, 1)).xyz`, interpolée entre les sommets). La position de la caméra (fixe en (0, 0, 5) à l'époque ; depuis le ticket 4a, la caméra orbitale de la décision 18, dont la position est renvoyée à chaque changement) est envoyée en uniform (`uCameraPosition`) pour calculer la direction vers l'oeil `V` pour chaque pixel.
- Trois modèles, choisis par un **uniform entier** (`uLightingModel` : 0 Lambert, 1 Blinn-Phong, 2 Gaussien) et un `if` dans le fragment shader. Un seul programme, aucune recompilation quand on change de modèle. Côté TypeScript, `MODEL_NUMBER` (un `Record` complet, donc TypeScript refuse un modèle sans numéro) donne le numéro ; côté shader, des constantes `MODEL_*`. Un test vérifie que les deux côtés sont d'accord.
- **Lambert** : diffus seul, `max(N·L, 0)`. **Blinn-Phong** et **Gaussien** ajoutent un reflet. Avec `H = normalize(L + V)` (le vecteur de demi-angle), Blinn-Phong vaut `max(N·H, 0) ^ brillance` et le gaussien `exp(-(theta - moyenne)^2 / (2 * ecartType^2))` avec `theta = acos(clamp(N·H, -1, 1))` en radians. Le reflet n'existe que si `N·L > 0` (une face qui ne reçoit pas la lumière ne brille pas).
- Composition : `ambiant = couleurObjet * ambiant` (ambiant blanc), `diffus = couleurObjet * couleurLumière * (1 - ambiant) * max(N·L, 0)`, `reflet = couleurLumière * intensité * formule`. Somme bornée à 1 par un `min` explicite. Avec la lumière blanche et le modèle Lambert, on retrouve exactement l'éclairage diffus d'avant ; seule la direction de la lumière dépend maintenant du pixel. Position de départ (3, 4, 5), comme avant.
- Le fragment shader passe en **`precision highp float`** (il était en `mediump`). `acos` près de 1 est très imprécis en 16 bits : la courbe gaussienne en dépend, et on verrait un reflet qui se découpe en paliers. `highp` est aussi plus sûr pour la position du pixel dans le monde.
- Le renderer envoie les réglages par `setLighting`, appelée aussi à la création. `Viewer3D` reçoit les réglages en prop, comme le maillage (décision 15) : une référence retient les derniers pour la restauration après une perte de contexte, un effet appelle `setLighting` quand la prop change, sans recréer le contexte, et les réglages choisis pendant une perte de contexte sont retenus quand même.
- Dans l'interface, les contrôles inutiles pour le modèle choisi sont **retirés de la page** (pas seulement grisés) : brillance pour Blinn-Phong seulement, moyenne et écart type pour le gaussien seulement, intensité du reflet pour les deux modèles à reflet.

**Pourquoi.** Une lumière ponctuelle donne un reflet qui dépend de la position (un reflet sur une sphère bouge quand on déplace la lumière), ce qui rend la différence entre les modèles visible. Un `if` sur un uniform entier est simple à expliquer et peu coûteux pour un petit programme, alors que trois programmes demanderaient trois compilations, trois jeux d'uniforms et de la gestion de cycle de vie en plus.

**Compromis.**
- Le `if` est évalué pour chaque pixel. Sur un GPU, les pixels voisins prennent la même branche (l'uniform est le même pour tous), le coût est négligeable ici ; ce serait à mesurer sur un très gros écran ou un maillage lourd.
- L'éclairage est calculé par pixel, mais un cube à faces planes a des normales constantes par face : seules les directions L et V varient d'un pixel à l'autre, donc le reflet de Blinn-Phong y est large, faible ou absent (voir « Limites connues »).
- Un vecteur nul (lumière exactement au point du pixel, ou L et V opposés) donnerait NaN en le normalisant. Le cas L + V nul est protégé dans le shader ; la lumière posée exactement sur la surface d'un pixel ne l'est pas (cas d'un seul point, sans conséquence visible).
- Le rendu réel n'a pas pu être vérifié par les tests : les shaders ne sont jamais compilés ni exécutés dans jsdom.

### 17. `core/lighting.ts` : réglages assainis et formules de référence testables

**Contexte.** Les shaders ne sont pas exécutés par les tests, et un nombre invalide envoyé à un uniform ne produit aucune erreur : seulement des pixels faux sur tout l'objet.

**Décision.** Un fichier `core/lighting.ts`, sans React ni WebGL, contient :
- Le type `LightingSettings`, les réglages par défaut (`DEFAULT_LIGHTING`) et les plages (`POSITION_RANGE`, `AMBIENT_RANGE`...), partagés entre le panneau (bornes des curseurs) et le renderer.
- `sanitizeLighting(settings)` : borne chaque nombre à sa plage, remplace NaN et Infinity par la valeur par défaut, et retombe sur la valeur par défaut pour un modèle ou une couleur invalide. Le renderer l'appelle avant tout envoi au GPU.
- `blinnPhongSpecular(nDotH, brillance)` et `gaussianSpecular(nDotH, moyenne, écartType)` : les deux formules du reflet en TypeScript, identiques à celles du shader. Elles servent de **référence testable** : les tests vérifient des valeurs connues (Blinn-Phong vaut 1 pour `N·H = 1` et 0 pour `N·H = 0`, il augmente avec `N·H` ; le gaussien est maximal à `theta = moyenne`, vaut `exp(-0,5)` à un écart type, est symétrique). Le shader renvoie vers ces fonctions dans un commentaire, et l'inverse aussi.

**Pourquoi.**
- Les plages choisies sont des choix d'interface, pas des valeurs imposées par la théorie : l'écart type minimal (0,02 rad) existe uniquement pour éviter une division par zéro dans la formule gaussienne ; la moyenne est limitée à 0,5 rad (environ 29 degrés) pour que le reflet reste près du point brillant.
- Remplacer une valeur folle par la valeur par défaut (plutôt que la borner) évite qu'un Infinity devienne un réglage extrême sans que personne ne le sache.
- Le test « les formules du shader sont les bonnes » ne peut pas être fait pour de vrai ; la référence TypeScript garantit au moins que les formules sont justes sur le papier, et un test lit le texte du shader pour vérifier que les expressions attendues y figurent (une simple recherche de texte, il ne compare rien à la référence TypeScript).

**Compromis.**
- Rien ne garantit mécaniquement que le shader et la référence restent identiques : si on modifie l'un sans l'autre, seul le test du texte du shader (qui cherche des expressions précises, sans les comparer à la référence) peut le signaler, et seulement si l'expression cherchée a changé. C'est une garantie plus faible qu'un vrai test d'exécution sur GPU.
- Les pas des curseurs sont des choix d'ergonomie (0,01 pour les valeurs entre 0 et 1, 0,5 pour la position, 1 pour la brillance), pas des mesures.

### 18. Caméra orbitale, options de vue et commandes (souris, doigt, clavier)

**Contexte.** Jusqu'au ticket 3, la caméra était fixe en (0, 0, 5) et l'objet tournait seul autour de Y avec une inclinaison fixe de 0,4 rad autour de X (`TILT`). Le ticket 4a demande de tourner autour de l'objet et de zoomer, et de pouvoir couper la rotation automatique et activer le face culling (décision 13).

**Décision.**
- **Coordonnées sphériques.** `core/camera.ts` décrit la caméra par `{ azimuth, elevation, distance }` (radians, radians, unités du monde) et la convertit en position cartésienne avec `cameraPosition` : `x = d cos(e) sin(a)`, `y = d sin(e)`, `z = d cos(e) cos(a)`. La cible est toujours l'origine et « haut » est (0, 1, 0). Trois nombres se modifient bien plus facilement à la souris que trois coordonnées cartésiennes : glisser en horizontal change l'azimut, en vertical l'élévation, la molette la distance. Au départ : azimut 0, élévation 0,4 rad (l'ancienne inclinaison), distance 5.
- **Bornes.** L'élévation va de -1,5 à 1,5 rad (environ 86 degrés), pas jusqu'à PI/2 : aux pôles la direction du regard est parallèle à « haut » et `lookAt` lève une erreur (un test vérifie que le pôle exact fait bien échouer `lookAt`, c'est donc la borne qui nous protège). La distance va de 2,5 à 12 : l'objet normalisé tient dans une sphère de rayon racine de 3 (environ 1,73), donc à 2,5 la caméra reste à l'extérieur ; à 12 l'objet occupe encore environ 20 % de la hauteur de l'image. Ces valeurs sont des choix d'ergonomie. L'azimut est ramené dans [-PI, PI] pour ne pas grandir sans fin.
- **Assainissement.** `sanitizeCamera` borne, ramène l'azimut dans l'intervalle et remplace NaN et Infinity par les valeurs par défaut (même choix que `sanitizeLighting`, décision 17). Le renderer l'appelle avant tout envoi au GPU. `orbitCamera` et `zoomCamera` renvoient de nouvelles caméras ; un écart ou un facteur invalide est ignoré. Le zoom MULTIPLIE la distance : chaque cran change la taille apparente de l'objet de la même proportion, près ou loin.
- **L'objet ne penche plus.** Son modèle est `rotationY(angle)` seulement, l'inclinaison vient de la caméra. Le point de vue de départ est donc le même qu'avant ; ce qui change, c'est que la lumière (fixe dans le monde) n'est plus inclinée avec l'objet, et qu'en tournant la caméra on voit l'objet sous une lumière qui, elle, ne bouge pas.
- **Le renderer reçoit la caméra.** `setCamera(camera)` assainit, calcule la position, puis envoie la matrice de vue (`lookAt(position, origine, haut)`) ET `uCameraPosition` à partir de la MÊME position : le fragment shader s'en sert pour la direction vers l'oeil (le reflet), qui serait faux si elle gardait la valeur de la création. `Viewer3D` l'appelle à chaque image. Le renderer, recréé après une perte de contexte, reçoit la caméra et les options courantes en paramètres (valeurs par défaut sinon), comme pour l'éclairage.
- **Une référence et pas un état React.** La caméra vit dans un `useRef` de `Viewer3D`, modifiée directement par les gestionnaires d'événements et relue par la boucle de dessin. Un état React changerait à chaque `pointermove` (des dizaines de fois par seconde) et ferait refaire le rendu du composant et de ses parents pour rien : la boucle de dessin tourne de toute façon à chaque image et lit la référence sans aide de React. Seule la réinitialisation passe par une prop : `resetViewKey`, un compteur qu'`App` incrémente ; quand sa valeur change, la caméra revient à `DEFAULT_CAMERA` (la valeur initiale ne change rien).
- **Pointer Events.** Un seul jeu d'événements (`pointerdown`, `pointermove`, `pointerup`, `pointercancel`) couvre la souris, le doigt et le stylet. `setPointerCapture` envoie tous les événements du pointeur au canvas tant qu'il est appuyé, même s'il sort du canvas : sans lui, relâcher hors du canvas laisserait le glisser « collé ». `pointercancel` (geste interrompu par le système) et `lostpointercapture` (capture reprise) terminent le glisser comme `pointerup`. Si un `pointermove` arrive avec `buttons === 0` pendant un glisser (le bouton a été lâché hors de la fenêtre et le relâchement manqué), le glisser est abandonné sans tourner : sans cela la caméra continuerait de suivre la souris sans rien tenir. Un seul pointeur est suivi : un deuxième doigt est ignoré, et seul le bouton principal compte. Un glisser de la largeur du canvas fait un tour complet (2 PI radians), avec le même nombre de radians par pixel à la verticale. Sens : glisser vers la droite fait tourner l'objet vers la droite (la caméra va vers la gauche), glisser vers le bas fait voir davantage le dessus.
- **Molette non passive.** L'écouteur `wheel` est ajouté avec `addEventListener(..., { passive: false })` dans l'effet : React rend ses `onWheel` passifs, et `preventDefault` y serait ignoré, la page défilerait pendant le zoom. Le facteur est `exp(deltaY * 0,001)` (un cran de 100 donne environ 10 %, et un cran annule exactement le cran inverse) ; une molette comptée en lignes (Firefox) vaut 16 pixels par ligne, et comptée en pages (rare) 100 pixels par page. Le canvas a aussi `select-none` : un glisser ou un double-clic ne doit pas surligner le canvas ni le texte voisin.
- **`touch-action: none`** (classe `touch-none`) sur le canvas : sans lui, glisser un doigt ferait défiler la page au lieu de tourner la caméra.
- **Clavier et accessibilité.** Le canvas a `tabIndex={0}` et un contour de focus visible (`focus-visible`). Flèches : même effet qu'un glisser dans leur direction (pas de 0,1 rad). `+` (ou `=`, le `+` des claviers QWERTY demandant Maj) rapproche de 10 %, `-` éloigne de 10 %. Ctrl, Cmd et Alt ne sont pas volés (Ctrl et `+` est le zoom du navigateur). Les touches utilisées sont annulées par `preventDefault` (les flèches feraient défiler la page), les autres (Tab) gardent leur rôle. Le rôle ARIA est `application` et non `img` : une image n'est pas interactive, et surtout ce rôle dit aux lecteurs d'écran de laisser passer les flèches, `+` et `-` au composant au lieu de les garder pour leur navigation (sinon le canvas ne les recevrait jamais). Il est à réserver à ce genre de composant à clavier propre, d'où un texte d'aide relié par `aria-describedby` (masqué visuellement mais lu par les lecteurs d'écran) ; le panneau de la vue rappelle aussi les commandes en clair. Tout ce qui est ajouté est retiré dans le nettoyage de l'effet.
- **Options de vue.** `core/viewOptions.ts` : `ViewOptions { autoRotate, backfaceCulling }`, défauts `true` et `false` (le comportement d'avant). Un champ de plus se rajoute à cet objet (ticket 4b) sans changer les signatures. `Viewer3D` les reçoit en prop (même schéma que l'éclairage : une référence pour la restauration, un effet qui appelle `setViewOptions`). La rotation automatique reste coupée si `prefers-reduced-motion` est actif, quelle que soit la case ; l'objet continue de tourner pendant que l'utilisateur oriente la caméra.
- **Culling et `gl_FrontFacing`.** `setViewOptions` active `gl.CULL_FACE` avec `gl.BACK` quand `backfaceCulling` est vrai, et le désactive sinon. Le retournement de la normale dans le fragment shader (`if (!gl_FrontFacing) normal = -normal`, décision 13) reste en place, mais il ne sert plus qu'AVEC le culling désactivé : avec le culling, les triangles vus par l'arrière ne sont pas dessinés, donc `gl_FrontFacing` vaut toujours vrai. Le culling reste désactivé par défaut. Un fichier OBJ dont les triangles sont dans le mauvais sens (sens horaire vu de l'extérieur) devient entièrement invisible quand on l'active : le panneau l'écrit sous la case.
- **Mise en page.** Le `Viewer3D` est placé avant les panneaux et collé en haut sur petit écran (`sticky top-0 z-10`, retiré à partir de `md`), pour voir l'effet d'un réglage sans remonter la page. Sous `md`, sa hauteur est plafonnée à 45 % de l'écran (`max-h-[45vh]`, retiré à partir de `md`) : en 16/9 sur toute la largeur, un téléphone en paysage (667 x 375) aurait une 3D collée de 364 px qui recouvrirait tout l'écran. La largeur reste celle de l'écran, donc le canvas devient plus large que 16/9 ; il n'est pas déformé, car le composant lit sa taille réelle (`clientWidth`, `clientHeight`) pour la résolution du tampon, le viewport et l'aspect de la projection. Un `scroll-padding-top` sur `html` (`index.css`, annulé à partir de `md`) reprend la même hauteur (largeur de page moins les marges, en 16/9, plafonnée à 45vh, plus le `py-2` du bloc collant et un peu d'air) : sans lui, un élément focalisé au clavier plus bas dans la page serait amené sous le bord de l'écran, donc caché derrière la 3D collée. Les deux valeurs doivent évoluer ensemble. À partir de `md`, deux colonnes : maillage et vue à gauche, éclairage (le plus haut) à droite.

**Pourquoi.** Les coordonnées sphériques gardent la caméra toujours tournée vers l'objet et à bonne distance, ce qu'un déplacement libre ne garantit pas. Les Pointer Events évitent d'écrire trois chemins (souris, toucher, stylet). Les gardes (bornes, assainissement, facteurs ignorés) évitent qu'un geste inattendu produise un NaN dans la matrice de vue : l'objet disparaîtrait sans aucune erreur.

**Compromis.**
- La case « Rotation automatique de l'objet » reste cochée quand le système demande moins de mouvement (`prefers-reduced-motion`), alors que rien ne tourne : le panneau de la vue affiche alors une phrase d'explication, lue côté `ui` (le panneau n'importe rien de `viewer`) et mise à jour si le réglage change.
- Sur mobile, `touch-action: none` empêche de faire défiler la page en touchant le canvas : il faut toucher en dehors de l'image pour défiler. C'est le prix d'un glisser qui tourne la caméra sans pincement de la page.
- Pas de pincement (pinch) pour zoomer en v1 : au doigt, on ne peut pas zoomer. Un pincement sur le pavé tactile d'un ordinateur arrive comme une molette (avec Ctrl) et zoome, lui.
- Un `preventDefault` sur la molette empêche aussi de défiler la page quand le pointeur est sur le canvas.
- Le canvas capture le focus et le rôle `application` change la façon dont les lecteurs d'écran le traitent : le comportement a été raisonné, pas essayé avec un vrai lecteur d'écran.
- La caméra est relue et renvoyée au GPU à chaque image, même immobile (deux uniforms et un `lookAt`) : négligeable ici, et la boucle tourne de toute façon (décision 6).
- Vitesse de rotation, pas des flèches, pas de zoom et sens des gestes sont des choix d'ergonomie, à valider à la main dans un vrai navigateur.

## Limites connues

- Les modèles d'éclairage n'ont pas été vus à l'écran par les tests : les shaders ne sont jamais compilés ni exécutés dans jsdom, le résultat visible (reflet, anneau gaussien, lumière colorée) reste à contrôler à la main dans un navigateur.
- L'éclairage n'a pas de correction gamma : les calculs se font directement sur les valeurs sRGB (voir aussi la décision 7), donc les dégradés ne sont pas physiquement exacts.
- Pas d'ombres : une partie de l'objet ne cache pas la lumière à une autre partie, et un objet ne projette aucune ombre. Une seule lumière (ponctuelle), pas de plusieurs sources.
- Le reflet gaussien avec une moyenne non nulle donne un **anneau** brillant (le reflet est maximal quand `theta` vaut la moyenne, pas au centre) : ce n'est pas un modèle physique de matériau, seulement la courbe en cloche demandée.
- Un cube à faces planes a un reflet faible avec Blinn-Phong, voire invisible : ses normales sont constantes sur chaque face, donc `N·H` ne varie que très lentement sur une face (seules les directions vers la lumière et vers l'oeil changent d'un pixel à l'autre) : le reflet est large et faible, ou absent, au lieu d'être une tache nette. Une sphère ou un cône (normales qui varient) montrent bien mieux le reflet.
- Les formules de reflet existent en double (GLSL dans le shader, TypeScript dans `core/lighting.ts`) : il faut les modifier ensemble (décision 17).
- Rien de ce qui est listé dans « Pas encore fait » du README n'existe encore (fil de fer, affichage des normales, de la boîte englobante, de la grille et des axes : ticket 4b).
- L'analyseur OBJ suppose des polygones convexes (triangulation en éventail), ignore textures et matériaux, ne recolle pas les lignes terminées par `\`, et suppose des triangles anti-horaires vus de l'extérieur (voir les décisions 11 et 13).
- L'analyse du fichier tourne sur le fil principal : un fichier proche des limites (décision 12) peut figer l'onglet quelques secondes.
- Les limites de taille (50 Mo, 1 million de triangles...) sont des choix de prudence, pas des mesures de performance : aucun test n'a été fait avec de gros fichiers dans un vrai navigateur.
- Les normales calculées sont lisses : un fichier sans normales a ses arêtes vives adoucies.
- Pas de pincement à deux doigts pour zoomer : sur écran tactile, on tourne (un doigt) mais on ne peut pas zoomer (décision 18).
- La page ne défile plus quand la molette est sur le canvas (elle zoome), ni quand un doigt est posé dessus (`touch-action: none`) : pour défiler au toucher, il faut toucher hors de l'image 3D.
- La caméra tourne toujours autour de l'ORIGINE, sans déplacement latéral (pan). Cela reste le centre de l'objet, car `normalizeToUnitBox` le recentre à l'envoi (décision 10) : un fichier décentré dans son repère d'origine tourne quand même autour de son centre. Mais on ne peut pas viser un détail hors du centre.
- L'élévation est bornée à environ 86 degrés : on ne peut pas se placer exactement au-dessus ou au-dessous de l'objet (décision 18). La distance est bornée entre 2,5 et 12 ; un objet très allongé peut donc encore sortir un peu du cadre sur un écran très étroit, la caméra ne s'adaptant pas à la forme.
- La lumière est fixe dans le monde, pas attachée à la caméra : en tournant autour de l'objet, on le voit parfois du côté non éclairé.
- Sur petit écran, la 3D collée en haut prend de la hauteur (rapport 16/9 sur toute la largeur, plafonné à 45 % de la hauteur de l'écran : en paysage sur téléphone elle est donc plus large que haute et l'objet y paraît plus petit, avec seulement environ la moitié de l'écran pour les panneaux) ; le `scroll-padding-top` de `index.css` est calculé pour cette hauteur et n'a été vérifié que par lecture du texte du CSS, pas par mesure dans un navigateur ; à partir de `md` elle redevient normale et sort de l'écran quand on descend régler les curseurs du bas.
- Les commandes (glisser, molette, tactile, clavier, lecteur d'écran) sont testées avec jsdom et des événements simulés : le ressenti (vitesse, sens, capture du pointeur, rôle `application` avec un vrai lecteur d'écran) reste à contrôler à la main dans un vrai navigateur, sur ordinateur et sur mobile.
- Les tests tournent dans jsdom, qui n'a pas de WebGL : le contexte y est remplacé par un faux. Le rendu réel (cube visible, couleurs, éclairage, taille du canvas, redimensionnement, vraie perte de contexte) n'est pas testé automatiquement et doit être vérifié à la main dans un navigateur.
- Les shaders ne sont jamais compilés par les tests : une faute de GLSL ne se verrait qu'au lancement dans un navigateur (le message de repli s'affiche alors, et le journal du compilateur est dans la console).
- L'éclairage travaille sur les couleurs sRGB sans correction gamma (voir la décision 7).
- Le message de repli est affiché pour toute cause d'absence de WebGL, sans détail.
- Le contexte WebGL n'est pas libéré explicitement au démontage (voir la décision 8).
- Aucune vérification sur Firefox, Safari ou mobile à ce stade.
