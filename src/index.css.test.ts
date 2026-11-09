// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Le CSS est lu comme du texte avec `fs` : Vitest ne traite pas les fichiers CSS par défaut (un import
// normal, même avec `?raw`, donnerait un texte vide). Le test tourne dans l'environnement Node, sans
// jsdom, car il n'a besoin d'aucune page. `process.cwd()` est la racine du projet quand on lance Vitest.
const css = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8').replace(/\r\n/g, '\n')

// Test sur le TEXTE du fichier CSS : jsdom ne calcule pas de mise en page, on ne peut pas mesurer le
// décalage réel. Il garde au moins le lien entre la marge de défilement et le plafond de hauteur d'App.tsx.

describe('index.css : marge de défilement sous la 3D collée', () => {
  it('le fichier est bien lu (garde-fou : un texte vide ferait passer à tort les tests suivants)', () => {
    expect(css).toContain('@import "tailwindcss"')
  })

  it('décale le défilement de focus de la hauteur de la 3D collée, plafond de 45vh compris', () => {
    expect(css).toMatch(/html\s*\{\s*scroll-padding-top:\s*calc\(min\(\(100vw - 3rem\) \* 9 \/ 16, 45vh\) \+ 1\.5rem\);/)
  })

  it("retire la marge à partir de md (48rem), où la 3D n'est plus collée", () => {
    expect(css).toMatch(/@media \(min-width: 48rem\)\s*\{\s*html\s*\{\s*scroll-padding-top:\s*0;/)
  })
})
