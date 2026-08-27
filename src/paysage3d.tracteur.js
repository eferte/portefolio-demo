/* =========================================================
   Paysage 3D — module « tracteur »
   Un tracteur et sa remorque font le tour de la route, au pas.

   Tout ce qui bouge dans ce décor bouge en l'air : les oiseaux,
   les nuages, la montgolfière, les ailes du moulin. Il manquait
   un mouvement au ras du sol — c'est lui qui donne l'échelle du
   reste, parce qu'on sait ce que c'est qu'un tracteur et à
   quelle vitesse ça avance.

   Il roule sur la chaussée et non sur le terrain : le socle
   expose `roadHeight`, qui tient compte des remblais et des
   tabliers de pont. Le recalculer ici l'aurait fait passer sous
   les ponts.

   Facultatif : sans ce fichier, la route reste déserte.
   ========================================================= */
(function () {
  const paysage3d = (window.paysage3d = window.paysage3d || {});
  (paysage3d.modules = paysage3d.modules || []).push({
    nom: 'tracteur',
    ordre: 55,
    creer
  });

  function creer(ctx) {
    const { THREE, scene, C, roadCurve, roadHeight } = ctx;
    const { rand, rnd, pick } = ctx.graine('tracteur');

    // Au pas : un tracteur qui file gâcherait l'échelle qu'il est là pour
    // donner. Le tour complet prend donc plusieurs minutes.
    const VITESSE = rnd(7.5, 9.5);          // unités par seconde
    const LONGUEUR = roadCurve.getLength();

    // Il tient sa droite, comme tout le monde en France.
    const COTE = 1.7;
    // Le timon : la remorque suit à cette distance, sur la route elle-même.
    // Une remorque tractée ne coupe pas les virages, elle les reprend un peu
    // plus court — la faire suivre la courbe est plus juste que de l'accrocher
    // rigidement derrière le tracteur.
    const TIMON = 4.2;

    const bois = new THREE.MeshStandardMaterial({ color: C.plank, roughness: 1, flatShading: true });
    const carrosserie = new THREE.MeshStandardMaterial({
      color: pick([0xc74a33, 0x3f5d9e, 0xab4f46]), roughness: 0.72, flatShading: true
    });
    const fonte = new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.9, flatShading: true });
    const jante = new THREE.MeshStandardMaterial({ color: 0xd8cdb6, roughness: 0.85, flatShading: true });

    /* Une roue : pneu, jante, et quatre crampons qui rendent la rotation
       visible. Sans eux un cylindre lisse tourne sans qu'on le voie. */
    function roue(r, large) {
      const g = new THREE.Group();
      const pneu = new THREE.Mesh(new THREE.CylinderGeometry(r, r, large, 9), fonte);
      pneu.rotation.z = Math.PI / 2;
      g.add(pneu);
      const moyeu = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.45, r * 0.45, large * 1.06, 8), jante);
      moyeu.rotation.z = Math.PI / 2;
      g.add(moyeu);
      for (let i = 0; i < 4; i++) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(large * 1.05, r * 0.22, r * 0.5), fonte);
        const a = (i / 4) * Math.PI * 2;
        c.position.set(0, Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82);
        c.rotation.x = -a;
        g.add(c);
      }
      return g;
    }

    /* Le tracteur. +Z est l'avant, comme partout ailleurs dans ce décor. */
    const roues = [];
    function faireTracteur() {
      const g = new THREE.Group();

      const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.75, 3.1), carrosserie);
      chassis.position.set(0, 1.05, 0.1);
      g.add(chassis);

      // Le capot descend vers l'avant : c'est ce décrochement qui fait lire
      // « tracteur » plutôt que « caisse sur roues ».
      const capot = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.62, 1.5), carrosserie);
      capot.position.set(0, 1.0, 1.85);
      g.add(capot);

      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 1.05, 6), fonte);
      pot.position.set(0.4, 1.75, 1.5);
      g.add(pot);

      const siege = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.62, 0.24), fonte);
      siege.position.set(0, 1.72, -0.55);
      g.add(siege);

      // L'arceau : deux montants et une traverse. Il monte haut, et c'est ce
      // qui se voit le mieux d'en haut.
      for (const s of [-1, 1]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.5, 0.12), fonte);
        m.position.set(s * 0.5, 2.15, -0.75);
        g.add(m);
      }
      const traverse = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.12, 0.12), fonte);
      traverse.position.set(0, 2.86, -0.75);
      g.add(traverse);

      // Grandes roues à l'arrière, petites à l'avant.
      for (const s of [-1, 1]) {
        const ar = roue(1.02, 0.46);
        ar.position.set(s * 0.92, 1.02, -0.7);
        g.add(ar); roues.push({ g: ar, r: 1.02 });

        const av = roue(0.58, 0.3);
        av.position.set(s * 0.72, 0.58, 1.95);
        g.add(av); roues.push({ g: av, r: 0.58 });
      }
      return g;
    }

    function faireRemorque() {
      const g = new THREE.Group();

      const plateau = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.3, 2.9), bois);
      plateau.position.set(0, 1.0, 0);
      g.add(plateau);
      // Ridelles : trois côtés, l'arrière ouvert — une remorque de ferme.
      for (const [w, h, d, x, z] of [[0.12, 0.6, 2.9, 0.9, 0], [0.12, 0.6, 2.9, -0.9, 0],
                                     [1.9, 0.6, 0.12, 0, 1.45]]) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bois);
        r.position.set(x, 1.45, z);
        g.add(r);
      }

      // Un chargement, pas toujours : une remorque vide se rencontre autant
      // qu'une pleine, et c'est le tirage qui décide.
      if (rand() < 0.6) {
        const foin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.85, 2.5),
          new THREE.MeshStandardMaterial({ color: C.fieldWheat, roughness: 1, flatShading: true }));
        foin.position.set(0, 1.6, -0.1);
        g.add(foin);
      }

      const timon = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 1.5), fonte);
      timon.position.set(0, 0.95, 2.1);
      g.add(timon);

      for (const s of [-1, 1]) {
        const r = roue(0.62, 0.32);
        r.position.set(s * 0.95, 0.62, -0.35);
        g.add(r); roues.push({ g: r, r: 0.62 });
      }
      return g;
    }

    const tracteur = faireTracteur();
    const remorque = faireRemorque();
    // Nommés comme la cheminée l'est : c'est ce qui permet de les retrouver
    // dans la scène sans deviner leur forme.
    tracteur.name = 'tracteur';
    remorque.name = 'remorque';
    scene.add(tracteur);
    scene.add(remorque);

    /* Poser un véhicule sur la chaussée à l'abscisse `t` : la position, le cap,
       et la pente. La pente se lit sur la route elle-même, un peu devant et un
       peu derrière — un véhicule épouse le profil, il ne flotte pas à plat. */
    const up = new THREE.Vector3(0, 1, 0);
    const tan = new THREE.Vector3(), cote = new THREE.Vector3();

    function poser(obj, t) {
      t = ((t % 1) + 1) % 1;
      const p = roadCurve.getPointAt(t);
      roadCurve.getTangentAt(t, tan);
      // La droite du véhicule, c'est `avant × haut` — et non l'inverse, qui
      // donne la gauche : dans un repère direct, un objet qui file vers +Z a
      // sa main droite vers -X.
      cote.crossVectors(tan, up).normalize();

      const y = roadHeight(t);
      obj.position.set(p.x + cote.x * COTE, y, p.z + cote.z * COTE);

      const dt = 2.2 / LONGUEUR;
      const devant = roadHeight(t + dt), derriere = roadHeight(t - dt);
      const pente = Math.atan2(devant - derriere, 4.4);

      obj.rotation.set(0, 0, 0);
      obj.rotateY(Math.atan2(tan.x, tan.z));
      obj.rotateX(-pente);
    }

    // Il part d'un point quelconque de la route : le décor ne commence pas
    // toujours au même endroit du tour.
    let parcouru = rand() * LONGUEUR;

    function placer() {
      const t = parcouru / LONGUEUR;
      poser(tracteur, t);
      poser(remorque, t - TIMON / LONGUEUR);
    }
    placer();

    return {
      animer(dt) {
        const avance = VITESSE * dt;
        parcouru = (parcouru + avance) % LONGUEUR;
        placer();
        // Les roues tournent de ce que le sol a défilé sous elles : pas d'à-peu-près,
        // sinon on voit tout de suite qu'elles patinent.
        for (const r of roues) r.g.rotation.x -= avance / r.r;
      }
    };
  }
})();
