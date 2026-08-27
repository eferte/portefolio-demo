"use strict";
(function () {
const THREE = window.THREE;

/* =========================================================
   Survol de campagne — décor 3D animé (Three.js)
   Un vol d'oiseau au-dessus de collines : petite route,
   maisons de campagne, chapelle, rivière et son pont,
   arbres tout ronds, fleurs, étang, nuages et oiseaux.
   Tout est généré à la volée : aucune texture, aucun modèle,
   aucune requête réseau. Pensé pour servir de fond à une
   page d'accueil.

   Ce fichier est le socle : le relief et ses parcelles, la
   rivière et l'étang, la route et ses ponts, le village, le
   ciel, la lumière, la trajectoire de vol et la boucle de
   rendu. Tout le reste est greffé par des modules facultatifs
   — chacun dans son fichier, chacun retirable.

   Utilisation :
     <div id="paysage3d"></div>
     <script defer src="three.min.js"></script>
     <script defer src="paysage3d.core.js"></script>
     <script defer src="paysage3d.vegetation.js"></script>   <!-- facultatif -->
     <script defer src="paysage3d.moulin.js"></script>       <!-- facultatif -->
     <script defer src="paysage3d.soleil.js"></script>       <!-- facultatif -->
     <script defer src="paysage3d.nuages.js"></script>       <!-- facultatif -->
     <script defer src="paysage3d.oiseaux.js"></script>      <!-- facultatif -->
     <script defer src="paysage3d.montgolfiere.js"></script> <!-- facultatif -->

   L'ordre des balises n'a pas d'importance : chaque module
   s'inscrit au registre, et le socle attend que la page soit
   lue avant de construire quoi que ce soit.

   Écrire un module — un fichier, une fermeture, trois clés :

     (function () {
       const paysage3d = (window.paysage3d = window.paysage3d || {});
       (paysage3d.modules = paysage3d.modules || []).push({
         nom: 'ballons',
         ordre: 60,          // < 20 : avant la végétation ; défaut 50
         creer(ctx) {
           // ctx : THREE, scene, camera, C, terrainHeight,
           // flightPath, buildings, village, buildInstanced… et
           // ctx.graine('ballons') pour un hasard bien à soi.
           return {
             animer(dt, elapsed) { ... },      // facultatif
             entree(fondu) { ... }             // facultatif : décollage
           };
         }
       });
     })();

   Le module se greffe sur le premier élément trouvé parmi
   #paysage3d, [data-paysage3d] ou .paysage3d ; à défaut il
   crée lui-même un calque plein écran en position fixe.
   ========================================================= */

/* ---------------------------------------------------------
   Entrées en douceur
   Le décor n'a besoin que de trois choses animées « de
   l'extérieur » : l'horloge du vol (linéaire, en boucle, voir
   la boucle de rendu), le fondu de la brume (confié au CSS) et
   la séquence de décollage — quelques réglages qui partent
   d'une valeur et rejoignent la leur. Tout le reste se calcule
   à chaque image à partir du temps écoulé. D'où ces trente
   lignes, plutôt qu'une bibliothèque d'animation.
   --------------------------------------------------------- */
// Les deux courbes utilisées, aux noms de GSAP dont elles reprennent la forme.
const sortieQuad    = (x) => 1 - (1 - x) * (1 - x);          // power1.out
const sortieCubique = (x) => 1 - Math.pow(1 - x, 3);         // power2.out

const entrees = [];

/* « Ce réglage part de là et rejoint sa valeur en `duree` secondes. » La valeur
   d'arrivée est celle que porte déjà l'objet : on la relève, puis on le repose
   au départ — il est donc en place dès la première image. */
function entrer(cible, propriete, depuis, duree, retard, ease, apres) {
  const vers = cible[propriete];
  cible[propriete] = depuis;
  entrees.push({
    cible, propriete, depuis, vers, duree,
    retard: retard || 0, ease: ease || sortieCubique, apres,
    t: 0, fini: false
  });
  if (apres) apres();
}

/* Chaque entrée porte son propre chronomètre : celles créées ensemble
   avancent ensemble, et une entrée greffée plus tard part de zéro sans rien
   savoir des autres. */
function avancerEntrees(dt) {
  if (!entrees.length) return;
  let restantes = false;
  for (const e of entrees) {
    if (e.fini) continue;
    e.t += dt;
    const x = (e.t - e.retard) / e.duree;
    if (x <= 0) { restantes = true; continue; }
    e.cible[e.propriete] = x >= 1
      ? e.vers
      : e.depuis + (e.vers - e.depuis) * e.ease(x);
    if (e.apres) e.apres();
    if (x >= 1) e.fini = true; else restantes = true;
  }
  if (!restantes) entrees.length = 0;   // plus rien à suivre : on libère
}

/* Le crochet remis aux modules. `base` décale toute la séquence : le décollage
   se donne un souffle de 0,15 s, un module arrivé en retard entre tout de suite. */
const faireFondu = (base) => (cible, propriete, depuis, duree, retard) =>
  entrer(cible, propriete, depuis, duree, base + (retard || 0));

/* ---------------------------------------------------------
   Registre des modules
   Chaque fichier facultatif s'inscrit ici en s'ajoutant à
   `window.paysage3d.modules`. Le socle les trie par `ordre`,
   les construit une fois la scène prête, puis appelle leurs
   crochets. Un module qui échoue est mis de côté sans
   emporter le reste du décor avec lui.
   --------------------------------------------------------- */
const paysage3d = (window.paysage3d = window.paysage3d || {});
const modules = (paysage3d.modules = paysage3d.modules || []);
const greffes = [];      // { nom, animer?, entree? } des modules construits
let contexte = null;     // renseigné dès que la scène est debout

function greffer(mod, ctx, tardif) {
  if (typeof mod.creer !== 'function') return;
  try {
    const greffe = mod.creer(ctx) || {};
    greffe.nom = mod.nom || '(sans nom)';
    greffes.push(greffe);
    // Un module arrivé après le décollage ne doit pas surgir d'un coup au
    // milieu de l'image : on rejoue son entrée pour lui seul, en fondu.
    if (tardif && greffe.entree && !reduced) greffe.entree(faireFondu(0));
  } catch (e) {
    console.error(`paysage3d : le module « ${mod.nom || '?'} » n'a pas pu se greffer`, e);
  }
}

function construireModules(ctx) {
  contexte = ctx;
  const liste = modules.slice().sort((a, b) => (a.ordre ?? 50) - (b.ordre ?? 50));
  for (const mod of liste) greffer(mod, ctx, false);

  // À partir d'ici, la scène tourne. Un module qui s'inscrit en retard —
  // chargé en `async`, injecté par un autre script, ou simplement plus lent à
  // arriver que ses voisins — est greffé sur-le-champ, et en fondu.
  modules.push = function (mod) {
    Array.prototype.push.call(this, mod);
    greffer(mod, contexte, true);
  };
}

function animerModules(dt, elapsed) {
  for (let i = greffes.length - 1; i >= 0; i--) {
    const g = greffes[i];
    if (!g.animer) continue;
    try {
      g.animer(dt, elapsed);
    } catch (e) {
      // Une erreur par image inonderait la console : on débranche le module.
      console.error(`paysage3d : le module « ${g.nom} » est débranché`, e);
      g.animer = null;
    }
  }
}

/* ---------------------------------------------------------
   Palette — accordée aux couleurs du site
   (bleu d'encre #3f5d9e et gris de plomb #4f5a63 : on les retrouve sur les
    portes, les bleuets des champs et les fuseaux de la montgolfière — jamais
    en masse, le paysage doit rester un paysage.)
   --------------------------------------------------------- */
const C = {
  // Le bas du ciel et la brume du lointain doivent tomber sur le fond de la
  // page (#f4f5f3) : c'est là que le canevas et la page se rejoignent, et
  // toute différence se lirait comme une couture à l'horizon.
  // Le haut du ciel est un rien plus franc qu'avant : avec un bleu d'encre
  // dans les titres, un ciel trop pâle donnait au décor un air délavé.
  skyTop:    0xb6d2e6,
  skyBottom: 0xf4f5f3,
  fog:       0xeff1ee,

  grassLight: 0xa9c96a,
  grassMid:   0x86b258,
  grassDeep:  0x5f9147,
  grassDark:  0x4a7a3e,
  fieldGold:  0xe3c46d,
  fieldOchre: 0xd2a253,
  fieldWheat: 0xefd89a,
  sand:       0xdcc9a2,

  road:   0xe6d5b4,
  verge:  0xcbb98f,

  wall:   0xfdf6e8,
  wall2:  0xf5e6cd,
  // Les tuiles restent terre cuite — c'est la couleur d'un vrai toit, pas un
  // choix de charte. Seuls l'ancien corail exact et l'ancien bleu canard
  // sortent : le premier pour une brique un peu plus sourde, le second pour
  // l'ardoise du site.
  roofs:  [0xab4f46, 0xc74a33, 0xb9552f, 0x4a5866, 0x8c4a3a],
  window: 0xffd98a,
  doors:  [0x3f5d9e, 0x4f5a63, 0x7a4a2f],   // bleu d'encre, plomb, bois
  wood:   0x8a6a45,

  foliage: [0x4f8f46, 0x63a352, 0x3f7a3e, 0x76b45c, 0x568a4b],
  blossom: [0xf0a3a0, 0xe9c3d6, 0xf4b9a2],
  trunk:   0x8a6647,
  conifer: [0x2f6b4a, 0x3c7d52, 0x27593f],

  // Le premier ton est celui du site : ici, un bleuet — la fleur qui pousse
  // vraiment dans les blés, et qui porte la couleur de la page sans effort.
  petals: [0x6b86c9, 0xdfa53a, 0xfff8ef, 0xef9ab5, 0x9b7fd4, 0xf6c453],

  sun:    0xffcf4d,
  sunRay: 0xffb547,

  // L'eau est ce que le paysage a de plus proche du bleu du site : elle réfléchit
  // le ciel, on peut donc la tirer franchement vers l'encre sans qu'elle cesse
  // d'être de l'eau. Le fond du chenal est plus sombre et plus bleu que la
  // surface — c'est la profondeur qui mange le vert.
  water:      0x5b93c4,   // le plan d'eau de l'étang
  river:      0x6099c9,   // la surface vive de la rivière
  riverDeep:  0x3f6f96,   // le fil du courant, au plus creux
  plank:  0x9a7a52,
  cloud:  0xfffaf1,
  birds:  [0xb3aca1, 0xa8937b, 0xc2b6a4],   // gris et bruns clairs
  mill:   0xf2e9d8,
  // La montgolfière est l'objet le plus regardé du décor : c'est elle qui
  // porte le mieux les couleurs du site.
  gores:  [0x3f5d9e, 0xfdf6e8, 0x4f5a63, 0xdfa53a],   // fuseaux de la montgolfière
  nacelle: 0x9a7446,
  millCap: 0x6b4a35
};

/* ---------------------------------------------------------
   Aléatoire déterministe + bruit
   --------------------------------------------------------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Changez cette graine et le village se réinvente.
const GRAINE = 20260825;
const rand = mulberry32(GRAINE);

/* Chaque module tire son hasard d'une graine qui n'appartient qu'à lui, dérivée
   de son nom. Deux conséquences : un module absent ne décale plus les tirages
   des autres — le paysage est identique, avec ou sans lui — et un module donne
   toujours le même résultat, quels que soient ses voisins. */
function graine(nom) {
  let h = 0x811c9dc5;
  for (let i = 0; i < nom.length; i++) {
    h ^= nom.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const r = mulberry32((GRAINE ^ h) >>> 0);
  return {
    rand: r,
    rnd: (a, b) => a + (b - a) * r(),
    pick: (arr) => arr[Math.floor(r() * arr.length) % arr.length]
  };
}
const rnd = (a, b) => a + (b - a) * rand();
const pick = (arr) => arr[Math.floor(rand() * arr.length) % arr.length];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

function hash2(ix, iy) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
function fbm(x, y, oct = 4) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { s += vnoise(x * f, y * f) * amp; norm += amp; amp *= 0.5; f *= 2; }
  return s / norm;
}

/* ---------------------------------------------------------
   Relief et parcelles
   --------------------------------------------------------- */
const CELL = 46;                 // taille moyenne d'une parcelle
const FIELD_A = 0.38;            // les champs ne sont pas alignés sur les axes
const COS_A = Math.cos(FIELD_A), SIN_A = Math.sin(FIELD_A);

/* Chaque parcelle tire sa culture au sort — d'où le patchwork de campagne.
   Le repère est d'abord déformé par un bruit lent : les limites cessent d'être
   des droites et se mettent à serpenter, comme des parcelles réelles. On
   renvoie aussi la distance à la limite, qui sert aux lisières et aux haies. */
function fieldKind(x, z) {
  const wx = x + (fbm(x * 0.0035 + 5.1, z * 0.0035 - 2.3, 3) - 0.5) * 74
              + (fbm(x * 0.016 - 1.7, z * 0.016 + 3.3, 2) - 0.5) * 16
              + (fbm(x * 0.06 + 2.2, z * 0.06 - 7.1, 2) - 0.5) * 4;
  const wz = z + (fbm(x * 0.0035 - 8.7, z * 0.0035 + 4.9, 3) - 0.5) * 74
              + (fbm(x * 0.016 + 6.1, z * 0.016 - 5.5, 2) - 0.5) * 16
              + (fbm(x * 0.06 - 4.4, z * 0.06 + 1.9, 2) - 0.5) * 4;
  const rx = wx * COS_A - wz * SIN_A;
  const rz = wx * SIN_A + wz * COS_A;

  let cw = CELL, ch = CELL * 1.22;
  let gx = rx / cw, gz = rz / ch;
  let ci = Math.floor(gx), cj = Math.floor(gz);
  // Une parcelle sur deux se divise : toutes les fermes n'ont pas la même taille
  const decoupe = hash2(ci * 19 + 7, cj * 23 + 13);
  if (decoupe > 0.52) {
    const f = decoupe > 0.82 ? 3 : 2;
    cw /= f; ch /= f;
    gx = rx / cw; gz = rz / ch;
    ci = Math.floor(gx); cj = Math.floor(gz);
  }
  const fx = gx - ci, fz = gz - cj;
  const bord = Math.min(Math.min(fx, 1 - fx) * cw, Math.min(fz, 1 - fz) * ch);
  return { k: hash2(ci * 7 + 3, cj * 13 + 11), rx, cj, ci, bord };
}

const LAKE = { x: -238, z: 22, r: 64, base: 0, level: 0, ready: false, depth: 10 };

/* La rivière : tracé, lit et champ de distance (remplis au démarrage). */
const RIVER = { pts: [], bed: [], surf: [], width: [], field: null, ready: false };

/* La ligne de rivage réelle : on la relève sur le relief au lieu de la
   supposer. C'est elle qui dit jusqu'où va la nappe — sinon l'eau déborde sur
   la berge et des arbres se retrouvent les pieds dedans. */
const RIVAGE = { n: 288, r: null };

function calculerRivage() {
  RIVAGE.r = new Float32Array(RIVAGE.n);
  for (let k = 0; k < RIVAGE.n; k++) {
    const a = (k / RIVAGE.n) * Math.PI * 2;
    const cx = Math.cos(a), cz = Math.sin(a);
    // On borne la remontée : sans cela, l'étang envahirait le chenal de la
    // rivière sur toute la portion où le lit passe sous son niveau.
    const rMax = Math.min(lakeRadius(a) * 1.5, LAKE.r * 1.3);
    let r = rMax;
    for (let d = LAKE.r * 0.15; d <= rMax; d += 0.6) {
      if (terrainHeight(LAKE.x + cx * d, LAKE.z + cz * d) > LAKE.level) { r = d; break; }
    }
    RIVAGE.r[k] = Math.max(4, r - 0.4);
  }
  // Adoucissement : sans lui, le bras qui rejoint le pont se termine en pointe
  // triangulaire, et la jonction avec le corps de l'étang fait un angle vif.
  for (let passe = 0; passe < 4; passe++) {
    const copie = RIVAGE.r.slice();
    for (let k = 0; k < RIVAGE.n; k++) {
      const a = copie[(k - 1 + RIVAGE.n) % RIVAGE.n];
      const b = copie[k];
      const c = copie[(k + 1) % RIVAGE.n];
      RIVAGE.r[k] = (a + 2 * b + c) / 4;
    }
  }
}

function lakeShore(theta) {
  if (!RIVAGE.r) return lakeRadius(theta) * 0.9;
  const t = ((theta / (Math.PI * 2)) % 1 + 1) % 1 * RIVAGE.n;
  const i = Math.floor(t), f = t - i;
  return RIVAGE.r[i % RIVAGE.n] * (1 - f) + RIVAGE.r[(i + 1) % RIVAGE.n] * f;
}

/* Le bras qui remonte jusqu'au pont : c'est lui qui masque la jonction entre
   la rivière et l'étang, en passant sous le tablier. */
const BRAS = { angle: null, portee: 0, largeur: 0.24 };

/* Rive irrégulière : le rayon de l'étang ondule avec l'angle. */
function lakeRadius(theta) {
  const n = vnoise(Math.cos(theta) * 1.7 + 4.2, Math.sin(theta) * 1.7 - 2.6);
  const n2 = vnoise(Math.cos(theta) * 3.9 - 1.1, Math.sin(theta) * 3.9 + 6.3);
  let R = LAKE.r * (0.82 + 0.3 * n + 0.12 * n2);
  if (BRAS.angle !== null) {
    let d = theta - BRAS.angle;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const k = Math.exp(-(d * d) / (2 * BRAS.largeur * BRAS.largeur));
    R = R * (1 - k) + Math.max(R, BRAS.portee) * k;
  }
  return R;
}

function rawHeight(x, z) {
  let h = 0;
  h += (fbm(x * 0.0032 + 11.5, z * 0.0032 - 4.2, 4) - 0.5) * 38;
  h += (fbm(x * 0.011 - 3.1, z * 0.011 + 7.7, 3) - 0.5) * 11;
  h += (fbm(x * 0.05 + 21, z * 0.05 + 2, 2) - 0.5) * 2.4;
  return h + 6;
}
function terrainHeight(x, z) {
  let h = rawHeight(x, z);
  if (LAKE.ready) {
    const dx = x - LAKE.x, dz = z - LAKE.z;
    const d = Math.hypot(dx, dz);
    if (d < LAKE.r * 1.45) {
      const R = lakeRadius(Math.atan2(dz, dx));
      const k = smoothstep(R, R * 0.6, d);
      h = h * (1 - k) + (LAKE.base - LAKE.depth) * k;
    }
  }
  if (RIVER.ready) {
    const { d, i } = RIVER.field.sample(x, z);
    const Wc = RIVER.width[i];       // le chenal
    const Wv = Wc * 4.6;             // la vallée qui l'accompagne
    if (d < Wv) {
      const bed = RIVER.bed[i];
      const k1 = smoothstep(Wv, 0, d);
      // Vallée et chenal ne font que creuser : jamais de bourrelet là où le
      // sol est déjà plus bas que le fil de l'eau.
      h = Math.min(h, h * (1 - k1 * 0.92) + (bed + 3.2) * (k1 * 0.92));
      if (d < Wc) {
        const k2 = smoothstep(Wc, 0, d);
        h = Math.min(h, h * (1 - k2) + bed * k2);
      }
    }
  }
  return h;
}

/* Champ de distance à une polyligne : creuser la vallée demande des dizaines
   de milliers de requêtes, autant les payer une bonne fois sur une grille. */
function distanceField(pts, cell, pad) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  minX -= pad; maxX += pad; minZ -= pad; maxZ += pad;
  const nx = Math.ceil((maxX - minX) / cell) + 1;
  const nz = Math.ceil((maxZ - minZ) / cell) + 1;
  const dist = new Float32Array(nx * nz);
  const near = new Int32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = minX + i * cell, z = minZ + j * cell;
      let best = Infinity, bi = 0;
      for (let k = 0; k < pts.length; k++) {
        const dx = pts[k].x - x, dz = pts[k].z - z;
        const d2 = dx * dx + dz * dz;
        if (d2 < best) { best = d2; bi = k; }
      }
      dist[j * nx + i] = Math.sqrt(best);
      near[j * nx + i] = bi;
    }
  }
  return {
    sample(x, z) {
      const fx = (x - minX) / cell, fz = (z - minZ) / cell;
      if (fx < 0 || fz < 0 || fx > nx - 1 || fz > nz - 1) return { d: 1e6, i: 0 };
      const i = Math.floor(fx), j = Math.floor(fz);
      const i2 = Math.min(i + 1, nx - 1), j2 = Math.min(j + 1, nz - 1);
      const tx = fx - i, tz = fz - j;
      const d00 = dist[j * nx + i], d10 = dist[j * nx + i2];
      const d01 = dist[j2 * nx + i], d11 = dist[j2 * nx + i2];
      const d = (d00 * (1 - tx) + d10 * tx) * (1 - tz) + (d01 * (1 - tx) + d11 * tx) * tz;
      return { d, i: near[(tz > 0.5 ? j2 : j) * nx + (tx > 0.5 ? i2 : i)] };
    }
  };
}

