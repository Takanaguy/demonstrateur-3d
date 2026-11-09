#version 300 es
// Shader de sommets : il s'exécute UNE FOIS PAR SOMMET du maillage (24 pour un cube) sur le GPU.
// Son travail : dire où le sommet atterrit à l'écran, et passer sa normale au fragment shader.
// (La ligne #version doit être la toute première du fichier, sinon la compilation échoue.)

// Entrées lues dans les buffers. Les numéros (location) sont fixés ici et repris côté TypeScript
// quand on branche les buffers : pas besoin de les redemander au programme.
layout(location = 0) in vec3 aPosition; // position du sommet dans le repère de l'objet
layout(location = 1) in vec3 aNormal;   // normale du sommet, dans le repère de l'objet

// Uniforms : valeurs identiques pour tous les sommets d'un même dessin, envoyées par le CPU.
uniform mat4 uModel;        // objet -> monde (rotation de l'objet)
uniform mat4 uView;         // monde -> caméra
uniform mat4 uProjection;   // caméra -> écran (perspective)
uniform mat3 uNormalMatrix; // inverse transposée de uModel (3x3), pour les normales

// Sorties envoyées au fragment shader. Le GPU les interpole entre les sommets du triangle.
out vec3 vNormal;        // normale dans le repère du monde
out vec3 vWorldPosition; // position du sommet dans le repère du monde

void main() {
  // La normale passe dans le repère du monde, là où la lumière est définie. On n'utilise pas
  // uModel pour elle : une mise à l'échelle non uniforme la rendrait oblique à la surface.
  vNormal = uNormalMatrix * aNormal;

  // Position dans le monde (après la rotation de l'objet, avant la caméra). La lumière étant
  // ponctuelle, le fragment shader en a besoin pour calculer, pour CHAQUE pixel, la direction vers la
  // lumière et vers l'oeil. Le 1.0 (coordonnée w) dit que c'est un point : la translation du modèle
  // doit s'appliquer.
  vec4 worldPosition = uModel * vec4(aPosition, 1.0);
  vWorldPosition = worldPosition.xyz;

  // Position finale. Les matrices s'appliquent de droite à gauche : modèle (déjà fait ci-dessus),
  // puis vue, puis projection.
  gl_Position = uProjection * uView * worldPosition;
}
