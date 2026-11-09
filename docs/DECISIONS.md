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

## Limites connues

- Rien de ce qui est listé dans « Pas encore fait » du README n'existe encore (formes, OBJ, modèles d'éclairage avancés, fil de fer, normales, boîte englobante, souris).
- Les tests tournent dans jsdom, qui n'a pas de WebGL : le contexte y est remplacé par un faux. Le rendu réel (cube visible, couleurs, éclairage, taille du canvas, redimensionnement, vraie perte de contexte) n'est pas testé automatiquement et doit être vérifié à la main dans un navigateur.
- Les shaders ne sont jamais compilés par les tests : une faute de GLSL ne se verrait qu'au lancement dans un navigateur (le message de repli s'affiche alors, et le journal du compilateur est dans la console).
- L'éclairage travaille sur les couleurs sRGB sans correction gamma (voir la décision 7).
- Le message de repli est affiché pour toute cause d'absence de WebGL, sans détail.
- Le contexte WebGL n'est pas libéré explicitement au démontage (voir la décision 8).
- Aucune vérification sur Firefox, Safari ou mobile à ce stade.
