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

**Contexte.** Le démonstrateur doit afficher des formes générées par le code et des fichiers OBJ de n'importe quelle origine, avec le même éclairage et la même caméra fixe.

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

### 14. Indices 32 bits au-delà de 65 535 sommets

**Décision.** Un maillage a des indices `Uint16Array` tant qu'il compte au plus 65 535 sommets, `Uint32Array` au-delà (`createIndexArray` dans `core/mesh.ts`). `createIndexedMesh` choisit `gl.UNSIGNED_INT` ou `gl.UNSIGNED_SHORT` pour `drawElements` selon le type du tableau. WebGL2 accepte les indices 32 bits sans extension (WebGL1 en demandait une).

**Pourquoi.** Un `Uint16Array` tronque sans erreur ni avertissement les valeurs supérieures à 65 535 : le dessin serait faux sans qu'on sache pourquoi. Le seuil est 65 535 et pas 65 536 parce que l'indice 65 535 vaut aussi « redémarrage de primitive » en 16 bits ; par prudence on évite qu'un sommet réel porte cet indice.

**Compromis.** Les indices 32 bits prennent deux fois plus de mémoire GPU : on ne les utilise que quand c'est nécessaire.

### 15. Remplacer le maillage affiché sans recréer le contexte

**Décision.** `Viewer3D` reçoit le maillage en prop. Un second `useEffect` appelle `renderer.setMesh` quand la prop change : le canvas, le contexte WebGL, le programme et la boucle d'animation restent les mêmes. `setMesh` crée le nouveau VAO et ses buffers AVANT de supprimer les anciens : si la création échoue, l'erreur remonte et l'ancien maillage reste affiché et intact. Deux façons d'échouer sont détectées dans `createIndexedMesh` (`gl/buffers.ts`) : (1) `createBuffer` ou `createVertexArray` renvoie `null` (contexte perdu) ; (2) un manque de mémoire GPU. Ce second cas est piégeux : en WebGL, `gl.bufferData` qui échoue ne lève AUCUNE exception, il pose seulement un drapeau d'erreur que seul `gl.getError()` révèle (code `OUT_OF_MEMORY`). Le mécanisme : avant de créer quoi que ce soit, on vide les erreurs en attente en lisant `getError` jusqu'à `NO_ERROR` (avec une borne de 32 lectures, pour ne pas boucler sans fin sur un contexte défaillant), afin de ne pas reprocher à ce maillage une erreur plus ancienne ; puis, après les trois `bufferData` (positions, normales, indices) et AVANT de débrancher le VAO, on lit `getError` une fois. Si le code n'est pas `NO_ERROR`, on lève une erreur en français (« Mémoire graphique insuffisante pour ce modèle » pour `OUT_OF_MEMORY`, sinon « Erreur WebGL ... (code N) »). Le `catch` existant supprime alors le VAO et les buffers déjà créés, et l'erreur remonte par `setMesh` jusqu'à `onMeshError`. Le composant retient le maillage affiché dans une référence, pour que le renderer recréé après une perte de contexte redessine le DERNIER maillage choisi (y compris un maillage choisi pendant la perte). L'état « quelle forme ou quel fichier » vit dans un hook (`ui/useMeshSelection.ts`) : un fichier refusé laisse la sélection précédente en place, et si le GPU refuse un maillage, la sélection revient à la précédente pour que le panneau reste cohérent avec l'écran.

**Pourquoi.** Recréer le contexte à chaque changement de forme gaspillerait l'un des contextes WebGL limités par navigateur et ferait clignoter l'écran. Le chargement d'un fichier est asynchrone : un numéro de requête ignore le résultat d'une lecture devenue périmée (l'utilisateur a changé d'avis entre-temps).

**Compromis.** Pendant un court instant, ancien et nouveau maillage existent ensemble sur le GPU (le temps de la création). C'est le prix de la garantie « l'ancien reste si le nouveau échoue ». Le contrôle par `getError` n'est vérifié qu'avec un faux contexte qui simule `OUT_OF_MEMORY` : un vrai manque de mémoire GPU n'a pas été provoqué. Certains pilotes peuvent aussi différer l'allocation et ne signaler l'échec qu'au dessin ; ce cas n'est pas couvert.

## Limites connues

- Rien de ce qui est listé dans « Pas encore fait » du README n'existe encore (modèles d'éclairage avancés, fil de fer, affichage des normales et de la boîte englobante, souris).
- L'analyseur OBJ suppose des polygones convexes (triangulation en éventail), ignore textures et matériaux, ne recolle pas les lignes terminées par `\`, et suppose des triangles anti-horaires vus de l'extérieur (voir les décisions 11 et 13).
- L'analyse du fichier tourne sur le fil principal : un fichier proche des limites (décision 12) peut figer l'onglet quelques secondes.
- Les limites de taille (50 Mo, 1 million de triangles...) sont des choix de prudence, pas des mesures de performance : aucun test n'a été fait avec de gros fichiers dans un vrai navigateur.
- Les normales calculées sont lisses : un fichier sans normales a ses arêtes vives adoucies.
- La caméra est fixe : un objet très allongé peut sortir un peu du cadre en tournant sur un écran étroit.
- Les tests tournent dans jsdom, qui n'a pas de WebGL : le contexte y est remplacé par un faux. Le rendu réel (cube visible, couleurs, éclairage, taille du canvas, redimensionnement, vraie perte de contexte) n'est pas testé automatiquement et doit être vérifié à la main dans un navigateur.
- Les shaders ne sont jamais compilés par les tests : une faute de GLSL ne se verrait qu'au lancement dans un navigateur (le message de repli s'affiche alors, et le journal du compilateur est dans la console).
- L'éclairage travaille sur les couleurs sRGB sans correction gamma (voir la décision 7).
- Le message de repli est affiché pour toute cause d'absence de WebGL, sans détail.
- Le contexte WebGL n'est pas libéré explicitement au démontage (voir la décision 8).
- Aucune vérification sur Firefox, Safari ou mobile à ce stade.
