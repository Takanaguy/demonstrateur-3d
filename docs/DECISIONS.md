# Choix techniques et limites

Ce document explique les décisions du démonstrateur 3D. Chaque décision suit le même plan : contexte, décision, pourquoi, compromis. Pour l'usage du projet (lancement, scripts, structure), voir le [README](../README.md).

## Méthode de travail

Le projet est réalisé étape par étape (un ticket à la fois) avec l'assistance de Claude Code : chaque étape a son commit et ses tests. La section suivante est réservée à Tanguy.

## Ma part et ce que j'en retiens

À compléter par Tanguy.

- Ce que j'ai décidé :
- Ce que j'ai appris :
- Ce que je referais autrement :

## Les décisions

### 1. Three.js plutôt qu'OpenGL brut

**Contexte.** Le projet de cours d'origine était écrit en OpenGL, sans moteur : tout était fait à la main (matrices, shaders, boucle de rendu).

**Décision.** Ce démonstrateur utilise Three.js, au-dessus de WebGL.

**Pourquoi.** Refaire le même exercice avec WebGL brut n'apporterait rien de nouveau. Ici le but est de montrer de l'intégration web : un composant React qui gère le cycle de vie d'un renderer, le redimensionnement, l'accessibilité (`prefers-reduced-motion`, message de repli), les tests. Three.js fournit la scène, la caméra, les matériaux et les lumières, et laisse la place d'écrire soi-même les parties intéressantes plus tard (modèles d'éclairage, analyseur OBJ).

**Compromis.** Three.js cache une partie de ce qu'OpenGL oblige à comprendre. Les modèles d'éclairage prévus (Blinn-Phong, gaussien) devront être écrits explicitement (shader personnalisé) pour que le travail reste instructif, plutôt que de se contenter des matériaux fournis.

### 2. Un dossier `core/` sans React

**Contexte.** Le démonstrateur doit pouvoir être réutilisé dans un autre projet, et une bonne partie du futur code est du calcul pur (analyse d'un fichier OBJ, normales, boîte englobante).

**Décision.** Tout ce qui n'a pas besoin de React vit dans `src/core/`, sans import de React. Le composant `src/viewer/Viewer3D.tsx` ne fait que brancher cette logique sur un canvas.

**Pourquoi.** Du code sans React se teste sans interface, vite, avec des entrées et des sorties simples. Il se déplace aussi dans un autre projet sans embarquer d'interface. Exemple actuel : `advanceRotation` (calcul de la rotation selon le temps écoulé) et `isWebGLAvailable` (qui reçoit une fabrique de canvas pour pouvoir être testée avec un faux).

**Compromis.** Pour l'instant `core/` est petit : la séparation est surtout une règle posée tôt, avant que le code grossisse. Si un jour `core/` a besoin de types de Three.js, la règle sera à rediscuter.

### 3. Un dépôt séparé

**Contexte.** Le démonstrateur sera un jour montré dans l'éditeur de présentations de Tanguy.

**Décision.** Un dépôt autonome, avec ses propres tests et sa propre documentation, plutôt qu'un dossier dans le dépôt de l'éditeur.

**Pourquoi.** Il garde un historique lisible, peut être présenté seul, et son interface avec l'extérieur reste étroite (un composant qui remplit son parent). Cela oblige à garder le composant indépendant de son contexte.

**Compromis.** L'intégration demandera un vrai travail (publier le composant ou le copier, gérer les versions). Ce travail n'est pas fait : il fera l'objet d'un ticket.

### 4. Cycle de vie du renderer et StrictMode

**Contexte.** En développement, StrictMode monte, démonte puis remonte chaque composant. Un renderer WebGL non libéré, ou une boucle d'animation non annulée, s'accumule alors.

**Décision.** Tout ce que l'effet de `Viewer3D` crée est libéré dans sa fonction de nettoyage : annulation de `requestAnimationFrame`, déconnexion du `ResizeObserver`, `dispose` de la géométrie et du matériau, `dispose` du renderer. Le canvas est rendu par React (pas créé à la main), il n'y a donc jamais deux canvas.

**Pourquoi.** Les géométries et matériaux Three.js vivent sur le GPU : le ramasse-miettes de JavaScript ne les libère pas, il faut appeler `dispose`. Les tests vérifient ces appels, y compris le cas StrictMode (deux renderers créés, le premier libéré, une seule boucle vivante).

**Compromis.** On n'appelle volontairement pas `renderer.forceContextLoss()` : le second montage de StrictMode réutilise le même canvas, et un contexte perdu volontairement ne se récupère pas. Conséquence : le contexte WebGL n'est libéré qu'à la disparition du canvas. C'est suffisant pour un composant monté une fois, à surveiller si le composant est monté et démonté très souvent.

### 5. Détection de WebGL avant le renderer

**Décision.** `isWebGLAvailable` crée un canvas jetable, demande un contexte `webgl2`, le libère aussitôt, et renvoie un booléen. Le composant affiche un message en français si c'est faux, ou si la création du renderer échoue quand même.

**Pourquoi.** Sans cela, `new WebGLRenderer()` lève une exception et l'écran reste blanc. Seul WebGL 2 est testé car Three.js ne gère plus WebGL 1 depuis sa version r163.

**Compromis.** Le message est le même pour toutes les causes (navigateur trop ancien, accélération matérielle désactivée, etc.) : on ne sait pas les distinguer de façon fiable.

### 6. Mouvement réduit

**Décision.** Si la requête `prefers-reduced-motion: reduce` est vraie, le cube reste fixe (il est quand même affiché). La requête est lue à chaque image, donc un changement du réglage système en cours d'utilisation est pris en compte sans écouteur supplémentaire.

**Compromis.** La boucle de rendu tourne même quand rien ne bouge. C'est simple et sans conséquence pour un cube ; elle devra de toute façon tourner quand la souris fera pivoter la scène. À revoir si la consommation devient un sujet (rendu à la demande).

## Limites connues

- Rien de ce qui est listé dans « Pas encore fait » du README n'existe encore (formes, OBJ, éclairage, fil de fer, normales, boîte englobante, souris).
- Les tests tournent dans jsdom, qui n'a pas de WebGL : le renderer y est remplacé par un faux. Le rendu réel (cube visible, couleurs, éclairage, taille du canvas, redimensionnement) n'est pas testé automatiquement et doit être vérifié à la main dans un navigateur.
- Le message de repli est affiché pour toute cause d'absence de WebGL, sans détail.
- Le contexte WebGL n'est pas libéré explicitement au démontage (voir la décision 4).
- Aucune vérification sur Firefox, Safari ou mobile à ce stade.