/* Le cours d'eau descend vraiment la pente : on part d'un point haut et on
   suit le gradient du relief, avec un peu d'inertie — d'où les méandres — et
   une attirance croissante vers l'étang, qui sert d'exutoire. */
/* Un vrai réseau hydrographique, calculé comme en géomorphologie : sur une
   grille, chaque cellule s'écoule vers sa voisine la plus basse (D8), puis on
   cumule les surfaces drainées. Le cours principal est celui qui, depuis
   l'exutoire, remonte toujours vers le plus gros apport. Une rivière obtenue
   ainsi est dans son thalweg par construction — et son profil descend
   forcément, puisqu'on n'a suivi que des pentes descendantes. */
function traceDrainage(cell, portee, outX, outZ, rayonSortie) {
  const n = Math.floor((portee * 2) / cell) + 1;
  const idx = (i, j) => j * n + i;
  const xAt = (i) => -portee + i * cell;
  const zAt = (j) => -portee + j * cell;

  const brut = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) brut[idx(i, j)] = rawHeight(xAt(i), zAt(j));
  }

  // Remplissage des cuvettes (priority-flood) : un relief de bruit en est
  // criblé, et sans cela l'écoulement s'arrête au bout de trois cellules.
  // On amorce par le bord de la carte et par l'étang, seuls exutoires.
  const h = new Float32Array(n * n).fill(Infinity);
  const tas = [];
  const monte = (k) => {
    let i = k;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (tas[p][0] <= tas[i][0]) break;
      const t = tas[p]; tas[p] = tas[i]; tas[i] = t;
      i = p;
    }
  };
  const enfile = (v) => { tas.push(v); monte(tas.length - 1); };
  const defile = () => {
    const sommet = tas[0];
    const dernier = tas.pop();
    if (tas.length) {
      tas[0] = dernier;
      let i = 0;
      for (;;) {
        const g = 2 * i + 1, d = g + 1;
        let m = i;
        if (g < tas.length && tas[g][0] < tas[m][0]) m = g;
        if (d < tas.length && tas[d][0] < tas[m][0]) m = d;
        if (m === i) break;
        const t = tas[m]; tas[m] = tas[i]; tas[i] = t;
        i = m;
      }
    }
    return sommet;
  };

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const c = idx(i, j);
      const bord = i === 0 || j === 0 || i === n - 1 || j === n - 1;
      const etang = Math.hypot(xAt(i) - outX, zAt(j) - outZ) < rayonSortie;
      if (bord || etang) { h[c] = brut[c]; enfile([h[c], c]); }
    }
  }
  while (tas.length) {
    const [hc, c] = defile();
    const i = c % n, j = (c - i) / n;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const v = idx(ii, jj);
        if (h[v] !== Infinity) continue;
        h[v] = Math.max(brut[v], hc + 0.002);   // pente minimale, jamais de plat
        enfile([h[v], v]);
      }
    }
  }

  // Récepteur D8 : la voisine la plus basse, si elle est plus basse
  const rec = new Int32Array(n * n).fill(-1);
  for (let j = 1; j < n - 1; j++) {
    for (let i = 1; i < n - 1; i++) {
      const c = idx(i, j);
      let best = -1, pente = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const v = idx(i + di, j + dj);
          const d = (h[c] - h[v]) / Math.hypot(di, dj);
          if (d > pente) { pente = d; best = v; }
        }
      }
      rec[c] = best;
    }
  }

  // Accumulation : on traite les cellules de la plus haute à la plus basse
  const ordre = Array.from({ length: n * n }, (_, k) => k).sort((a, b) => h[b] - h[a]);
  const acc = new Float32Array(n * n).fill(1);
  for (const c of ordre) if (rec[c] >= 0) acc[rec[c]] += acc[c];

  // Exutoire : la cellule la mieux alimentée qui touche l'étang
  let sortie = -1;
  for (let j = 1; j < n - 1; j++) {
    for (let i = 1; i < n - 1; i++) {
      const c = idx(i, j);
      if (Math.hypot(xAt(i) - outX, zAt(j) - outZ) > rayonSortie) continue;
      if (sortie < 0 || acc[c] > acc[sortie]) sortie = c;
    }
  }
  if (sortie < 0) return [];

  // Remontée du cours principal : à chaque pas, l'affluent le plus gros
  const chemin = [sortie];
  const vus = new Set([sortie]);
  let c = sortie;
  for (let pas = 0; pas < 4000; pas++) {
    const i = c % n, j = (c - i) / n;
    let amont = -1;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ii = i + di, jj = j + dj;
        if (ii < 1 || jj < 1 || ii >= n - 1 || jj >= n - 1) continue;
        const v = idx(ii, jj);
        if (rec[v] !== c || vus.has(v)) continue;
        if (amont < 0 || acc[v] > acc[amont]) amont = v;
      }
    }
    if (amont < 0 || acc[amont] < 45) break;    // au-delà, ce n'est plus qu'un ru
    chemin.push(amont);
    vus.add(amont);
    c = amont;
  }

  // De la source vers l'embouchure, en coordonnées du décor
  return chemin.reverse().map((k) => {
    const i = k % n, j = (k - i) / n;
    return { x: xAt(i), z: zAt(j) };
  });
}

