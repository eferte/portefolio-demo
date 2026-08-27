/* =========================================================
   Paysage 3D — module « oiseaux »
   Des solitaires et une volée en V. Le ciel commence vide :
   chacun entre en scène au bout d'un certain temps, par le
   côté, hors du champ — jamais sous les yeux.

   Facultatif : sans ce fichier, le ciel reste sans vie et le
   reste du décor est identique.
   ========================================================= */
(function () {
  const paysage3d = (window.paysage3d = window.paysage3d || {});
  (paysage3d.modules = paysage3d.modules || []).push({
    nom: 'oiseaux',
    ordre: 50,
    creer
  });

  function creer(ctx) {
    const { THREE, scene, camera, C, clamp, terrainHeight, flightPath, flight, reduced } = ctx;
    const { rand, rnd, pick } = ctx.graine('oiseaux');

    /* ---------- Oiseaux ---------- */
    // Ce qui fait lire « oiseau » de loin, c'est la silhouette : une aile
    // effilée, en flèche, qui se termine en pointe — pas un rectangle. Elle est
    // découpée en deux tronçons articulés, bras et main, pour que le battement
    // plie au bon endroit et que la pointe traîne un peu derrière.
    const birds = [];
    // Gris et bruns clairs : un oiseau vu d'au-dessus n'est pas une ombre noire
    const birdMats = C.birds.map((c) => new THREE.MeshStandardMaterial({
      color: c, roughness: 0.88, side: THREE.DoubleSide, flatShading: true
    }));

    // Polygone à plat dans le plan XZ : X = envergure, +Z = vers l'avant
    function planForm(pts) {
      const v = [];
      for (let i = 1; i < pts.length - 1; i++) {
        v.push(pts[0][0], 0, pts[0][1]);
        v.push(pts[i][0], 0, pts[i][1]);
        v.push(pts[i + 1][0], 0, pts[i + 1][1]);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      geo.computeVertexNormals();
      return geo;
    }

    // L'aile : bras large à l'emplanture, main effilée en flèche qui finit en
    // pointe. Les deux tronçons se chevauchent un peu, sinon un filet de ciel
    // passe au niveau du coude.
    const geoBras = planForm([[0, 0.43], [0.92, 0.32], [0.92, -0.42], [0, -0.49]]);
    const geoMain = planForm([
      [-0.06, 0.33], [0.60, 0.17], [1.14, -0.12], [0.82, -0.33], [0.52, -0.49], [-0.06, -0.44]
    ]);
    // La queue : un éventail étroit et légèrement échancré, dans le prolongement
    // du corps — surtout pas un empennage d'avion
    const geoQueue = planForm([
      [0.13, 0.06], [0.27, -0.52], [0.15, -0.88], [0, -0.70], [-0.15, -0.88], [-0.27, -0.52], [-0.13, 0.06]
    ]);

    // L'aile gauche est une vraie copie miroir. Passer par un scale.x négatif
    // inverserait aussi le sens des rotations : une aile monterait pendant que
    // l'autre descendrait.
    function miroir(geo) {
      const g = geo.clone();
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setX(i, -pos.getX(i));
      pos.needsUpdate = true;
      g.computeVertexNormals();
      return g;
    }
    const geoBrasG = miroir(geoBras), geoMainG = miroir(geoMain);

    // Le corps : un fuseau qui s'affine jusqu'à la queue, tourné vers l'avant
    const geoCorps = (() => {
      const profil = [
        [0.02, -0.95], [0.09, -0.7], [0.15, -0.35], [0.175, 0],
        [0.165, 0.35], [0.13, 0.66], [0.075, 0.87], [0.0, 0.97]
      ].map(([r, y]) => new THREE.Vector2(r, y));
      const geo = new THREE.LatheGeometry(profil, 7);
      geo.rotateX(Math.PI / 2);
      return geo;
    })();

    function makeBird(birdMat) {
      const g = new THREE.Group();

      const corps = new THREE.Mesh(geoCorps, birdMat);
      g.add(corps);

      const tete = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), birdMat);
      tete.scale.set(0.13, 0.13, 0.15);
      tete.position.set(0, 0.055, 0.94);
      g.add(tete);

      const queue = new THREE.Mesh(geoQueue, birdMat);
      queue.position.set(0, 0, -0.86);
      g.add(queue);

      const epaules = [];
      for (const c of [1, -1]) {
        const bras = new THREE.Group();
        bras.position.set(c * 0.08, 0.03, 0.12);
        bras.add(new THREE.Mesh(c > 0 ? geoBras : geoBrasG, birdMat));
        const main = new THREE.Group();
        main.position.set(c * 0.92, 0, -0.03);
        main.add(new THREE.Mesh(c > 0 ? geoMain : geoMainG, birdMat));
        bras.add(main);
        g.add(bras);
        epaules.push({ bras, main, c });
      }

      g.userData.epaules = epaules;
      return g;
    }

    // Un oiseau qui boucle se lit tout de suite comme un manège. Chaque
    // trajectoire alterne donc un virage — engagé puis dégagé en douceur — et un
    // long trait droit. Et quand l'oiseau finit par sortir du champ derrière la
    // caméra, on le relance devant, sur un nouveau cap : il ne repasse jamais.
    const trajets = [];

    function nouveauCycle(tr) {
      tr.phase = 0;
      // Un oiseau ne vole pas au cordeau : il monte et redescend un peu
      tr.hauteur = clamp(tr.hauteur + rnd(-7, 7), 10, 34);
      tr.dureeArc = rnd(2.4, 5.2);       // le temps du virage
      tr.dureeDroite = rnd(6, 13);       // puis on file droit, longuement
      tr.omega = (rand() < 0.5 ? 1 : -1) * rnd(0.09, 0.24);
    }

    function relancerTrajet(tr, premier) {
      // On réapparaît devant la caméra, bien sur le côté : la relance se fait
      // toujours hors du champ, jamais sous les yeux.
      // Au tout premier lâcher, la caméra n'a pas encore commencé son tour :
      // on part de zéro plutôt que de lire une valeur qui n'existe pas encore.
      const base = premier ? 0 : flight.t;
      const t = (base + (premier ? rnd(0.01, 0.1) : rnd(0.05, 0.17))) % 1;
      const q = flightPath.getPointAt(t);
      const tan = flightPath.getTangentAt(t);
      const cote = rand() < 0.5 ? 1 : -1;
      const lat = rnd(115, 265);
      tr.x = q.x - tan.z * lat * cote;
      tr.z = q.z + tan.x * lat * cote;
      tr.hauteur = rnd(12, 30);
      tr.y = terrainHeight(tr.x, tr.z) + tr.hauteur;
      // Cap : ils traversent le champ en oblique, à contre-sens de la caméra
      tr.cap = Math.atan2(tan.z, tan.x) + Math.PI * 0.62 + rnd(-0.35, 0.35);
      tr.incl = 0;
      nouveauCycle(tr);
    }

    function nouveauTrajet(vitesseMin, vitesseMax, garde, entree) {
      const tr = { x: 0, z: 0, y: 0, hauteur: 0, cap: 0, incl: 0,
                   v: rnd(vitesseMin, vitesseMax),
                   garde,                 // distance en deçà de laquelle il s'écarte
                   omega: 0, phase: 0, dureeArc: 0, dureeDroite: 0,
                   // Heure d'entrée en scène, en secondes de vol. Tant qu'elle
                   // n'est pas venue, la trajectoire dort et ses oiseaux sont
                   // masqués : le ciel reste vide.
                   attente: reduced ? 0 : entree, actif: reduced || !entree,
                   oiseaux: [] };
      relancerTrajet(tr, true);
      trajets.push(tr);
      return tr;
    }

    function majTrajet(tr, dt, camX, camZ) {
      tr.phase += dt;
      let w = 0;
      if (tr.phase < tr.dureeArc) {
        // Le virage s'engage et se dégage : pas d'à-coup au début ni à la fin
        w = tr.omega * Math.sin((tr.phase / tr.dureeArc) * Math.PI);
      } else if (tr.phase > tr.dureeArc + tr.dureeDroite) {
        nouveauCycle(tr);
      }
      tr.cap += w * dt;

      // Évitement : un oiseau ne laisse pas une masse en mouvement le rattraper.
      // Il infléchit son cap pour s'écarter, d'autant plus que la caméra est
      // proche — et c'est aussi ce qui nous évite de lire le détail du modèle.
      const ex = tr.x - camX, ez = tr.z - camZ;
      const dCam = Math.hypot(ex, ez) || 1;
      if (dCam < tr.garde) {
        let diff = Math.atan2(ez, ex) - tr.cap;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const force = (1 - dCam / tr.garde) * 1.5;
        tr.cap += clamp(diff, -1, 1) * force * dt;
        tr.incl += (Math.atan((tr.v * clamp(diff, -1, 1) * force) / 9.81) - tr.incl) * Math.min(1, dt * 1.2);
      }

      tr.x += Math.cos(tr.cap) * tr.v * dt;
      tr.z += Math.sin(tr.cap) * tr.v * dt;
      const cible = terrainHeight(tr.x, tr.z) + tr.hauteur;
      tr.y += (cible - tr.y) * Math.min(1, dt * 0.6);
      // L'inclinaison suit le virage réellement pris
      const vise = Math.atan((tr.v * w) / 9.81);
      tr.incl += (vise - tr.incl) * Math.min(1, dt * 1.6);
    }

    function surveillerTrajet(tr, cam, fx, fz) {
      const dx = tr.x - cam.x, dz = tr.z - cam.z;
      const d = Math.hypot(dx, dz) || 1;
      const devant = (dx * fx + dz * fz) / d;
      if (d > 520 || Math.hypot(tr.x, tr.z) > 470 || (devant < 0.12 && d > 190)) {
        relancerTrajet(tr, false);
      }
    }

    function lacher(tr, decalage, echelle) {
      const g = makeBird(pick(birdMats));
      g.scale.setScalar(echelle);
      g.userData.vol = tr;
      g.userData.decalage = decalage;
      g.userData.bat = { cadence: rnd(2.2, 3.2), phase: rand() * Math.PI * 2 };
      g.visible = tr.actif;
      tr.oiseaux.push(g);
      birds.push(g);
      scene.add(g);
      return g;
    }

    // Le ciel commence vide. Le paysage se présente d'abord seul, puis la vie
    // arrive par petites touches : un premier oiseau au bout d'un moment, un
    // autre, et plus tard la volée. Chacun entre par le côté, hors du champ.
    let heureOiseau = 15;

    // Les solitaires
    for (let i = 0; i < 8; i++) {
      lacher(nouveauTrajet(15, 24, 300, heureOiseau), null, rnd(1.7, 2.4));
      heureOiseau += rnd(7, 14);
    }

    // Une volée en V : une seule trajectoire pour tous, chacun calé derrière le
    // meneur — ils virent donc ensemble et filent droit ensemble.
    {
      // Une volée entière se tient plus loin, et se fait attendre.
      const tr = nouveauTrajet(15, 22, 390, rnd(42, 56));
      const echelle = rnd(1.5, 1.9);
      const pas = 3.4 * echelle;   // serrés : la formation doit se lire d'un coup
      lacher(tr, { recul: 0, cote: 0, haut: 0 }, echelle);
      for (let k = 1; k <= 2; k++) {
        for (const c of [-1, 1]) {
          lacher(tr, {
            recul: k * pas * 1.05,
            cote: c * k * pas * 0.72,
            haut: rnd(-0.6, 0.6)
          }, echelle * rnd(0.94, 1.04));
        }
      }
    }

    const dirTmp = new THREE.Vector3();

    return {
      animer(dt, elapsed) {
        // Les trajectoires avancent, et l'on relance derrière la caméra
        {
          const avant = camera.getWorldDirection(dirTmp);
          const fl = Math.hypot(avant.x, avant.z) || 1;
          const fx = avant.x / fl, fz = avant.z / fl;
          for (const tr of trajets) {
            if (!tr.actif) {
              tr.attente -= dt;
              if (tr.attente > 0) continue;
              // L'heure est venue : on les place hors champ, à l'instant
              // présent, exactement comme lors d'une relance — puis on les
              // montre.
              relancerTrajet(tr, false);
              tr.actif = true;
              tr.oiseaux.forEach((o) => { o.visible = true; });
            }
            majTrajet(tr, dt, camera.position.x, camera.position.z);
            surveillerTrajet(tr, camera.position, fx, fz);
          }
        }

        birds.forEach((b) => {
          if (!b.visible) return;          // pas encore entré en scène
          const tr = b.userData.vol;
          const bp = b.userData.bat;

          // Battement continu : la remontée est un peu plus lente que la
          // descente, comme chez un oiseau qui rame vraiment.
          const t = elapsed * bp.cadence * Math.PI * 2 + bp.phase;
          const brut = Math.sin(t);
          const bat = brut > 0 ? Math.pow(brut, 0.8) : -Math.pow(-brut, 1.25);

          const fx = Math.cos(tr.cap), fz = Math.sin(tr.cap);
          let px = tr.x, pz = tr.z;
          let py = tr.y + Math.sin(elapsed * 0.4 + bp.phase) * 1.2 + bat * 0.5;

          // En volée, chacun tient sa place dans le V, exprimée dans le repère
          // du meneur : une seule trajectoire, donc tous virent ensemble.
          const d = b.userData.decalage;
          if (d) {
            px += -fx * d.recul - fz * d.cote;
            pz += -fz * d.recul + fx * d.cote;
            py += d.haut;
          }
          b.position.set(px, py, pz);

          // Le nez suit le cap, et l'oiseau s'incline dans le virage qu'il prend
          b.rotation.set(0, 0, 0);
          b.rotateY(Math.PI / 2 - tr.cap);
          b.rotateZ(tr.incl);
          b.rotateX(-0.04 + bat * 0.05);

          // Les deux ailes montent ensemble : le signe c compense le miroir
          const angle = 0.1 + bat * 0.66;                      // battement des ailes
          const coude = angle * 1.4 - 0.14;                    // la pointe plie plus
          const fleche = 0.1 + Math.max(0, -bat) * 0.2;        // main ramenée en arrière
          const vrille = 0.2 - bat * 0.22;                     // vrillage de la main
          for (const e of b.userData.epaules) {
            e.bras.rotation.z = e.c * angle;
            e.main.rotation.z = e.c * coude;
            e.main.rotation.y = e.c * fleche;
            e.main.rotation.x = vrille;
          }
        });
      }
    };
  }
})();

