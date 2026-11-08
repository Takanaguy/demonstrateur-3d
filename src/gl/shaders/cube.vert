#version 300 es
// Shader de sommets : il s'exécute UNE FOIS PAR SOMMET (24 fois pour le cube) sur le GPU.
// Son travail : dire où le sommet atterrit à l'écran, et passer sa normale au fragment shader.
// (La ligne #version doit être la toute première du fichier, sinon la compilation échoue.)

// Entrées lues dans les buffers. Les numéros (location) sont fixés ici et repris côté TypeScript
// quand on branche les buffers : pas besoin de les redemander au programme.
layout(location = 0) in vec3 aPosition; // position du sommet dans le repère de l'objet
layout(location = 1) in vec3 aNormal;   // normale de la face, dans le repère de l'objet

// Uniforms : valeurs identiques pour tous les sommets d'un même dessin, envoyées par le CPU.
uniform mat4 uModel;        // objet -> monde (rotation du cube)
uniform mat4 uView;         // monde -> caméra
uniform mat4 uProjection;   // caméra -> écran (perspective)
uniform mat3 uNormalMatrix; // inverse transposée de uModel (3x3), pour les normales

// Sortie envoyée au fragment shader. Le GPU l'interpole entre les sommets du triangle.
out vec3 vNormal;

void main() {
  // La normale passe dans le repère du monde, là où la lumière est définie. On n'utilise pas
  // uModel pour elle : une mise à l'échelle non uniforme la rendrait oblique à la surface.
  vNormal = uNormalMatrix * aNormal;

  // Position finale. Les matrices s'appliquent de droite à gauche : modèle, puis vue, puis projection.
  // Le 1.0 (coordonnée w) dit que c'est un point : la translation du modèle doit s'appliquer.
  gl_Position = uProjection * uView * uModel * vec4(aPosition, 1.0);
}