/* Le tracé brut suit la plus grande pente, mais peut longer une croupe : on
   le fait glisser latéralement vers le point bas, puis on le relisse. C'est
   ce qui met vraiment la rivière au fond de sa vallée. */
function snapThalweg(pts, tours) {
  for (let it = 0; it < tours; it++) {
    for (let i = 2; i < pts.length - 3; i++) {
      const tx = pts[i + 1].x - pts[i - 1].x, tz = pts[i + 1].z - pts[i - 1].z;
      const tl = Math.hypot(tx, tz) || 1;
      const sx = -tz / tl, sz = tx / tl;
      const pas = 17;
      const hG = rawHeight(pts[i].x + sx * pas, pts[i].z + sz * pas);
      const hD = rawHeight(pts[i].x - sx * pas, pts[i].z - sz * pas);
      const sens = hG < hD ? 1 : -1;
      const delta = Math.min(5, Math.abs(hG - hD) * 0.6);
      pts[i].x += sx * sens * delta;
      pts[i].z += sz * sens * delta;
    }
    for (let i = 1; i < pts.length - 1; i++) {
      pts[i].x = (pts[i - 1].x + 2 * pts[i].x + pts[i + 1].x) / 4;
      pts[i].z = (pts[i - 1].z + 2 * pts[i].z + pts[i + 1].z) / 4;
    }
  }
  return pts;
}

