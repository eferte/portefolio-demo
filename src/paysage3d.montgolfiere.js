/* =========================================================
   Paysage 3D — module « montgolfière »
   Une seule montgolfière, croisée une seule fois : elle attend
   loin devant, noyée dans la brume, c'est l'avancée de la
   caméra qui la révèle — puis elle sort du cadre et quitte la
   scène pour de bon.

   Facultatif : sans ce fichier, le ciel n'a pas de voyageur.
   ========================================================= */
(function () {
  const paysage3d = (window.paysage3d = window.paysage3d || {});
  (paysage3d.modules = paysage3d.modules || []).push({
    nom: 'montgolfiere',
    ordre: 60,
    creer
  });

  function creer(ctx) {
    const { THREE, scene, camera, C, terrainHeight, flightPath } = ctx;
    const { rand, rnd } = ctx.graine('montgolfiere');

    /* ---------- Montgolfière ---------- */
    // On ne la croise qu'une fois, et elle ne se téléporte jamais : elle attend
    // loin devant, noyée dans la brume du lointain, et c'est l'avancée de la
    // caméra qui la révèle. Elle grossit, on la longe à bonne distance, elle
    // sort du cadre par l'arrière — et là on la retire de la scène pour de bon.
    // Le réglage tient à deux bornes : sous ~250 elle rase la caméra, au-delà
    // de ~350 le brouillard (280 → 700) lui mange ses couleurs et il ne reste
    // qu'une tache pâle. On la croise donc autour de 300, en pleine couleur.
    const BALLON_ECART = 275;    // distance mini à la trajectoire de la caméra
    const BALLON_BRUME = 700;    // au-delà, le brouillard la cache entièrement
    const BALLON_ADIEU = 780;    // au-delà, une fois vue, on l'oublie

    const ballon = makeMontgolfiere();
    ballon.userData.ballon = true;
    ballon.scale.setScalar(1.6);

    const derive = {
      // Le vent reste faible : c'est l'avancée de la caméra qui fait le
      // rapprochement, pas la dérive du ballon — poussé trop fort, il fuit
      // devant nous et reste noyé dans la brume.
      //
      // Assez, tout de même, pour qu'on le voie se déplacer sur le paysage :
      // à un mètre-seconde il se confondait avec le soleil, c'est-à-dire avec
      // un décor peint. La caméra file plusieurs fois plus vite, elle le
      // rattrape donc toujours.
      x: 0, z: 0, hauteur: rnd(64, 108), cap: 0, v: rnd(2.4, 3.4),
      vue: false, partie: false
    };

    // Poste d'attente : un point de la trajectoire loin devant, décalé sur le
    // côté. On garde le candidat le plus lointain — plus il naît loin, plus la
    // brume le dissimule au premier plan, et mieux il émerge ensuite.
    {
      const depart = flightPath.getPointAt(0);
      const q = new THREE.Vector3(), tan = new THREE.Vector3();
      let poste = null;
      for (const avance of [0.22, 0.26, 0.30, 0.34, 0.38]) {
        for (const cote of [1, -1]) {
          flightPath.getPointAt(avance, q);
          flightPath.getTangentAt(avance, tan);
          // Perpendiculaire à la trajectoire, vers l'extérieur du virage
          const x = q.x - tan.z * BALLON_ECART * cote;
          const z = q.z + tan.x * BALLON_ECART * cote;
          const d = Math.hypot(x - depart.x, z - depart.z);
          if (!poste || d > poste.d) {
            // Elle suit le même vent que nous, dans le sens du vol : elle ne
            // revient donc jamais vers la caméra, et ne s'en écarte pas non plus.
            poste = { x, z, d, cap: Math.atan2(tan.z, tan.x) };
          }
        }
      }
      derive.x = poste.x;
      derive.z = poste.z;
      derive.cap = poste.cap + rnd(-0.25, 0.25);
      scene.add(ballon);
    }

    // Elle s'en va définitivement : plus un objet dans la scène, plus rien à
    // mettre à jour à chaque image.
    function congedierBallon() {
      scene.remove(ballon);
      ballon.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
        }
      });
      derive.partie = true;
    }

    const dirTmp = new THREE.Vector3();

    return {
      animer(dt, elapsed) {
        // Elle dérive, tourne doucement sur elle-même et respire — tant
        // qu'elle est encore de ce monde.
        if (derive.partie) return;

        derive.x += Math.cos(derive.cap) * derive.v * dt;
        derive.z += Math.sin(derive.cap) * derive.v * dt;
        ballon.position.set(
          derive.x,
          terrainHeight(derive.x, derive.z) + derive.hauteur + Math.sin(elapsed * 0.18) * 2.2,
          derive.z
        );
        ballon.rotation.y += dt * 0.05;
        ballon.rotation.z = Math.sin(elapsed * 0.22) * 0.02;

        const ex = derive.x - camera.position.x, ez = derive.z - camera.position.z;
        const dB = Math.hypot(ex, ez);
        const dirB = camera.getWorldDirection(dirTmp);
        const fl = Math.hypot(dirB.x, dirB.z) || 1;
        const devantB = (ex * dirB.x / fl + ez * dirB.z / fl) / (dB || 1);

        // Vraiment vue : bien dans l'axe du regard, et sortie de la brume.
        if (devantB > 0.78 && dB < BALLON_BRUME - 60) derive.vue = true;

        // Elle a quitté le cadre par le côté ou par l'arrière : rideau. Et si
        // le hasard du vol ne nous l'a jamais montrée, on ne la traîne pas
        // indéfiniment aux confins du décor.
        if ((derive.vue && (devantB < 0.1 || dB > BALLON_ADIEU)) || dB > 1100) {
          congedierBallon();
        }
      }
    };

    /* Une montgolfière : enveloppe tournée au tour, fuseaux colorés cuits dans la
       géométrie, nacelle d'osier et ses quatre suspentes. */
    function makeMontgolfiere() {
      const g = new THREE.Group();

      // Le bas se resserre franchement vers la gueule, tandis que la calotte suit
      // un arc de cercle : une enveloppe de montgolfière est ronde sur le dessus
      // et fuselée sur le dessous, jamais ogivale.
      const PROFIL = [
        [0.62, 0], [1.4, 0.85], [2.7, 2.2], [4.2, 3.9], [5.6, 5.8], [6.5, 7.5], [6.8, 8.7],
        [6.5, 10.5], [5.8, 12.1], [4.6, 13.5], [3.2, 14.5], [1.6, 15.05], [0, 15.3]
      ];
      const profil = PROFIL.map(([r, y]) => new THREE.Vector2(r, y));

      const FUSEAUX = 16;
      const geo = new THREE.LatheGeometry(profil, FUSEAUX).toNonIndexed();
      const pos = geo.attributes.position;
      const couleurs = new Float32Array(pos.count * 3);
      const teinte = new THREE.Color();
      for (let f = 0; f < pos.count; f += 3) {
        // Un fuseau = une bande verticale : on prend l'azimut du centre de face
        let ax = 0, az = 0;
        for (let k = 0; k < 3; k++) { ax += pos.getX(f + k); az += pos.getZ(f + k); }
        const a = Math.atan2(az, ax);
        const fuseau = Math.floor(((a + Math.PI) / (Math.PI * 2)) * FUSEAUX + 0.5) % FUSEAUX;
        teinte.setHex(C.gores[fuseau % C.gores.length]);
        for (let k = 0; k < 3; k++) {
          couleurs[(f + k) * 3] = teinte.r;
          couleurs[(f + k) * 3 + 1] = teinte.g;
          couleurs[(f + k) * 3 + 2] = teinte.b;
        }
      }
      geo.setAttribute('color', new THREE.BufferAttribute(couleurs, 3));
      geo.computeVertexNormals();

      const enveloppe = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.85, side: THREE.DoubleSide, flatShading: true
      }));
      enveloppe.position.y = 4.2;
      g.add(enveloppe);

      const osier = new THREE.MeshStandardMaterial({ color: C.nacelle, roughness: 1, flatShading: true });
      const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.94, 1.55, 8), osier);
      g.add(nacelle);

      // Les suspentes vont du bord de la nacelle jusqu'à la gorge de l'enveloppe,
      // qu'elles rejoignent franchement : un fil qui s'arrête en chemin donne
      // l'impression que la nacelle flotte toute seule.
      const basR = 1.0, basY = 0.7;                    // bord de la nacelle
      const accroche = PROFIL[2];                      // là où l'enveloppe s'évase
      const hautR = accroche[0] * 0.94;
      const hautY = 4.2 + accroche[1] - 0.15;          // 4.2 = hauteur de l'enveloppe
      const longueur = Math.hypot(hautR - basR, hautY - basY);
      const inclinaison = Math.atan2(hautR - basR, hautY - basY);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const rMoyen = (basR + hautR) / 2;
        const suspente = new THREE.Mesh(new THREE.BoxGeometry(0.13, longueur, 0.13), osier);
        suspente.position.set(Math.cos(a) * rMoyen, (basY + hautY) / 2, Math.sin(a) * rMoyen);
        suspente.rotation.z = -Math.cos(a) * inclinaison;
        suspente.rotation.x = Math.sin(a) * inclinaison;
        g.add(suspente);
      }

      return g;
    }
  }
})();
