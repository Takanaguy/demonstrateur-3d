#version 300 es
// Shader de fragments des LIGNES : il s'exécute une fois par pixel touché par un trait. Les traits ne
// sont pas éclairés : ils prennent exactement la couleur demandée, pour rester lisibles quel que soit
// l'angle ou la lumière.

// Précision des flottants (obligatoire dans un fragment shader). « mediump » suffit ici, contrairement
// à mesh.frag : on ne fait aucun calcul, on recopie une couleur dont chaque canal est ensuite écrit sur
// 8 bits (256 niveaux), ce que 16 bits de précision représentent très largement.
precision mediump float;

uniform vec3 uColor; // couleur du trait (RGB entre 0 et 1)

out vec4 outColor; // couleur écrite dans l'image

void main() {
  outColor = vec4(uColor, 1.0); // alpha 1 : opaque, pas de transparence
}