function traceRiver(sx, sz, tx, tz) {
  const pts = [{ x: sx, z: sz }];
  let px = sx, pz = sz, dx = 0, dz = 0;
  for (let step = 0; step < 1200; step++) {
    const e = 5;
    const gx = rawHeight(px + e, pz) - rawHeight(px - e, pz);
    const gz = rawHeight(px, pz + e) - rawHeight(px, pz - e);
    let vx = -gx, vz = -gz;
    const gl = Math.hypot(vx, vz) || 1;
    vx /= gl; vz /= gl;
    const ax = tx - px, az = tz - pz;
    const al = Math.hypot(ax, az) || 1;
    const lx = ax / al, lz = az / al;
    const pull = (0.32 + 0.5 * (1 - Math.min(1, al / 320))) * (1 + step / 900);
    vx += lx * pull;
    vz += lz * pull;
    const vl = Math.hypot(vx, vz) || 1;
    dx = dx * 0.84 + (vx / vl) * 0.16;
    dz = dz * 0.84 + (vz / vl) * 0.16;
    let dl = Math.hypot(dx, dz) || 1;
    dx /= dl; dz /= dl;
    // Une cuvette peut piéger la descente : on garde toujours une composante
    // vers l'exutoire, sinon le cours d'eau tournerait en rond.
    const besoin = Math.max(0, 0.34 - (dx * lx + dz * lz));
    if (besoin > 0) {
      dx += lx * besoin * 2.2;
      dz += lz * besoin * 2.2;
      dl = Math.hypot(dx, dz) || 1;
      dx /= dl; dz /= dl;
    }
    px += dx * 3.2;
    pz += dz * 3.2;
    pts.push({ x: px, z: pz });
    if (al < LAKE.r * 0.7) break;
  }
  return pts;
}
function slopeAt(x, z) {
  return Math.abs(terrainHeight(x + 2.5, z) - terrainHeight(x - 2.5, z)) +
         Math.abs(terrainHeight(x, z + 2.5) - terrainHeight(x, z - 2.5));
}

/* ---------------------------------------------------------
   Démarrage
   --------------------------------------------------------- */
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const mount = resolveMount();

const brume = document.querySelector('#paysage3d-brume, [data-paysage3d-brume], .paysage3d-brume');

/* Les balises `defer` s'exécutent toutes avant `DOMContentLoaded` : attendre
   cet instant, c'est être sûr que chaque module s'est inscrit, quel que soit
   l'ordre des balises dans la page. Attention au test : pendant l'exécution
   d'un script `defer`, la page est déjà « interactive » — seul « complete »
   signifie que `DOMContentLoaded` est passé et qu'il faut démarrer soi-même.

   Mais `DOMContentLoaded` attend aussi les modules : un seul fichier lent
   retiendrait tout le décor derrière la brume. D'où le filet — passé ce
   délai, on démarre sans lui, et s'il finit par arriver il est greffé en
   fondu (voir `greffer`). Le décor n'attend donc jamais plus que ça. */
const ATTENTE_MODULES = 3000;    // ms

let demarre = false;

if (document.readyState === 'complete') {
  demarrer();
} else {
  document.addEventListener('DOMContentLoaded', demarrer, { once: true });
  setTimeout(demarrer, ATTENTE_MODULES);
}

function demarrer() {
  if (demarre) return;
  demarre = true;
  if (mount && hasWebGL()) {
    start();
  } else if (mount) {
    // Sans WebGL, on ne laisse surtout pas la brume en travers
    mount.classList.add('paysage3d--indisponible');
    leverLaBrume(0.8);
  }
}

/* La brume de chargement se dissipe quand la première image est prête. */
function leverLaBrume(duree) {
  if (!brume) return;
  const finir = () => {
    brume.style.visibility = 'hidden';
    brume.style.pointerEvents = 'none';
  };
  if (reduced) {
    brume.style.opacity = '0';
    finir();
    return;
  }
  // Confié au CSS : le fondu se joue même si la boucle de rendu est en pause
  // (onglet caché, section hors écran), donc la brume ne reste jamais en
  // travers du paysage.
  brume.addEventListener('transitionend', finir, { once: true });
  brume.style.transition = `opacity ${duree}s cubic-bezier(0.45, 0, 0.55, 1) 0.15s`;
  // Une lecture de géométrie force le navigateur à calculer les styles tout de
  // suite : la transition part donc bien de l'opacité actuelle. Sans cela, les
  // deux valeurs tomberaient dans le même calcul et rien ne s'animerait.
  void brume.offsetHeight;
  brume.style.opacity = '0';
  // Filet, si la transition ne se déclenche pas du tout (élément masqué, etc.)
  setTimeout(finir, (duree + 0.6) * 1000);
}

function resolveMount() {
  const found = document.querySelector('#paysage3d, [data-paysage3d], .paysage3d');
  if (found) return found;
  const layer = document.createElement('div');
  layer.id = 'paysage3d';
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, {
    position: 'fixed', inset: '0', zIndex: '-1', pointerEvents: 'none'
  });
  document.body.appendChild(layer);
  return layer;
}

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2')) ||
           !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch (e) { return false; }
}

