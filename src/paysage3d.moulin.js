/* =========================================================
   Paysage 3D — module « moulin »
   Un moulin-tour planté sur une vraie hauteur : le module
   balaie le relief à la recherche d'un sommet — altitude et
   proéminence — en vue de la route et à l'écart du village.
   Ses ailes tournent lentement au vent.

   Facultatif : sans ce fichier, les crêtes restent nues. Il se
   place avant la végétation, car il s'inscrit dans la liste des
   bâtiments : les arbres et les fleurs l'évitent, et il reçoit
   son ombre au sol.
   ========================================================= */
(function () {
  const paysage3d = (window.paysage3d = window.paysage3d || {});
  (paysage3d.modules = paysage3d.modules || []).push({
    nom: 'moulin',
    ordre: 10,
    creer
  });

  // Un tour d'aile en 17 secondes, à vitesse constante.
  const TOUR = (Math.PI * 2) / 17;

  /* L'orientation du fût. Les ailes sont montées sur sa face +Z : selon le cap,
     on les voit tourner derrière la tour ou balayer devant elle, et ce n'est
     pas du tout aussi joli. Cet angle-là (8°) est donc un choix, relevé sur la
     version qui donnait le bon rendu — surtout pas un tirage au hasard, qui
     retomberait d'un côté ou de l'autre à chaque changement du décor. */
  const CAP = 0.14096145524470266;

  function creer(ctx) {
    const { THREE, C, village, buildings, terrainHeight, slopeAt, distToRoad,
            horsDeLEau } = ctx;

    // Un moulin se plante sur une hauteur, pour prendre le vent : on balaie le
    // relief à la recherche d'un vrai sommet — altitude et proéminence — en vue
    // de la route et à l'écart du village.
    let moulin = null;
    {
      let best = null;
      for (let x = -400; x <= 400; x += 12) {
        for (let z = -400; z <= 400; z += 12) {
          const dRoute = distToRoad(x, z);
          if (dRoute < 22 || dRoute > 170) continue;
          if (!horsDeLEau(x, z) || slopeAt(x, z) > 4.2) continue;
          if (buildings.some((b) => Math.hypot(b.x - x, b.z - z) < 36)) continue;
          const h = terrainHeight(x, z);
          let plusHaut = false;
          let somme = 0, n = 0;
          for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
            for (const d of [22, 44]) {
              const hv = terrainHeight(x + Math.cos(a) * d, z + Math.sin(a) * d);
              if (hv > h + 0.6) plusHaut = true;
              somme += hv; n++;
            }
          }
          if (plusHaut) continue;                 // ce n'est pas un sommet
          const proeminence = h - somme / n;
          const score = h + proeminence * 4;
          if (!best || score > best.score) best = { x, z, h, score };
        }
      }
      if (best) {
        moulin = makeWindmill();
        moulin.position.set(best.x, best.h - 0.3, best.z);
        moulin.rotation.y = CAP;
        village.add(moulin);
        buildings.push({ x: best.x, z: best.z, r: 11 });
      }
    }


    if (!moulin) return;
    const rotor = moulin.userData.rotor;

    return {
      // Rotation régulière : pas d'accélération, pas de ralenti — un moulin
      // qui tourne au vent garde sa cadence.
      animer(dt) {
        rotor.rotation.z -= dt * TOUR;
      }
    };

    /* Un moulin-tour : fût de pierre chaulée, calotte de bardeaux, et quatre
       ailes à claire-voie qui tournent lentement au vent. */
    function makeWindmill() {
      const g = new THREE.Group();
      const chaux = new THREE.MeshStandardMaterial({ color: C.mill, roughness: 1, flatShading: true });
      const bois = new THREE.MeshStandardMaterial({ color: C.plank, roughness: 1, flatShading: true });
      const bardeaux = new THREE.MeshStandardMaterial({ color: C.millCap, roughness: 0.95, flatShading: true });

      const fut = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 3.9, 12.5, 9), chaux);
      fut.position.y = 6.25;
      g.add(fut);

      const bandeau = new THREE.Mesh(new THREE.CylinderGeometry(2.75, 2.75, 0.5, 9), bois);
      bandeau.position.y = 12.4;
      g.add(bandeau);

      const calotte = new THREE.Mesh(new THREE.ConeGeometry(3.1, 3.4, 9), bardeaux);
      calotte.position.y = 14.3;
      g.add(calotte);

      const porte = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 0.3), bois);
      porte.position.set(0, 1.1, 3.6);
      g.add(porte);

      // Les ailes tournent autour d'un axe horizontal, en avant de la calotte
      const rotor = new THREE.Group();
      rotor.position.set(0, 13.2, 3.4);
      const moyeu = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.3, 8), bois);
      moyeu.rotation.x = Math.PI / 2;
      rotor.add(moyeu);

      for (let i = 0; i < 4; i++) {
        const aile = new THREE.Group();
        aile.rotation.z = (i / 4) * Math.PI * 2;

        const longeron = new THREE.Mesh(new THREE.BoxGeometry(0.34, 9.4, 0.26), bois);
        longeron.position.y = 4.9;
        aile.add(longeron);

        // Claire-voie : des lattes régulières, comme la toile tendue sur le cadre
        for (let k = 0; k < 7; k++) {
          const latte = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.22, 0.16), bois);
          latte.position.set(1.05, 1.5 + k * 1.25, 0.06);
          aile.add(latte);
        }
        const bordure = new THREE.Mesh(new THREE.BoxGeometry(0.2, 8, 0.16), bois);
        bordure.position.set(2.05, 5.2, 0.06);
        aile.add(bordure);

        rotor.add(aile);
      }

      g.add(rotor);
      g.userData.rotor = rotor;
      return g;
    }
  }
})();
