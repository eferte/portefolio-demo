/* =========================================================
   Oiseaux du parcours

   Un moment après qu'on est arrivé sur « Parcours », quelques
   oiseaux traversent la rubrique sous le texte, puis s'en vont
   et ne reviennent pas. Ce sont ceux du décor du haut : même
   silhouette, même battement, et vus de la même façon —
   d'au-dessus, puisque c'est de là qu'on les regardait.

   Reprendre la silhouette ne coûte presque rien : les ailes du
   module « oiseaux » sont des polygones plats, dessinés dans le
   plan XZ. Ce sont donc déjà des tracés à deux dimensions, qu'on
   recopie tels quels. Seule la convention change — là-bas X est
   l'envergure et Z l'avant ; ici l'oiseau vole vers la droite,
   donc X_svg = Z et Y_svg = X.

   Le battement, lui, ne se dessine pas : vu de haut, une aile qui
   se lève ne change pas de forme, elle se raccourcit. Un facteur
   d'échelle sur l'envergure suffit — cos(angle) — et c'est
   exactement ce que fait la projection.

   Facultatif : sans ce fichier, la rubrique est simplement sans
   oiseaux. Rien d'autre n'en dépend.
   ========================================================= */
(function () {
  'use strict';

  const section = document.getElementById('parcours');
  if (!section) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const SVG = 'http://www.w3.org/2000/svg';
  const PLUMES = ['#b3aca1', '#a8937b', '#c2b6a4'];   // C.birds, à l'identique

  // Le temps qu'on laisse à la rubrique avant de la traverser : assez pour
  // qu'on ait commencé à lire, trop peu pour qu'on soit déjà reparti.
  const ATTENTE = 4;

  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (t) => t[(Math.random() * t.length) | 0];

  /* ---------- La silhouette ----------
     Les coordonnées viennent de paysage3d.oiseaux.js, dans l'ordre où elles
     y sont écrites. On les convertit une fois pour toutes. */
  const trace = (pts) => 'M' + pts.map(([x, z]) => `${z} ${x}`).join('L') + 'Z';

  const D_BRAS = trace([[0, 0.43], [0.92, 0.32], [0.92, -0.42], [0, -0.49]]);
  const D_MAIN = trace([
    [-0.06, 0.33], [0.60, 0.17], [1.14, -0.12], [0.82, -0.33], [0.52, -0.49], [-0.06, -0.44]
  ]);
  const D_QUEUE = trace([
    [0.13, 0.06], [0.27, -0.52], [0.15, -0.88], [0, -0.70],
    [-0.15, -0.88], [-0.27, -0.52], [-0.13, 0.06]
  ].map(([x, z]) => [x, z - 0.86]));

  // Le corps est un tour : un profil (rayon, avant) que l'on fait tourner.
  // Vu de haut, ce tour n'est rien d'autre que le profil et son miroir.
  const D_CORPS = (() => {
    const profil = [
      [0.02, -0.95], [0.09, -0.7], [0.15, -0.35], [0.175, 0],
      [0.165, 0.35], [0.13, 0.66], [0.075, 0.87], [0, 0.97]
    ];
    const aller = profil.map(([r, z]) => [r, z]);
    const retour = profil.slice().reverse().map(([r, z]) => [-r, z]);
    return trace(aller.concat(retour));
  })();

  function creerOiseau(couleur) {
    const g = document.createElementNS(SVG, 'g');

    const forme = (d) => {
      const p = document.createElementNS(SVG, 'path');
      p.setAttribute('d', d);
      p.setAttribute('fill', couleur);
      return p;
    };

    // Le corps d'abord, les ailes par-dessus : au plus fort du battement,
    // l'emplanture doit couvrir l'épaule, sinon un filet de fond passe.
    g.appendChild(forme(D_QUEUE));
    g.appendChild(forme(D_CORPS));

    const tete = document.createElementNS(SVG, 'ellipse');
    tete.setAttribute('cx', '0.94'); tete.setAttribute('cy', '0');
    tete.setAttribute('rx', '0.15'); tete.setAttribute('ry', '0.13');
    tete.setAttribute('fill', couleur);
    g.appendChild(tete);

    // Une aile par côté. L'aile gauche est le miroir de la droite : on le
    // fait avec un `scale(1,-1)`, qui retourne aussi le sens des rotations —
    // c'est justement ce qu'on veut, les deux ailes montent ensemble.
    const ailes = [];
    for (const c of [1, -1]) {
      const cote = document.createElementNS(SVG, 'g');
      cote.setAttribute('transform', `translate(0.12 0) scale(1 ${c})`);

      const bras = document.createElementNS(SVG, 'g');
      const main = document.createElementNS(SVG, 'g');
      main.appendChild(forme(D_MAIN));
      bras.appendChild(forme(D_BRAS));
      bras.appendChild(main);
      cote.appendChild(bras);
      g.appendChild(cote);
      ailes.push({ bras, main });
    }

    return { g, ailes };
  }

  /* ---------- Le vol ----------
     Là-haut, un oiseau alterne un virage et un long trait droit : il traverse
     des centaines de mètres, et la ligne droite s'y perd. Ici la traversée
     dure une dizaine de secondes — le trait droit occuperait tout, et l'on
     verrait passer des flèches.

     Le cap s'infléchit donc en continu, par deux ondes lentes de périodes
     sans rapport : jamais de ligne droite, jamais deux fois la même courbe.
     Et un rappel très doux vers le cap d'entrée l'empêche de tourner en rond
     — un oiseau qui traverse va quelque part. */
  /* Les deux ondes sont lentes, et c'est le point : un oiseau en croisière
     décrit de longues courbes, pas des lacets.

     On les règle par l'écart de cap, non par la vitesse de virage : c'est
     l'écart qui se voit. Le premier nombre est l'angle dont le cap s'éloigne
     au plus fort de l'onde lente — la vitesse de virage s'en déduit, et une
     onde lente demande d'autant moins de vitesse pour le même écart.

     Une volée vole bien plus droit qu'un solitaire, et pour une raison : une
     formation ne peut pas se permettre de virer, chaque virage coûte à ceux
     de l'extérieur. C'est aussi ce qui se voit — cinq oiseaux qui balancent
     ensemble rendent lisible un S qu'un oiseau seul ferait passer. */
  function nouvelleOnde(ecart1, ecart2) {
    const sens = () => (Math.random() < 0.5 ? 1 : -1);
    const f1 = rnd(0.05, 0.09), f2 = rnd(0.12, 0.20);
    return {
      a1: sens() * rnd(ecart1[0], ecart1[1]) * 2 * Math.PI * f1, f1, p1: Math.random() * 7,
      a2: sens() * rnd(ecart2[0], ecart2[1]) * 2 * Math.PI * f2, f2, p2: Math.random() * 7
    };
  }

  /* Un solitaire s'écarte de 15 à 35 degrés de son cap ; une volée, de 4 à 9.

     Mais une volée qui n'aurait que sa dérive plate entrerait tout droit, et
     ce n'est pas ainsi qu'une formation arrive : elle vient sur un cap, prend
     son virage d'un coup, et file ensuite. On lui donne donc un virage
     d'entrée — un seul, engagé puis dégagé, de 20 à 37 degrés — après quoi il
     ne reste que la longue courbe. C'est le virage du module du décor, celui
     que j'avais retiré : il avait sa raison d'être, au début seulement. */
  const SOLITAIRE = { ecart1: [0.26, 0.60], ecart2: [0.04, 0.09], virage: null };
  const VOLEE = { ecart1: [0.07, 0.15], ecart2: [0.012, 0.030], virage: [0.35, 0.65] };

  // Écart d'angle ramené dans [-π, π]
  function ecart(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  // Un oiseau ne rame pas sans arrêt : il donne quelques coups d'aile, puis
  // se laisse porter, ailes tendues. C'est cette alternance qui fait la
  // différence entre un vol et un battement de métronome.
  function nouveauSouffle(b) {
    b.salve = rnd(1.6, 3.2);
    b.plane = rnd(2.4, 5.5);
    b.souffle = 0;
  }

  function creerVol(largeur, echelle, cap0, y0, allure) {
    const versLaDroite = Math.cos(cap0) > 0;
    const o = {
      x: versLaDroite ? -90 : largeur + 90,
      y: y0,
      cap: cap0,
      capBase: cap0,
      onde: nouvelleOnde(allure.ecart1, allure.ecart2),
      virage: allure.virage && {
        angle: (Math.random() < 0.5 ? 1 : -1) * rnd(allure.virage[0], allure.virage[1]),
        debut: rnd(0.6, 2),        // le temps d'être bien dans le champ
        duree: rnd(2.5, 4.5)
      },
      v: rnd(62, 96) * (echelle / 11),
      incl: 0,
      cadence: rnd(1.3, 1.8),
      elapsed: 0,
      echelle
    };
    vols.push(o);
    return o;
  }

  /* ---------- La scène ---------- */
  let couche = null, oiseaux = [], vols = [], raf = 0, horloge = 0, minuteur = null;
  let largeur = 0, hauteur = 0, hauteurTexte = 0, restants = 0;
  let enVue = false, ongletVisible = true, parti = false;

  /* La couche déborde la rubrique.

     La rubrique est une colonne centrée, plus étroite que la fenêtre : s'y
     tenir, c'est faire apparaître et disparaître les oiseaux au ras des
     marges, en plein vol. Elle déborde donc jusqu'aux deux bords de la
     fenêtre, et un peu en haut et en bas — un oiseau qui sort par le haut
     s'efface au-delà du texte, il n'est pas tranché à la lisière.

     Rien de tout cela ne touche à la mise en page : la couche est en position
     absolue, elle ne pousse rien et ne prend aucune place. Et la largeur est
     lue sur `clientWidth`, qui exclut la barre de défilement — `100vw` la
     compterait, et la page gagnerait un défilement horizontal.

     Les mesures sont refaites à chaque redimensionnement. */
  const MARGE = 100;   // le débord en haut et en bas

  function mesurer() {
    const r = section.getBoundingClientRect();
    const page = document.documentElement.clientWidth;
    largeur = page;
    hauteurTexte = r.height;
    hauteur = r.height + MARGE * 2;
    if (!couche) return;
    // `r.left` est le décalage de la colonne depuis le bord de la fenêtre :
    // le remonter d'autant ramène la couche à ce bord.
    couche.style.left = -r.left + 'px';
    couche.style.top = -MARGE + 'px';
    couche.style.width = page + 'px';
    couche.style.height = hauteur + 'px';
    couche.setAttribute('viewBox', `0 0 ${largeur} ${hauteur}`);
  }

  /* La déformation du V.

     Un oiseau en formation ne pilote pas : il tient la même vitesse et le
     même cap que son voisin. Lui donner sa propre poursuite, c'est lui donner
     la gigotte — cinq oiseaux qui se cherchent au lieu d'une volée.

     L'irrégularité se joue donc un cran plus haut, sur la branche entière :
     une branche s'étire un peu en longueur pendant que l'autre s'écarte de
     côté, sur des dizaines de secondes. Tous les oiseaux d'une même branche
     subissent le même étirement au même instant, si bien qu'aucun ne bouge
     par rapport à ses voisins — c'est le V qui respire, pas ses membres. */
  function nouvelleBranche() {
    return {
      fe: rnd(0.035, 0.075), pe: Math.random() * 7,   // elle s'étire en longueur
      fc: rnd(0.030, 0.065), pc: Math.random() * 7    // elle s'écarte de côté
    };
  }

  // Où en est la branche à cet instant. Les périodes sont de vingt à trente
  // secondes : une traversée n'en voit qu'un morceau, jamais un cycle — donc
  // jamais deux volées de la même forme.
  function deformation(br, t) {
    return {
      etirement: 1 + 0.20 * Math.sin(t * br.fe * Math.PI * 2 + br.pe),
      ecartement: 1 + 0.16 * Math.sin(t * br.fc * Math.PI * 2 + br.pc)
    };
  }

  function lacher(vol, place) {
    const couleur = pick(PLUMES);
    const o = creerOiseau(couleur);
    couche.appendChild(o.g);
    const b = { vol, place, dephasage: Math.random() * Math.PI * 2, ...o };
    nouveauSouffle(b);
    b.souffle = rnd(0, b.salve + b.plane);   // chacun en est où il en est
    oiseaux.push(b);
    restants++;
  }

  // Le programme : trois solitaires espacés, puis une volée en V, et c'est
  // tout. Une traversée, pas une ronde — un manège se remarquerait.
  function programme() {
    const bande = () => MARGE + rnd(hauteurTexte * 0.18, hauteurTexte * 0.82);
    const cap = () => (Math.random() < 0.5 ? 0 : Math.PI) + rnd(-0.3, 0.3);

    const solitaire = () => {
      const e = rnd(9, 12.5);
      lacher(creerVol(largeur, e, cap(), bande(), SOLITAIRE));
    };

    const volee = () => {
      const e = rnd(7.5, 9);
      const vol = creerVol(largeur, e, cap(), bande(), VOLEE);
      const pas = 3.4 * e;
      lacher(vol);                       // le meneur, qui ne suit personne
      // Une branche de chaque côté, et sa déformation propre.
      const branches = { '-1': nouvelleBranche(), '1': nouvelleBranche() };
      for (let k = 1; k <= 2; k++) {
        for (const c of [-1, 1]) {
          // Un V parfait se lit comme un gabarit : chaque place est posée
          // un peu de travers, une fois pour toutes. C'est un défaut, pas
          // un mouvement — il ne bouge plus ensuite.
          lacher(vol, {
            branche: branches[c],
            recul: k * pas * 1.05 * rnd(0.92, 1.08),
            cote: c * k * pas * 0.72 * rnd(0.92, 1.08)
          });
        }
      }
    };

    // Le ciel se peuple par petites touches, jamais par grappes : une
    // traversée dure une dizaine de secondes, et l'on attend qu'elle soit
    // finie avant la suivante. Seule la volée arrive groupée — c'est ce qui
    // en fait une volée.
    //
    // Les heures sont cumulées, pas absolues : la file décompte la première,
    // puis la suivante, et ainsi de suite.
    return [
      [0, solitaire],
      [rnd(9, 12), solitaire],
      [rnd(9, 12), solitaire],
      [rnd(10, 14), volee]
    ];
  }

  let file = [];

  function image(t) {
    raf = requestAnimationFrame(image);
    const dt = Math.min((t - horloge) / 1000, 0.06);
    horloge = t;
    if (dt <= 0) return;

    if (file.length) {
      file[0][0] -= dt;
      while (file.length && file[0][0] <= 0) file.shift()[1]();
    }

    // Une trajectoire par volée, avancée une seule fois : les suivants tiennent
    // leur place dans le repère du meneur, et virent donc avec lui.
    for (const vol of vols) {
      vol.elapsed += dt;
      const o = vol.onde;
      const t = vol.elapsed;
      let w = o.a1 * Math.sin(t * o.f1 * Math.PI * 2 + o.p1)
            + o.a2 * Math.sin(t * o.f2 * Math.PI * 2 + o.p2);

      const v = vol.virage;
      if (v) {
        // Engagé puis dégagé, comme là-haut : pas d'à-coup au début ni à la
        // fin. Le rappel se tait pendant ce temps — il tirerait en sens
        // inverse, et le virage n'aurait pas lieu.
        const u = (t - v.debut) / v.duree;
        if (u > 0 && u < 1) {
          w += ((v.angle * Math.PI) / (2 * v.duree)) * Math.sin(Math.PI * u);
        } else if (u >= 1) {
          // Le virage est pris : ce cap-là devient la référence, et la
          // formation ne cherchera plus à revenir sur celui d'avant.
          vol.capBase = vol.cap;
          vol.virage = null;
        }
      } else {
        w += ecart(vol.capBase - vol.cap) * 0.11;
      }
      vol.cap += w * dt;
      vol.x += Math.cos(vol.cap) * vol.v * dt;
      vol.y += Math.sin(vol.cap) * vol.v * dt;
      // L'inclinaison suit le virage réellement pris. Là-haut elle sort d'une
      // vraie formule de virage en palier ; ici les distances sont des pixels,
      // alors on se contente d'un rapport qui sonne juste.
      vol.incl += (w * 2.6 - vol.incl) * Math.min(1, dt * 1.6);
    }

    for (let i = oiseaux.length - 1; i >= 0; i--) {
      const b = oiseaux[i];
      const vol = b.vol;

      // Cap, vitesse et inclinaison sont ceux du meneur, pour tout le monde :
      // c'est la définition d'une formation. Seule la place dans le V change
      // d'un oiseau à l'autre — et elle ne dérive qu'au rythme de sa branche.
      let px = vol.x, py = vol.y;
      const p = b.place;
      if (p) {
        const d = deformation(p.branche, vol.elapsed);
        const recul = p.recul * d.etirement, cote = p.cote * d.ecartement;
        const fx = Math.cos(vol.cap), fz = Math.sin(vol.cap);
        px += -fx * recul - fz * cote;
        py += -fz * recul + fx * cote;
      }

      // Sorti du champ : il s'en va pour de bon.
      if (px < -170 || px > largeur + 170 || py < -170 || py > hauteur + 170) {
        b.g.remove();
        oiseaux.splice(i, 1);
        restants--;
        if (!oiseaux.some((a) => a.vol === vol)) vols.splice(vols.indexOf(vol), 1);
        continue;
      }

      // Salve, puis plané. L'amplitude s'éteint sur la fin de la salve pour
      // que les ailes se tendent au lieu de se figer en pleine course.
      b.souffle += dt;
      if (b.souffle > b.salve + b.plane) nouveauSouffle(b);
      const ampleur = Math.max(0, Math.min(1, b.souffle / 0.3, (b.salve - b.souffle) / 0.5));

      // La courbe du module : remontée plus lente que la descente.
      const brut = Math.sin(vol.elapsed * vol.cadence * Math.PI * 2 + b.dephasage);
      const bat = (brut > 0 ? Math.pow(brut, 0.8) : -Math.pow(-brut, 1.25)) * ampleur;

      // Amplitude plus courte que là-haut : les oiseaux du décor se voient de
      // trois quarts, ceux-ci exactement d'aplomb. Au sommet du battement une
      // aile passe à la verticale et disparaît — de face on ne le remarque
      // pas, d'aplomb l'oiseau clignote.
      const angle = 0.08 + bat * 0.52;     // dièdre du bras
      const coude = angle * 1.3 - 0.1;     // la main plie davantage
      const fleche = 0.1 + Math.max(0, -bat) * 0.2;

      // Vu de haut, une aile levée se raccourcit de cos(angle) — et jamais
      // au-delà : au sommet du battement elle passe à la verticale, on la
      // laisse alors se réduire à un trait plutôt que de la voir se retourner.
      const court = (a) => Math.max(0.06, Math.cos(a));
      const fBras = court(angle);
      const fMain = court(angle + coude) / fBras;
      const balai = (fleche * 180) / Math.PI;

      for (const a of b.ailes) {
        a.bras.setAttribute('transform', `translate(0 0.08) scale(1 ${fBras.toFixed(3)})`);
        a.main.setAttribute('transform',
          `translate(-0.03 0.92) rotate(${balai.toFixed(1)}) scale(1 ${fMain.toFixed(3)})`);
      }

      const capDeg = (vol.cap * 180) / Math.PI;
      const gite = court(vol.incl);
      b.g.setAttribute('transform',
        `translate(${px.toFixed(1)} ${py.toFixed(1)}) rotate(${capDeg.toFixed(1)}) ` +
        `scale(${vol.echelle.toFixed(2)}) scale(1 ${gite.toFixed(3)})`);
    }

    // Tout le monde est passé : on remballe. Plus une image calculée, et
    // plus un nœud dans la page.
    if (!file.length && !restants) arreter(true);
  }

  function demarrer() {
    if (couche) return;
    couche = document.createElementNS(SVG, 'svg');
    couche.setAttribute('class', 'oiseaux-parcours');
    couche.setAttribute('aria-hidden', 'true');
    couche.setAttribute('focusable', 'false');
    mesurer();
    section.insertBefore(couche, section.firstChild);
    file = programme();
    horloge = performance.now();
    raf = requestAnimationFrame(image);
  }

  function arreter(definitif) {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (!definitif) return;
    // La traversée est finie : on remballe, et plus rien ne se rallume.
    parti = true;
    if (couche) { couche.remove(); couche = null; }
    oiseaux = []; vols = [];
  }

  /* ---------- Quand ----------
     Rien n'existe tant qu'on n'est pas descendu jusque-là : ni nœud, ni
     image calculée. Et une fois sur place, la boucle s'arrête dès que la
     rubrique sort de l'écran ou que l'onglet passe au second plan —
     exactement comme celle du décor du haut. */
  if (!('IntersectionObserver' in window)) return;

  function reprendre() {
    if (parti || !couche) return;
    const doitTourner = enVue && ongletVisible;
    if (doitTourner && !raf) { horloge = performance.now(); raf = requestAnimationFrame(image); }
    if (!doitTourner && raf) { cancelAnimationFrame(raf); raf = 0; }
  }

  const guetteur = new IntersectionObserver((entrees) => {
    enVue = entrees[0].isIntersecting;
    if (enVue && !couche && !parti && !minuteur) {
      // « Au bout de quelques secondes » : le compte ne part qu'une fois la
      // rubrique atteinte, et s'annule si on repart avant la fin.
      minuteur = setTimeout(() => { minuteur = null; if (enVue) demarrer(); }, ATTENTE * 1000);
    } else if (!enVue && minuteur) {
      clearTimeout(minuteur); minuteur = null;
    }
    reprendre();
  }, { threshold: 0 });
  guetteur.observe(section);

  document.addEventListener('visibilitychange', () => {
    ongletVisible = !document.hidden;
    reprendre();
  });

  addEventListener('resize', () => { if (couche) mesurer(); }, { passive: true });
})();