function start() {
  const isCoarse = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 760;
  const SEG = isCoarse ? 132 : 246;
  const SIZE = 1050;

  /* ---------- Scène, caméra, rendu ---------- */
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(C.fog, 280, 700);

  const camera = new THREE.PerspectiveCamera(56, 1, 0.5, 2200);

  const renderer = new THREE.WebGLRenderer({ antialias: !isCoarse, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isCoarse ? 1.6 : 2));
  renderer.setSize(mount.clientWidth || window.innerWidth, mount.clientHeight || 600, false);
  renderer.domElement.setAttribute('aria-hidden', 'true');
  mount.appendChild(renderer.domElement);

  /* ---------- Ciel dégradé ---------- */
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1500, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color(C.skyTop) },
        bottom: { value: new THREE.Color(C.skyBottom) }
      },
      vertexShader: `
        varying float vH;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vH = normalize(wp.xyz).y;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 bottom; varying float vH;
        void main() {
          float k = smoothstep(-0.05, 0.55, vH);
          gl_FragColor = vec4(mix(bottom, top, k), 1.0);
        }`
    })
  );
  scene.add(sky);

  /* ---------- Lumières ---------- */
  const sunPos = new THREE.Vector3(430, 155, -660);
  scene.add(new THREE.HemisphereLight(0xe4f1f6, 0x8a9a55, 0.95));
  scene.add(new THREE.AmbientLight(0xfff1d8, 0.28));
  const sunLight = new THREE.DirectionalLight(0xfff2d2, 1.15);
  sunLight.position.copy(sunPos);
  scene.add(sunLight);
  const fillLight = new THREE.DirectionalLight(0xcfe4ef, 0.32);
  fillLight.position.set(-260, 140, 300);
  scene.add(fillLight);

  /* ---------- Route (tracé) ---------- */
  const roadPts = [
    [-176, -46], [-124, -164], [8, -198], [142, -142],
    [198, -8], [132, 132], [2, 188], [-132, 142]
  ].map(([x, z]) => new THREE.Vector3(x, 0, z));
  const roadCurve = new THREE.CatmullRomCurve3(roadPts, true, 'catmullrom', 0.5);
  const roadSamples = [];
  for (let i = 0; i < 260; i++) roadSamples.push(roadCurve.getPointAt(i / 260));
  const distToRoad = (x, z) => {
    let m = Infinity;
    for (let i = 0; i < roadSamples.length; i++) {
      const d = (roadSamples[i].x - x) ** 2 + (roadSamples[i].z - z) ** 2;
      if (d < m) m = d;
    }
    return Math.sqrt(m);
  };

  /* ---------- Étang ---------- */
  LAKE.base = rawHeight(LAKE.x, LAKE.z);
  LAKE.level = LAKE.base - 3.6;
  LAKE.ready = true;

  /* ---------- Rivière ---------- */
  // Tracé descendant depuis les hauteurs de l'est jusqu'à l'étang
  let riverRaw = traceDrainage(6, 470, LAKE.x, LAKE.z, LAKE.r * 1.15);
  if (riverRaw.length < 40) {
    // Repli : si le réseau ne donne pas de cours assez long, on revient au
    // tracé heuristique, recalé dans le fond de vallée.
    riverRaw = snapThalweg(traceRiver(352, -232, LAKE.x + LAKE.r * 0.35, LAKE.z - LAKE.r * 0.2), 14);
  } else {
    riverRaw = snapThalweg(riverRaw, 3);
  }
  {
    // On lisse le tracé brut, puis on le rééchantillonne régulièrement
    const keep = [];
    for (let i = 0; i < riverRaw.length; i += 7) keep.push(new THREE.Vector3(riverRaw[i].x, 0, riverRaw[i].z));
    const last = riverRaw[riverRaw.length - 1];
    keep.push(new THREE.Vector3(last.x, 0, last.z));
    const curve = new THREE.CatmullRomCurve3(keep, false, 'catmullrom', 0.5);
    const N = 420;
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1);
      RIVER.pts.push(curve.getPointAt(u));
    }
    // Le profil se calcule de l'aval vers l'amont : on part du niveau exact de
    // l'étang — pas de marche à l'arrivée — et on remonte doucement, sans
    // jamais dépasser le terrain. Vers l'aval, le fil de l'eau ne remonte donc
    // jamais : la rivière descend vraiment.
    const sol = RIVER.pts.map((p) => rawHeight(p.x, p.z) - 1.4);
    // Le fil de l'eau ne remonte jamais et ne dépasse jamais le terrain :
    // l'eau creuse, elle ne se perche pas.
    const surf = new Array(N);
    let courant = sol[0];
    for (let i = 0; i < N; i++) {
      courant = Math.min(courant, sol[i]);
      surf[i] = Math.max(courant, LAKE.level);
    }
    // Lissage : pas de marche d'escalier dans le plan d'eau
    for (let t = 0; t < 3; t++) {
      for (let i = 1; i < N - 1; i++) {
        surf[i] = Math.min(sol[i], (surf[i - 1] + 2 * surf[i] + surf[i + 1]) / 4);
      }
    }
    for (let i = N - 2; i >= 0; i--) surf[i] = Math.max(surf[i], surf[i + 1]);
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1);
      RIVER.surf.push(surf[i]);
      RIVER.bed.push(surf[i] - 1.4);
      // Un cours d'eau naît en filet et grossit en descendant : la largeur
      // part de presque rien et s'ouvre vers l'aval.
      const naissance = smoothstep(0, 0.14, u);
      RIVER.width.push((3 + 17 * u) * (0.28 + 0.72 * naissance));
    }
    RIVER.field = distanceField(RIVER.pts, 6, 130);
    RIVER.ready = true;
  }

  // Là où la route franchit la rivière, il faut un pont
  const bridges = findCrossings(roadCurve);

  // L'étang pousse un bras jusque sous le dernier tablier : la rivière s'arrête
  // dessous, le plan d'eau commence dessous, et le pont masque la couture.
  {
    const proche = bridges.reduce(
      (m, b) => (m && m.ri > b.ri ? m : b),
      null
    );
    if (proche) {
      const dx = proche.p.x - LAKE.x, dz = proche.p.z - LAKE.z;
      const d = Math.hypot(dx, dz);
      if (d < LAKE.r * 2.2) {
        BRAS.angle = Math.atan2(dz, dx);
        BRAS.portee = (d + 13) / 0.9;     // la nappe couvre 0,9 × le rayon
      }
    }
  }

  // Le relief est arrêté : on peut relever la ligne de rivage sur le terrain,
  // puis donner à chaque pont la longueur qu'exige l'eau qu'il franchit.
  calculerRivage();
  ajusterPonts(bridges, roadCurve);

  /* ---------- Terrain ---------- */
  scene.add(buildTerrain(SIZE, SEG));

  /* ---------- Eau vive ---------- */
  // La nappe s'arrête net où commence celle de l'étang — donc, grâce au bras,
  // sous le tablier. Les deux ne se recouvrent jamais : elles seraient à la
  // même altitude et se disputeraient les pixels.
  scene.add(buildRiverSurface(-1));

  /* ---------- Eau ---------- */
  const water = new THREE.Mesh(
    lakeGeometry(),   // rive irrégulière + bras jusqu'au pont
    new THREE.MeshStandardMaterial({ color: C.water, roughness: 0.12, metalness: 0.18, transparent: true, opacity: 0.95 })
  );
  water.position.set(LAKE.x, LAKE.level, LAKE.z);
  scene.add(water);

  /* ---------- Route (géométrie) ---------- */
  scene.add(buildRoad(roadCurve, bridges));
  bridges.forEach((b) => scene.add(buildBridge(b)));

  /* ---------- Village : maisons + chapelle ---------- */
  // On ne bâtit ni dans le lit de la rivière, ni les pieds dans l'eau
  const horsDeLEau = (x, z) => {
    const { d, i } = RIVER.field.sample(x, z);
    if (d < RIVER.width[i] * 0.62 + 7) return false;
    if (terrainHeight(x, z) < RIVER.surf[i] + 1.2 && d < RIVER.width[i] * 2) return false;
    const dLac = Math.hypot(x - LAKE.x, z - LAKE.z);
    if (dLac < lakeShore(Math.atan2(z - LAKE.z, x - LAKE.x)) + 8) return false;
    return terrainHeight(x, z) > LAKE.level + 1.5;
  };


  const buildings = [];   // { x, z, r } pour les ombres et l'anti-collision
  const village = new THREE.Group();

  const hamlets = [0.08, 0.34, 0.62, 0.86];
  hamlets.forEach((t0, hi) => {
    const count = hi === 1 ? 8 : hi === 0 ? 6 : 4;
    for (let i = 0; i < count; i++) {
      const t = (t0 + i * rnd(0.005, 0.011)) % 1;
      const p = roadCurve.getPointAt(t);
      const tan = roadCurve.getTangentAt(t);
      const side = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
      const dir = rand() > 0.5 ? 1 : -1;
      const off = (rand() < 0.72 ? rnd(10, 17) : rnd(22, 31)) * dir;
      const x = p.x + side.x * off, z = p.z + side.z * off;
      if (slopeAt(x, z) > 6.5) continue;
      if (!horsDeLEau(x, z)) continue;
      const house = makeHouse();
      house.position.set(x, terrainHeight(x, z) - 0.3, z);
      house.rotation.y = Math.atan2(-side.x * dir, -side.z * dir) + rnd(-0.18, 0.18);
      village.add(house);
      buildings.push({ x, z, r: 8.5 });
    }
    if (hi === 1) {
      // La chapelle cherche sa place le long de la route jusqu'à en trouver
      // une au sec : le village ne peut pas se passer de son clocher.
      for (let essai = 0; essai < 24; essai++) {
        const t = (t0 - 0.018 + essai * 0.011 + 1) % 1;
        const p = roadCurve.getPointAt(t);
        const tan = roadCurve.getTangentAt(t);
        const side = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
        const x = p.x + side.x * 21, z = p.z + side.z * 21;
        if (!horsDeLEau(x, z) || slopeAt(x, z) > 6.5) continue;
        const chapel = makeChapel();
        chapel.position.set(x, terrainHeight(x, z) - 0.3, z);
        chapel.rotation.y = Math.atan2(-side.x, -side.z);
        village.add(chapel);
        buildings.push({ x, z, r: 13, clocher: true });
        break;
      }
    }
  });
  scene.add(village);

  /* ---------- Trajectoire de vol ---------- */
  const TOUR_DE_PISTE = 212;      // secondes pour une boucle complète
  const camPts = [
    [-236, -128], [-72, -252], [136, -222], [262, -46],
    [186, 152], [16, 246], [-160, 202], [-268, 44]
  ].map(([x, z]) => new THREE.Vector3(x, 0, z));
  const flightPath = new THREE.CatmullRomCurve3(camPts, true, 'catmullrom', 0.5);


  const flight = { t: 0, altitude: 56, pitch: 0.30 };

  /* ---------- Greffe des modules ---------- */
  // Le décor de base est debout : relief, eau, route, village, trajectoire.
  // C'est le moment de laisser les modules ajouter le leur. Tout ce qu'ils
  // peuvent avoir besoin de connaître passe par ce seul objet.
  construireModules({
    THREE, graine,
    scene, camera, renderer, mount,
    reduced, isCoarse,
    C, clamp, smoothstep, fieldKind, hash2,
    terrainHeight, slopeAt, distToRoad, horsDeLEau,
    roadCurve, roadHeight: (t) => roadHeightAt(roadCurve, bridges, t),
    village, buildings,
    LAKE, RIVER, lakeShore,
    buildInstanced, sunPos,
    flightPath, flight
  });


  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  let roll = 0, scrollK = 0;

  const pTmp = new THREE.Vector3(), aTmp = new THREE.Vector3(), lookTmp = new THREE.Vector3();

  function placeCamera(dt, elapsed) {
    const t = ((flight.t % 1) + 1) % 1;
    const tAhead = (t + 0.012) % 1;
    flightPath.getPointAt(t, pTmp);
    flightPath.getPointAt(tAhead, aTmp);

    // On garde une marge au-dessus du relief, y compris des crêtes à venir
    let ground = terrainHeight(pTmp.x, pTmp.z);
    for (let k = 1; k <= 4; k++) {
      const q = flightPath.getPointAt((t + k * 0.006) % 1);
      ground = Math.max(ground, terrainHeight(q.x, q.z) - k * 1.5);
    }
    const bob = reduced ? 0 : Math.sin(elapsed * 0.55) * 1.6 + Math.sin(elapsed * 0.23) * 2.4;
    const alt = flight.altitude + scrollK * 30;
    camera.position.set(pTmp.x, ground + alt + bob, pTmp.z);

    // Assiette fixe : le regard plonge d'un angle constant vers l'avant,
    // ce qui laisse l'horizon et le ciel dans le haut du cadre.
    const fwd = aTmp.clone().sub(pTmp).setY(0).normalize();
    const reach = 150;
    const pitch = flight.pitch + scrollK * 0.12 + pointer.y * 0.05;
    lookTmp.set(
      camera.position.x + fwd.x * reach - fwd.z * pointer.x * 34,
      camera.position.y - Math.tan(pitch) * reach,
      camera.position.z + fwd.z * reach + fwd.x * pointer.x * 34
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(lookTmp);

    // Inclinaison dans les virages, comme un oiseau qui vire sur l'aile
    const d1 = flightPath.getTangentAt(t);
    const d2 = flightPath.getTangentAt((t + 0.02) % 1);
    const turn = d1.x * d2.z - d1.z * d2.x;
    const target = clamp(turn * 15, -0.17, 0.17);
    roll += (target - roll) * Math.min(1, dt * 1.4);
    camera.rotateZ(roll + (reduced ? 0 : Math.sin(elapsed * 0.31) * 0.012));
  }

  /* ---------- Décollage ---------- */
  if (!reduced) {
    // On part de haut, la focale large et le brouillard collé à l'objectif,
    // puis tout se pose en douceur sur le paysage.
    const fondu = faireFondu(0.15);
    fondu(flight, 'altitude', 190, 5.4);
    fondu(flight, 'pitch', 0.55, 5.4);
    entrer(camera, 'fov', 82, 4.6, 0.15, sortieCubique,
           () => camera.updateProjectionMatrix());
    entrer(scene.fog, 'near', 10, 4.2, 0.15, sortieQuad);
    entrer(scene.fog, 'far', 280, 4.2, 0.15, sortieQuad);

    // Les modules qui ont quelque chose à allumer pendant le décollage le
    // greffent sur la même séquence, avec la même fonction.
    for (const g of greffes) {
      if (!g.entree) continue;
      try { g.entree(fondu); }
      catch (e) { console.error(`paysage3d : entrée du module « ${g.nom} »`, e); }
    }
  } else {
    flight.t = 0.06;
  }

  /* ---------- Interactions douces ---------- */
  if (!reduced && !isCoarse) {
    window.addEventListener('pointermove', (e) => {
      pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
    }, { passive: true });
  }
  const heroEl = mount.closest('[data-paysage3d-zone], .hero, header, section') || mount;
  const onScroll = () => {
    const h = heroEl.offsetHeight || window.innerHeight;
    scrollK = clamp(window.scrollY / h, 0, 1);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- Dimensionnement ---------- */
  function resize() {
    const w = mount.clientWidth || window.innerWidth;
    const h = mount.clientHeight || Math.round(window.innerHeight * 0.8);
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  }
  resize();
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(mount);
  else window.addEventListener('resize', resize);

  /* ---------- Boucle ---------- */
  const clock = new THREE.Clock();
  let elapsed = 0;
  let visible = true, onScreen = true, raf = 0;

  function setRunning(run) {
    // Rien à mettre en pause : tout avance au `dt` de la boucle, donc tout
    // s'arrête avec elle. `getDelta()` remet le compteur à zéro pour que la
    // reprise ne rattrape pas le temps passé en sommeil d'un seul bond.
    if (run && !raf) { clock.getDelta(); raf = requestAnimationFrame(tick); }
    if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
  }
  document.addEventListener('visibilitychange', () => {
    visible = !document.hidden;
    setRunning(visible && onScreen && !reduced);
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      onScreen = entries[0].isIntersecting;
      setRunning(visible && onScreen && !reduced);
    }, { threshold: 0 }).observe(heroEl);
  }

  function tick() {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.06);
    elapsed += dt;

    pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 2);
    pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 2);

    // L'horloge du vol : un tour complet de la boucle en 212 secondes.
    if (!reduced) flight.t = (flight.t + dt / TOUR_DE_PISTE) % 1;
    avancerEntrees(dt);

    placeCamera(dt, elapsed);
    sky.position.set(camera.position.x, 0, camera.position.z);

    // Chaque module greffé anime ce qui lui appartient
    animerModules(dt, elapsed);

    water.material.opacity = 0.9 + Math.sin(elapsed * 0.8) * 0.04;

    renderer.render(scene, camera);
  }

  // Première image immédiate (utile aussi en « mouvement réduit »)
  placeCamera(0.016, 0);
  animerModules(0.016, 0);
  renderer.render(scene, camera);
  // Petite poignée pour régler le décor depuis la console :
  // paysage3d.flight.altitude = 80, paysage3d.flight.t = 0.4, etc.
  // (on complète l'objet du registre, on ne le remplace pas : les modules
  // s'y sont inscrits.)
  Object.assign(paysage3d, {
    scene, camera, renderer, flight, flightPath, terrainHeight,
    roadCurve, roadHeight: (t) => roadHeightAt(roadCurve, bridges, t),
    RIVER, LAKE, bridges, buildings, traceDrainage
  });
  document.documentElement.classList.add('paysage3d-actif');
  mount.classList.add('paysage3d--pret');
  // Le décor est là : la brume se lève sur le paysage, en même temps que la
  // caméra descend vers lui.
  leverLaBrume(2.4);
  if (!reduced) setRunning(true);
}

