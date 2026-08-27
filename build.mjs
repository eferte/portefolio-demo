/* ---------------------------------------------------------
   Fabrique « dist » à partir de « src ».

     npm run build          (ou : ./build.sh, ou build.cmd)

   Le build est écrit en Node et non en shell, pour une raison
   simple : il tourne tel quel sous macOS, Linux et Windows.
   Deux scripts parallèles, un par plateforme, auraient dû être
   tenus synchronisés à la main — et la liste SCRIPTS ci-dessous
   doit correspondre exactement aux balises de index.html. Le
   jour où l'un des deux aurait dérivé, « dist » n'aurait plus
   été le même selon la machine, et personne ne s'en serait
   aperçu avant la mise en ligne.

   Ce qu'il fait :
     - tous les scripts de la page deviennent un seul, minifié ;
     - la page perd ses commentaires et ses blancs, son CSS et
       son script en ligne sont resserrés ;
     - three.min.js et le dossier asset sont copiés tels quels.

   three.min.js est une bibliothèque tierce, déjà minifiée : elle
   reste à part, pour garder un cache long et une mise à jour
   simple.
   --------------------------------------------------------- */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = path.dirname(fileURLToPath(import.meta.url));
process.chdir(ici);

/* Tous les scripts de la page, dans l'ordre des balises. Le premier donne
   son nom au paquet : c'est sa balise qui sera remplacée, les autres
   disparaissent. Un fichier ajouté ici est repris partout. */
const SCRIPTS = [
  'paysage3d.core.js',
  'paysage3d.vegetation.js',
  'paysage3d.moulin.js',
  'paysage3d.soleil.js',
  'paysage3d.nuages.js',
  'paysage3d.oiseaux.js',
  'paysage3d.montgolfiere.js',
  'paysage3d.fumee.js',
  'paysage3d.tracteur.js',
  'oiseaux-parcours.js',
  'moulin-pied.js'
];
const PAQUET = 'portefolio.min.js';

// npx s'appelle npx.cmd sous Windows, et n'est trouvable que par le shell.
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function lancer(outil, args) {
  const r = spawnSync(npx, ['--yes', outil, ...args], {
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(`${outil} s'est arrêté avec le code ${r.status}`);
  }
}

// Pour insérer un nom de fichier dans une expression régulière sans que
// ses points passent pour des jokers.
const litteral = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

fs.rmSync('dist', { recursive: true, force: true });
fs.mkdirSync('dist');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'portefolio-'));

try {
  /* 1. Les scripts. Chacun est une fermeture — les modules du décor
        s'inscrivent à un registre, les deux autres ne parlent qu'au DOM :
        les coller bout à bout ne change rien à leur jeu. */
  const colle = SCRIPTS
    .map((nom) => fs.readFileSync(path.join('src', nom), 'utf8'))
    .join('\n');
  const entree = path.join(tmp, PAQUET);
  fs.writeFileSync(entree, colle);

  lancer('esbuild@0.24.0', [
    entree, '--minify', '--target=es2018', '--legal-comments=none',
    `--outfile=${path.join('dist', PAQUET)}`
  ]);

  /* 2. La page : toutes les balises deviennent une seule. La liste
        ci-dessus fait foi — un fichier ajouté là est repris ici. */
  let page = fs.readFileSync(path.join('src', 'index.html'), 'utf8');
  SCRIPTS.forEach((nom, i) => {
    const balise = new RegExp(
      `[ \\t]*<script defer src="${litteral(nom)}"></script>\\r?\\n`, 'g');
    page = page.replace(balise, i === 0 ? `<script defer src="${PAQUET}"></script>\n` : '');
  });

  /* Garde-fou : si un jour un script s'ajoute sans passer par SCRIPTS,
     mieux vaut une erreur bruyante qu'une page au décor incomplet. */
  const restantes = [...page.matchAll(/<script defer src="([^"]+\.js)"/g)]
    .map((m) => m[1])
    .filter((nom) => nom !== 'three.min.js' && nom !== PAQUET);
  if (restantes.length) {
    throw new Error(
      `une balise de script n'a pas été reprise : ${restantes.join(', ')}\n` +
      "Ajoutez le fichier à la liste SCRIPTS de build.mjs.");
  }

  const brouillon = path.join(tmp, 'index.html');
  fs.writeFileSync(brouillon, page);
  lancer('html-minifier-terser@7.2.0', [
    '--collapse-whitespace', '--conservative-collapse', '--remove-comments',
    '--minify-css', 'true', '--minify-js', 'true',
    '--remove-redundant-attributes', '--remove-script-type-attributes',
    '--sort-attributes', '--sort-class-name',
    '-o', path.join('dist', 'index.html'), brouillon
  ]);

  /* 3. Le reste, tel quel — les polices gardent leur dossier, les chemins
        de la page les y cherchent déjà. */
  fs.copyFileSync(path.join('src', 'three.min.js'), path.join('dist', 'three.min.js'));
  fs.cpSync(path.join('src', 'asset'), path.join('dist', 'asset'), { recursive: true });

  console.log('\ndist prêt :');
  for (const nom of fs.readdirSync('dist').sort()) {
    const s = fs.statSync(path.join('dist', nom));
    console.log(s.isDirectory()
      ? `  ${nom}/`
      : `  ${nom.padEnd(20)} ${(s.size / 1024).toFixed(1)} Ko`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
