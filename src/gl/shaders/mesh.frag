#version 300 es
// Shader de fragments : il s'exécute UNE FOIS PAR PIXEL couvert par un triangle.
// Son travail : choisir la couleur du pixel. Ici, un éclairage par une lumière PONCTUELLE avec trois
// modèles au choix : Lambert (diffus seul), Blinn-Phong et Gaussien (diffus + reflet).

// Précision des flottants. Obligatoire en GLSL ES dans le fragment shader (pas de valeur par
// défaut). « highp » (32 bits) et non « mediump » (souvent 16 bits) : acos() près de 1 est très
// imprécis en 16 bits, et le reflet gaussien en dépend (un reflet qui se découpe en paliers). Les
// positions du monde interpolées gagnent aussi à être précises.
precision highp float;

in vec3 vNormal;        // normale interpolée entre les sommets, dans le repère du monde
in vec3 vWorldPosition; // position du pixel dans le repère du monde (interpolée aussi)

uniform vec3 uColor;            // couleur de l'objet (RGB entre 0 et 1)
uniform int uLightingModel;     // modèle choisi : 0 Lambert, 1 Blinn-Phong, 2 Gaussien
uniform vec3 uLightPosition;    // position de la lumière dans le monde
uniform vec3 uLightColor;       // couleur de la lumière (RGB entre 0 et 1)
uniform vec3 uCameraPosition;   // position de l'oeil dans le monde
uniform float uAmbient;         // part de lumière ambiante (0 à 1)
uniform float uSpecularIntensity; // intensité du reflet (0 à 1)
uniform float uShininess;       // Blinn-Phong : brillance (exposant)
uniform float uGaussianMean;    // Gaussien : moyenne de l'angle, en radians
uniform float uGaussianStdDev;  // Gaussien : écart type de l'angle, en radians (jamais 0)

out vec4 outColor; // couleur écrite dans l'image

// Numéros des modèles : ils doivent rester identiques à ceux de meshRenderer.ts (MODEL_NUMBER).
const int MODEL_LAMBERT = 0;
const int MODEL_BLINN_PHONG = 1;
const int MODEL_GAUSSIAN = 2;

void main() {
  // L'interpolation raccourcit un peu les vecteurs : on remet la normale à la longueur 1.
  vec3 normal = normalize(vNormal);

  // Le face culling est désactivé (un plan ou un fichier OBJ ouvert doit être visible des deux
  // côtés) : on voit donc parfois l'ENVERS d'un triangle. Sa normale pointe alors à l'opposé de
  // l'observateur et l'éclairage serait celui de la face cachée. gl_FrontFacing vaut false quand
  // le triangle est vu par l'arrière (sommets dans le sens des aiguilles d'une montre) : on
  // retourne la normale pour éclairer correctement cette face-là.
  if (!gl_FrontFacing) normal = -normal;

  // La lumière est ponctuelle : sa direction dépend du pixel. L = direction VERS la lumière,
  // V = direction VERS l'oeil, toutes deux de longueur 1.
  vec3 lightDir = normalize(uLightPosition - vWorldPosition);
  vec3 viewDir = normalize(uCameraPosition - vWorldPosition);

  // Loi de Lambert : l'éclairage diffus vaut le cosinus de l'angle entre la normale et la lumière.
  // Le produit scalaire de deux vecteurs unitaires est ce cosinus. max(..., 0) évite un éclairage
  // négatif pour les faces tournées dos à la lumière.
  float nDotL = dot(normal, lightDir);
  float diffuse = max(nDotL, 0.0);

  // Reflet (spéculaire). Il reste à 0 pour Lambert, et pour toute face qui ne reçoit pas la lumière.
  // H est le vecteur de demi-angle : le milieu entre L et V. Le reflet est maximal quand la normale
  // pointe vers H, c'est-à-dire quand la lumière se réfléchit droit vers l'oeil.
  // Le test sur la longueur évite de normaliser un vecteur nul (cas où L et V sont opposés).
  float reflection = 0.0;
  vec3 halfSum = lightDir + viewDir;
  if (uLightingModel != MODEL_LAMBERT && nDotL > 0.0 && length(halfSum) > 0.0001) {
    vec3 halfVector = normalize(halfSum);
    float nDotH = dot(normal, halfVector);

    // Ces deux formules sont les mêmes que blinnPhongSpecular et gaussianSpecular dans
    // src/core/lighting.ts : cette version TypeScript sert de référence testable, car les shaders ne
    // sont pas exécutés par les tests. Toute modification doit être faite aux deux endroits.
    if (uLightingModel == MODEL_BLINN_PHONG) {
      // cos(angle)^brillance : plus la brillance est grande, plus le reflet est petit et net.
      reflection = pow(max(nDotH, 0.0), uShininess);
    } else if (uLightingModel == MODEL_GAUSSIAN) {
      // Courbe de Gauss de l'angle theta entre la normale et H. clamp : une erreur d'arrondi peut
      // pousser nDotH à 1.0000001, et acos renverrait alors NaN.
      float theta = acos(clamp(nDotH, -1.0, 1.0));
      float offset = theta - uGaussianMean;
      reflection = exp(-(offset * offset) / (2.0 * uGaussianStdDev * uGaussianStdDev));
    }
  }

  // Composition. L'ambiant est blanc (il ne dépend pas de la lumière). Le diffus prend la couleur de
  // l'objet ET celle de la lumière, avec la part (1 - ambiant) : avec une lumière blanche, une face
  // en plein éclairage garde exactement uColor. Le reflet prend seulement la couleur de la lumière.
  vec3 ambientPart = uColor * uAmbient;
  vec3 diffusePart = uColor * uLightColor * (1.0 - uAmbient) * diffuse;
  vec3 specularPart = uLightColor * uSpecularIntensity * reflection;

  // Le matériel borne déjà à 1 à l'écriture, mais on le fait explicitement pour que ce soit lisible.
  vec3 color = min(ambientPart + diffusePart + specularPart, vec3(1.0));

  outColor = vec4(color, 1.0); // alpha 1 : opaque
}