/* ---------------------------------------------------------
   Fabriques de géométries
   --------------------------------------------------------- */
function buildTerrain(SIZE, SEG) {
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG).toNonIndexed();
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;

  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
  }

  const colors = new Float32Array(pos.count * 3);
  const col = new THREE.Color();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), nrm = new THREE.Vector3();

  for (let f = 0; f < pos.count; f += 3) {
    a.fromBufferAttribute(pos, f);
    b.fromBufferAttribute(pos, f + 1);
    c.fromBufferAttribute(pos, f + 2);
    ab.subVectors(b, a); ac.subVectors(c, a);
    nrm.crossVectors(ab, ac).normalize();
    const flat = Math.abs(nrm.y);

    const cx = (a.x + b.x + c.x) / 3;
    const cz = (a.z + b.z + c.z) / 3;
    const cy = (a.y + b.y + c.y) / 3;

    const { k: kind, rx, cj, bord } = fieldKind(cx, cz);
    const grain = fbm(cx * 0.02 - 5, cz * 0.02 + 9, 2);
    const veine = fbm(cx * 0.075 + 12, cz * 0.075 - 3, 2);

    // Grève : seulement autour de l'étang. Le long de la rivière, l'herbe
    // descend jusqu'à l'eau — un liseré clair donnerait l'impression que le
    // cours d'eau est posé en surélévation.
    const dLac = Math.hypot(cx - LAKE.x, cz - LAKE.z);
    const greveLac = dLac < lakeShore(Math.atan2(cz - LAKE.z, cx - LAKE.x)) * 1.14 &&
                     cy < LAKE.level + 1;

    if (greveLac) {
      // La grève se fond dans l'herbe : pas de découpe franche au bord de l'eau
      col.setHex(C.sand).lerp(new THREE.Color(C.grassMid), clamp(grain * 0.55, 0, 0.45));
    } else if (flat < 0.78) {
      col.setHex(grain > 0.5 ? C.grassDark : C.grassDeep);   // versants boisés
    } else if (kind > 0.86) {
      // Sillons : une ondulation lente entre deux ors, pas un damier
      const sillon = 0.5 + 0.5 * Math.sin(rx * 0.13 + cj * 2.3);
      col.setHex(C.fieldGold).lerp(new THREE.Color(C.fieldWheat), sillon);
    } else if (kind > 0.74) {
      col.setHex(C.fieldOchre);                              // chaumes
    } else if (kind > 0.6) {
      col.setHex(C.fieldGold);
    } else if (kind > 0.42) {
      col.setHex(C.grassLight);
    } else if (kind > 0.2) {
      col.setHex(C.grassMid);
    } else {
      col.setHex(C.grassDeep);
    }
    // Du relief dans la parcelle : grandes ondulations, veines fines,
    // et une lisière plus sombre le long des limites — l'ombre des haies.
    col.multiplyScalar(0.955 + grain * 0.1 + veine * 0.05);
    if (bord < 3.2) col.multiplyScalar(0.88 + 0.12 * (bord / 3.2));

    const j = 0.93 + hash2(Math.round(cx), Math.round(cz)) * 0.14;
    col.multiplyScalar(j);
    for (let k = 0; k < 3; k++) {
      colors[(f + k) * 3] = col.r;
      colors[(f + k) * 3 + 1] = col.g;
      colors[(f + k) * 3 + 2] = col.b;
    }
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 1, metalness: 0
  }));
}

