#version 300 es
// Shader de sommets des LIGNES (fil de fer, normales, boîte englobante, grille, axes) : il s'exécute une
// fois par extrémité de segment. Il fait la même chose que mesh.vert pour la position, sans normale :
// ces traits ne sont pas éclairés.
// (La ligne #version doit être la toute première du fichier, sinon la compilation échoue.)

// Entrée lue dans le buffer. Le numéro (location) est repris côté TypeScript (lineRenderer.ts).
layout(location = 0) in vec3 aPosition; // extrémité d'un segment, dans le repère de la série

// Uniforms : mêmes valeurs pour toute la série dessinée.
uniform mat4 uModel;      // série -> monde : la rotation de l'objet pour ses aides, l'identité pour la grille et les axes
uniform mat4 uView;       // monde -> caméra (la MÊME matrice que celle du programme de l'objet)
uniform mat4 uProjection; // caméra -> écran (la MÊME aussi)

void main() {
  // Les mêmes opérations, dans le même ordre, que dans mesh.vert (position dans le monde d'abord,
  // puis vue, puis projection) : les profondeurs des traits et des surfaces concordent ainsi le mieux
  // possible. Le reste de l'écart est absorbé par le polygon offset du renderer.
  vec4 worldPosition = uModel * vec4(aPosition, 1.0);
  gl_Position = uProjection * uView * worldPosition;
}
