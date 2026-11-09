#version 300 es
// Shader de fragments : il s'exécute UNE FOIS PAR PIXEL couvert par un triangle.
// Son travail : choisir la couleur du pixel. Ici, un éclairage diffus (loi de Lambert) + ambiant.

// Précision des flottants. Obligatoire en GLSL ES dans le fragment shader (pas de valeur par
// défaut). « mediump » suffit pour des couleurs et des produits scalaires, et marche partout.
precision mediump float;

in vec3 vNormal; // normale interpolée entre les sommets, dans le repère du monde

uniform vec3 uColor;          // couleur de l'objet (RGB entre 0 et 1)
uniform vec3 uLightDirection; // direction VERS la lumière, normalisée (longueur 1)

out vec4 outColor; // couleur écrite dans l'image

// Part de lumière que reçoit même une face tournée à l'opposé de la lumière. Sans elle, ces faces
// seraient noires.
const float AMBIENT = 0.35;

void main() {
  // L'interpolation raccourcit un peu les vecteurs : on remet la normale à la longueur 1.
  vec3 normal = normalize(vNormal);

  // Le face culling est désactivé (un plan ou un fichier OBJ ouvert doit être visible des deux
  // côtés) : on voit donc parfois l'ENVERS d'un triangle. Sa normale pointe alors à l'opposé de
  // l'observateur et l'éclairage serait celui de la face cachée. gl_FrontFacing vaut false quand
  // le triangle est vu par l'arrière (sommets dans le sens des aiguilles d'une montre) : on
  // retourne la normale pour éclairer correctement cette face-là.
  if (!gl_FrontFacing) normal = -normal;

  // Loi de Lambert : l'éclairage vaut le cosinus de l'angle entre la normale et la lumière. Le
  // produit scalaire de deux vecteurs unitaires est ce cosinus. max(..., 0) évite un éclairage
  // négatif pour les faces tournées dos à la lumière.
  float diffuse = max(dot(normal, uLightDirection), 0.0);

  // Ambiant + diffus, borné à 1 au total : une face de plein éclairage garde exactement uColor.
  float light = AMBIENT + (1.0 - AMBIENT) * diffuse;

  outColor = vec4(uColor * light, 1.0); // alpha 1 : opaque
}