/* Nappe de la rivière : un ruban à quatre lés — deux rives claires, un
   chenal plus sombre — posé un peu au-dessus du lit creusé. */
function buildRiverSurface(coupe) {
  const positions = [], colors = [];
  const clair = new THREE.Color(C.river), sombre = new THREE.Color(C.riverDeep);
  const rows = [];

  // La nappe s'arrête net à la rive de l'étang. Si elle empiétait sur le
  // disque du plan d'eau, les deux surfaces se disputeraient les mêmes pixels
  // à la même altitude — d'où le scintillement à l'embouchure.
  let N = RIVER.pts.length;
  for (let i = 0; i < RIVER.pts.length; i++) {
    const dx = RIVER.pts[i].x - LAKE.x, dz = RIVER.pts[i].z - LAKE.z;
    if (Math.hypot(dx, dz) <= lakeShore(Math.atan2(dz, dx))) { N = i + 1; break; }
  }
  if (coupe > 0) N = Math.min(N, coupe);

  for (let i = 0; i < N; i++) {
    const p = RIVER.pts[i];
    const q = RIVER.pts[Math.min(i + 1, RIVER.pts.length - 1)];
    const r = RIVER.pts[Math.max(i - 1, 0)];
    const tx = q.x - r.x, tz = q.z - r.z;
    const tl = Math.hypot(tx, tz) || 1;
    const sx = -tz / tl, sz = tx / tl;
    const w = RIVER.width[i] * 0.4;
    const y = RIVER.surf[i];
    rows.push([
      { x: p.x + sx * w, y, z: p.z + sz * w },
      { x: p.x + sx * w * 0.45, y, z: p.z + sz * w * 0.45 },
      { x: p.x - sx * w * 0.45, y, z: p.z - sz * w * 0.45 },
      { x: p.x - sx * w, y, z: p.z - sz * w }
    ]);
  }

  const tri = (a, b, c, col) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let k = 0; k < 3; k++) colors.push(col.r, col.g, col.b);
  };
  const bande = (i, j, col) => {
    const A = rows[i], B = rows[i + 1];
    tri(A[j], A[j + 1], B[j + 1], col);
    tri(A[j], B[j + 1], B[j], col);
  };
  for (let i = 0; i < N - 1; i++) {
    bande(i, 0, clair);
    bande(i, 1, sombre);
    bande(i, 2, clair);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    // Surtout pas de spéculaire marqué : au soleil, la nappe virerait au blanc
    vertexColors: true, roughness: 0.72, metalness: 0,
    transparent: true, opacity: 0.94, side: THREE.DoubleSide
  }));
}

/* Où la route franchit-elle la rivière ? Il peut y avoir plusieurs gués. */
function findCrossings(roadCurve) {
  const N = 900;
  const ech = [];
  for (let i = 0; i < N; i++) {
    const t = i / N;
    const p = roadCurve.getPointAt(t);
    const { d, i: ri } = RIVER.field.sample(p.x, p.z);
    ech.push({ t, d, ri, p });
  }
  const len = roadCurve.getLength();
  const out = [];
  for (let i = 0; i < N; i++) {
    const a = ech[(i - 1 + N) % N], b = ech[i], c = ech[(i + 1) % N];
    if (b.d > RIVER.width[b.ri] * 1.2) continue;      // trop loin du lit
    if (b.d > a.d || b.d > c.d) continue;             // minimum local seulement
    if (out.some((o) => Math.abs(o.t - b.t) < 0.05)) continue;

    const span = RIVER.width[b.ri] * 0.75 + 11;   // provisoire : ajusterPonts affinera
    const half = span / len;
    const approach = half * 2.3;
    const p1 = roadCurve.getPointAt((b.t - approach + 1) % 1);
    const p2 = roadCurve.getPointAt((b.t + approach) % 1);
    out.push({
      t: b.t, approach, span, demi: span, p: b.p, ri: b.ri,
      y: Math.max(
        terrainHeight(p1.x, p1.z),
        terrainHeight(p2.x, p2.z),
        RIVER.surf[b.ri] + 2.4
      ) + 0.55,
      tan: roadCurve.getTangentAt(b.t)
    });
  }
  return out;
}

/* Le tablier doit couvrir toute l'eau franchie, sinon la chaussée se retrouve
   posée dessus. On mesure donc l'étendue mouillée de part et d'autre, une fois
   la ligne de rivage connue. */
function ajusterPonts(bridges, roadCurve) {
  const len = roadCurve.getLength();
  const surEau = (p) => {
    const dLac = Math.hypot(p.x - LAKE.x, p.z - LAKE.z);
    if (dLac < lakeShore(Math.atan2(p.z - LAKE.z, p.x - LAKE.x)) + 1.5) return true;
    const { d, i } = RIVER.field.sample(p.x, p.z);
    return d < RIVER.width[i] * 0.45 + 2;
  };

  for (const b of bridges) {
    const pas = 1.2 / len;
    let avant = 0, arriere = 0;
    for (let k = 1; k < 160; k++) {
      if (!surEau(roadCurve.getPointAt((b.t + k * pas) % 1))) break;
      avant = k * pas * len;
    }
    for (let k = 1; k < 160; k++) {
      if (!surEau(roadCurve.getPointAt((b.t - k * pas + 1) % 1))) break;
      arriere = k * pas * len;
    }
    // Tablier centré sur le franchissement, avec une culée sur chaque rive
    const centre = (avant - arriere) / 2;
    b.t = (b.t + centre / len + 1) % 1;
    b.demi = (avant + arriere) / 2 + 6;
    b.approach = (b.demi * 1.5) / len;
    b.p = roadCurve.getPointAt(b.t);
    b.tan = roadCurve.getTangentAt(b.t);
    const p1 = roadCurve.getPointAt((b.t - b.approach + 1) % 1);
    const p2 = roadCurve.getPointAt((b.t + b.approach) % 1);
    b.y = Math.max(
      terrainHeight(p1.x, p1.z),
      terrainHeight(p2.x, p2.z),
      RIVER.surf[b.ri] + 2.4,
      LAKE.level + 2.6
    ) + 0.55;
  }
}

/* Un petit pont de pierre et de bois, posé en travers du courant */
function buildBridge(b) {
  const g = new THREE.Group();
  const yaw = Math.atan2(b.tan.x, b.tan.z);
  g.position.set(b.p.x, 0, b.p.z);
  g.rotation.y = yaw;

  const bois = new THREE.MeshStandardMaterial({ color: C.plank, roughness: 1, flatShading: true });
  const pierre = new THREE.MeshStandardMaterial({ color: 0xd7c8ab, roughness: 1, flatShading: true });

  const long = (b.demi - 2.5) * 2;
  const tablier = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.7, long), bois);
  tablier.position.y = b.y - 0.42;   // la chaussée le recouvre, il ne perce pas
  g.add(tablier);

  // Parapets ajourés
  for (const c of [-1, 1]) {
    const main = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, long), bois);
    main.position.set(c * 4.3, b.y + 1.05, 0);
    g.add(main);
    const n = Math.max(3, Math.round(long / 4.5));
    for (let i = 0; i <= n; i++) {
      const poteau = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.2, 0.28), bois);
      poteau.position.set(c * 4.3, b.y + 0.5, -long / 2 + (i * long) / n);
      g.add(poteau);
    }
  }

  // Culées
  for (const c of [-1, 1]) {
    const culee = new THREE.Mesh(new THREE.BoxGeometry(9.6, 5, 3), pierre);
    culee.position.set(0, b.y - 3, c * (long / 2 - 1));
    g.add(culee);
  }

  return g;
}

/* Nappe d'eau épousant la rive dessinée dans le relief */
function lakeGeometry() {
  const N = 160;
  const pts = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const R = lakeShore(a);
    pts.push(Math.cos(a) * R, 0, Math.sin(a) * R);
  }
  const positions = [];
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    positions.push(0, 0, 0, pts[j * 3], 0, pts[j * 3 + 2], pts[i * 3], 0, pts[i * 3 + 2]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

const ROUTE_DEMI = 3.5, ROUTE_ACCOTEMENT = 5.6;

/* L'altitude de la chaussée à l'abscisse `t`.

   Elle sort de la géométrie de la route, mais elle ne lui appartient pas :
   tout ce qui se pose sur la route — un attelage, une borne — a besoin de la
   connaître, et la recalculer de son côté serait s'exposer à passer sous le
   tablier d'un pont. Elle est donc écrite une fois ici, et le socle la passe
   aux modules. */
function roadHeightAt(curve, bridges, t) {
  // La route est une boucle : on accepte un `t` qui déborde, et on le ramène.
  // Sans cela un appelant qui regarde un peu devant ou un peu derrière — pour
  // lire une pente, pour placer une remorque — sort de la courbe au passage
  // du point zéro, et `getPointAt` ne renvoie plus rien.
  t = ((t % 1) + 1) % 1;
  const p = curve.getPointAt(t);
  const tan = curve.getTangentAt(t);
  const side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), tan).normalize();
  // La chaussée s'appuie sur le point le plus haut de son emprise : elle
  // remblaie, elle ne suit pas chaque bosse.
  let y = -Infinity;
  for (const o of [-ROUTE_ACCOTEMENT, -ROUTE_DEMI, 0, ROUTE_DEMI, ROUTE_ACCOTEMENT]) {
    y = Math.max(y, terrainHeight(p.x + side.x * o, p.z + side.z * o));
  }
  y += 0.55;
  for (const b of bridges) {
    // Parfaitement plate au-dessus du tablier, puis rampe douce vers le sol
    const dt = Math.min(Math.abs(t - b.t), 1 - Math.abs(t - b.t));
    if (dt < b.approach) {
      const plat = (b.demi - 2) / curve.getLength();
      const k = dt <= plat ? 1 : smoothstep(b.approach, plat, dt);
      y = y * (1 - k) + b.y * k;
    }
  }
  return y;
}

function buildRoad(curve, bridges) {
  const STEPS = 420, HALF = ROUTE_DEMI, VERGE = ROUTE_ACCOTEMENT;
  const up = new THREE.Vector3(0, 1, 0);
  const L = [], R = [], LV = [], RV = [];

  for (let i = 0; i <= STEPS; i++) {
    const t = (i / STEPS) % 1;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    const side = new THREE.Vector3().crossVectors(up, tan).normalize();
    const y = roadHeightAt(curve, bridges, t);
    L.push(new THREE.Vector3(p.x + side.x * HALF, y, p.z + side.z * HALF));
    R.push(new THREE.Vector3(p.x - side.x * HALF, y, p.z - side.z * HALF));
    LV.push(new THREE.Vector3(p.x + side.x * VERGE, y - 0.3, p.z + side.z * VERGE));
    RV.push(new THREE.Vector3(p.x - side.x * VERGE, y - 0.3, p.z - side.z * VERGE));
  }

  const positions = [], colors = [];
  const cRoad = new THREE.Color(C.road), cVerge = new THREE.Color(C.verge);

  const tri = (p1, p2, p3, color) => {
    positions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z);
    for (let k = 0; k < 3; k++) colors.push(color.r, color.g, color.b);
  };
  const quad = (p1, p2, p3, p4, color) => { tri(p1, p2, p3, color); tri(p1, p3, p4, color); };

  const tint = new THREE.Color();
  for (let i = 0; i < STEPS; i++) {
    tint.copy(cRoad).multiplyScalar(0.96 + hash2(i, 3) * 0.09);
    quad(L[i], R[i], R[i + 1], L[i + 1], tint);
    tint.copy(cVerge).multiplyScalar(0.94 + hash2(i, 7) * 0.12);
    quad(LV[i], L[i], L[i + 1], LV[i + 1], tint);
    quad(R[i], RV[i], RV[i + 1], R[i + 1], tint);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 1, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
  }));
}

function buildInstanced(geo, mat, list, place, colorOf) {
  const dummy = new THREE.Object3D();
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(list.length, 1));
  const col = new THREE.Color();
  list.forEach((o, i) => {
    place(o, dummy);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    if (colorOf) mesh.setColorAt(i, col.setHex(colorOf(o)));
  });
  mesh.count = list.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

/* Toit à deux pentes : faîtage le long de X, façades en ±Z */
function gableRoof(w, d, h, ov, color) {
  const shape = new THREE.Shape();
  shape.moveTo(-(d / 2 + ov), 0);
  shape.lineTo(d / 2 + ov, 0);
  shape.lineTo(0, h);
  shape.lineTo(-(d / 2 + ov), 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: w + ov * 2, bevelEnabled: false });
  geo.translate(0, 0, -(w / 2 + ov));
  geo.rotateY(-Math.PI / 2);
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true }));
}

function makeHouse() {
  const g = new THREE.Group();
  const w = rnd(6.5, 9.5), d = rnd(5, 7), wallH = rnd(4, 5.4);
  const roofH = rnd(3.4, 4.8);
  const roofColor = pick(C.roofs);
  const wallColor = rand() < 0.5 ? C.wall : C.wall2;

  const walls = new THREE.Mesh(
    new THREE.BoxGeometry(w, wallH, d),
    new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.95, flatShading: true })
  );
  walls.position.y = wallH / 2;
  g.add(walls);

  const roof = gableRoof(w, d, roofH, 0.55, roofColor);
  roof.position.y = wallH;
  g.add(roof);

  const chimney = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 2.6, 0.9),
    new THREE.MeshStandardMaterial({ color: 0xd9c6a6, roughness: 1, flatShading: true })
  );
  chimney.position.set(w * 0.28, wallH + roofH * 0.62, rnd(-0.8, 0.8));
  // Nommée pour que le module « fumée » puisse la retrouver : c'est la seule
  // façon de la situer sans supposer la forme interne de la maison.
  chimney.name = 'cheminee';
  g.add(chimney);

  // Façade : porte + fenêtres éclairées
  const doorMat = new THREE.MeshStandardMaterial({ color: pick(C.doors), roughness: 0.8 });
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 0.16), doorMat);
  door.position.set(0, 1.1, d / 2 + 0.02);
  g.add(door);

  const winMat = new THREE.MeshStandardMaterial({
    color: C.window, roughness: 0.5, emissive: new THREE.Color(0xffcf7a), emissiveIntensity: 0.35
  });
  const winGeo = new THREE.BoxGeometry(1.1, 1.2, 0.14);
  [-1, 1].forEach((s) => {
    const win = new THREE.Mesh(winGeo, winMat);
    win.position.set(s * w * 0.28, wallH * 0.58, d / 2 + 0.02);
    g.add(win);
    const back = new THREE.Mesh(winGeo, winMat);
    back.position.set(s * w * 0.26, wallH * 0.58, -d / 2 - 0.02);
    g.add(back);
  });

  // Appentis ou remise, une fois sur trois
  if (rand() < 0.34) {
    const sw = rnd(2.6, 3.6), sh = rnd(2.4, 3.2), sd = rnd(2.6, 3.8);
    const shed = new THREE.Mesh(
      new THREE.BoxGeometry(sw, sh, sd),
      new THREE.MeshStandardMaterial({ color: C.wood, roughness: 1, flatShading: true })
    );
    const sx = (w / 2 + sw / 2 - 0.2) * (rand() < 0.5 ? 1 : -1);
    shed.position.set(sx, sh / 2, rnd(-1, 1));
    g.add(shed);
    const shedRoof = gableRoof(sw, sd, 1.3, 0.3, pick(C.roofs));
    shedRoof.position.set(sx, sh, shed.position.z);
    g.add(shedRoof);
  }

  return g;
}


function makeChapel() {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0xf2e7d1, roughness: 1, flatShading: true });

  const nave = new THREE.Mesh(new THREE.BoxGeometry(13, 6.2, 7), stone);
  nave.position.y = 3.1;
  g.add(nave);
  const roof = gableRoof(13, 7, 3.8, 0.6, C.roofs[3]);
  roof.position.y = 6.2;
  g.add(roof);

  const tower = new THREE.Mesh(new THREE.BoxGeometry(4.2, 13, 4.2), stone);
  tower.position.set(-7.6, 6.5, 0);
  g.add(tower);

  const spire = new THREE.Mesh(
    new THREE.ConeGeometry(3.2, 6.4, 4),
    new THREE.MeshStandardMaterial({ color: C.roofs[3], roughness: 0.9, flatShading: true })
  );
  spire.rotation.y = Math.PI / 4;
  spire.position.set(-7.6, 16.2, 0);
  g.add(spire);

  const goldMat = new THREE.MeshStandardMaterial({ color: 0xdfa53a, roughness: 0.4, metalness: 0.4 });
  const cross1 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2, 0.22), goldMat);
  cross1.position.set(-7.6, 20.2, 0);
  const cross2 = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.22, 0.22), goldMat);
  cross2.position.set(-7.6, 20.5, 0);
  g.add(cross1, cross2);

  const clock = new THREE.Mesh(new THREE.CircleGeometry(1.1, 20), goldMat);
  clock.position.set(-7.6, 10.5, 2.15);
  g.add(clock);

  const winMat = new THREE.MeshStandardMaterial({
    color: 0xffd98a, roughness: 0.5, emissive: new THREE.Color(0xffbe63), emissiveIntensity: 0.4
  });
  for (let i = -1; i <= 1; i++) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.2, 0.16), winMat);
    win.position.set(i * 3.6 + 1.5, 3.4, 3.52);
    g.add(win);
  }

  return g;
}


})();
