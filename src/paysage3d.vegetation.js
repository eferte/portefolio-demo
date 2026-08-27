/* =========================================================
   Paysage 3D — module « végétation »
   Bosquets, alignements de route, ripisylve, saules de l'étang,
   buissons, haies de bocage, massifs de fleurs, meules de foin
   — et la nappe d'ombres portées au sol.

   Tout part en maillages instanciés : quelques milliers d'objets
   pour une poignée d'appels de dessin.

   Facultatif : sans ce fichier, le relief, l'eau, la route et
   le village restent — mais la campagne est rase, et plus rien
   ne porte d'ombre.
   ========================================================= */
(function () {
  const paysage3d = (window.paysage3d = window.paysage3d || {});
  (paysage3d.modules = paysage3d.modules || []).push({
    nom: 'vegetation',
    ordre: 20,
    creer
  });

  function creer(ctx) {
    const { THREE, scene, C, buildInstanced, fieldKind, hash2,
            terrainHeight, slopeAt, distToRoad,
            roadCurve, buildings, LAKE, RIVER, lakeShore } = ctx;
    const { rand, rnd, pick } = ctx.graine('vegetation');

    /* ---------- Arbres, buissons, fleurs ---------- */
    const trunks = [], foliage = [], cones = [], flowers = [], shadows = [];

    const nearBuilding = (x, z) => buildings.some((b) => Math.hypot(b.x - x, b.z - z) < b.r);
    const riverDist = (x, z) => {
      const { d, i } = RIVER.field.sample(x, z);
      return d - RIVER.width[i] * 0.42;      // distance à la berge, pas à l'axe
    };
    const isPlantable = (x, z, minRoad = 7) => {
      if (Math.hypot(x, z) > 460) return false;
      if (distToRoad(x, z) < minRoad) return false;
      if (riverDist(x, z) < 2.5) return false;
      const dLac = Math.hypot(x - LAKE.x, z - LAKE.z);
      if (dLac < lakeShore(Math.atan2(z - LAKE.z, x - LAKE.x)) + 2.5) return false;
      if (terrainHeight(x, z) < LAKE.level + 1.2) return false;
      if (slopeAt(x, z) > 8) return false;
      return !nearBuilding(x, z);
    };

    // Bosquets
    for (let c = 0; c < 78; c++) {
      const a = rand() * Math.PI * 2;
      const r = 40 + Math.sqrt(rand()) * 390;
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
      const n = Math.floor(rnd(3, 11));
      for (let i = 0; i < n; i++) {
        const x = cx + rnd(-16, 16), z = cz + rnd(-16, 16);
        if (!isPlantable(x, z)) continue;
        addTree(x, z, rand() < 0.24);
      }
    }
    // Arbres d'alignement le long de la route
    for (let i = 0; i < 130; i++) {
      const t = i / 130;
      const p = roadCurve.getPointAt(t);
      const tan = roadCurve.getTangentAt(t);
      const side = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
      const dir = i % 2 === 0 ? 1 : -1;
      const off = rnd(7.5, 10.5) * dir;
      const x = p.x + side.x * off, z = p.z + side.z * off;
      if (rand() > 0.42 || nearBuilding(x, z)) continue;
      if (terrainHeight(x, z) < LAKE.level + 1) continue;
      addTree(x, z, false, 0.85);
    }
    // Ripisylve : les arbres suivent la rivière
    for (let i = 6; i < RIVER.pts.length - 4; i += 3) {
      if (rand() > 0.5) continue;
      const p = RIVER.pts[i];
      const q = RIVER.pts[i + 2];
      const tx = q.x - p.x, tz = q.z - p.z;
      const tl = Math.hypot(tx, tz) || 1;
      const side = rand() < 0.5 ? 1 : -1;
      const off = (RIVER.width[i] * 0.45 + rnd(2, 9)) * side;
      const x = p.x + (-tz / tl) * off, z = p.z + (tx / tl) * off;
      if (distToRoad(x, z) < 6 || nearBuilding(x, z)) continue;
      if (Math.hypot(x - LAKE.x, z - LAKE.z) < lakeShore(Math.atan2(z - LAKE.z, x - LAKE.x)) + 2) continue;
      addTree(x, z, false, rnd(0.75, 1.25));
    }

    // Saules et arbustes au bord de l'étang
    for (let i = 0; i < 34; i++) {
      const a = rand() * Math.PI * 2;
      const r = lakeShore(a) * rnd(1.02, 1.24);
      const x = LAKE.x + Math.cos(a) * r, z = LAKE.z + Math.sin(a) * r;
      if (distToRoad(x, z) < 6) continue;
      addTree(x, z, false, rnd(0.7, 1.1));
    }
    // Buissons épars
    for (let i = 0; i < 260; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * 430;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!isPlantable(x, z, 5)) continue;
      const s = rnd(0.5, 1.0);
      foliage.push({ x, y: terrainHeight(x, z) + s * 0.7, z, s, sy: s * rnd(0.7, 0.95), color: pick(C.foliage) });
    }
    // Haies : des buissons alignés sur les limites de parcelles. C'est le bocage
    // qui donne son grain au paysage — et qui casse l'effet damier vu d'en haut.
    let poses = 0;
    for (let i = 0; i < 14000 && poses < 1100; i++) {
      const x = rnd(-430, 430), z = rnd(-430, 430);
      const f = fieldKind(x, z);
      if (f.bord > 1.5) continue;
      if (hash2(f.ci * 31 + 5, f.cj * 17 + 2) < 0.3) continue;   // certaines parcelles restent ouvertes
      if (!isPlantable(x, z, 6)) continue;
      poses++;
      const s0 = rnd(0.65, 1.15);
      foliage.push({
        x, y: terrainHeight(x, z) + s0 * 0.62, z,
        s: s0 * rnd(1, 1.4), sy: s0 * rnd(0.6, 0.85),
        color: pick(C.foliage)
      });
      if (rand() < 0.07) addTree(x, z, false, rnd(0.7, 1.05));   // un arbre isolé dans la haie
    }

    // Massifs de fleurs (prairies + abords des maisons)
    for (let c = 0; c < 130; c++) {
      let cx, cz;
      if (c % 3 === 0 && buildings.length) {
        const b = buildings[Math.floor(rand() * buildings.length) % buildings.length];
        cx = b.x + rnd(-16, 16); cz = b.z + rnd(-16, 16);
      } else {
        const a = rand() * Math.PI * 2;
        const r = 30 + Math.sqrt(rand()) * 380;
        cx = Math.cos(a) * r; cz = Math.sin(a) * r;
      }
      if (Math.hypot(cx - LAKE.x, cz - LAKE.z) < LAKE.r || terrainHeight(cx, cz) < LAKE.level + 1) continue;
      const n = Math.floor(rnd(10, 26));
      const tint = pick(C.petals);
      for (let i = 0; i < n; i++) {
        const x = cx + rnd(-5.5, 5.5), z = cz + rnd(-5.5, 5.5);
        if (distToRoad(x, z) < 4.6) continue;
        flowers.push({
          x, y: terrainHeight(x, z) + 0.45, z,
          s: rnd(0.32, 0.62),
          color: rand() < 0.72 ? tint : pick(C.petals)
        });
      }
    }

    function addTree(x, z, conifer, scaleHint) {
      const y = terrainHeight(x, z);
      const s = (scaleHint || 1) * rnd(0.8, 1.5);
      if (conifer) {
        const col = pick(C.conifer);
        trunks.push({ x, y, z, s: s * 0.7, h: 1.5 * s });
        for (let k = 0; k < 3; k++) {
          cones.push({
            x, z, y: y + 1.6 * s + k * 2.0 * s,
            r: (2.5 - k * 0.62) * s, h: 3.2 * s, color: col, rot: rand() * Math.PI
          });
        }
        shadows.push({ x, y, z, r: 2.6 * s });
      } else {
        const col = rand() < 0.16 ? pick(C.blossom) : pick(C.foliage);
        trunks.push({ x, y, z, s, h: 2.6 * s });
        const blobs = Math.floor(rnd(2, 4));
        for (let k = 0; k < blobs; k++) {
          const bs = rnd(1.5, 2.5) * s;
          foliage.push({
            x: x + rnd(-1.1, 1.1) * s,
            y: y + 3.4 * s + rnd(-0.5, 1.0) * s,
            z: z + rnd(-1.1, 1.1) * s,
            s: bs, sy: bs * rnd(0.75, 1.0),
            color: col
          });
        }
        shadows.push({ x, y, z, r: 2.9 * s });
      }
    }
    // Meules de foin roulées dans les champs moissonnés
    const bales = [];
    for (let i = 0; i < 420 && bales.length < 90; i++) {
      const a = rand() * Math.PI * 2;
      const r = 60 + Math.sqrt(rand()) * 380;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (fieldKind(x, z).k < 0.74) continue;
      if (!isPlantable(x, z, 6)) continue;
      const y = terrainHeight(x, z);
      bales.push({ x, y, z, rot: rand() * Math.PI, s: rnd(0.85, 1.2) });
      shadows.push({ x, y, z, r: 1.6 });
    }
    scene.add(buildInstanced(
      new THREE.CylinderGeometry(1.15, 1.15, 1.8, 10),
      new THREE.MeshStandardMaterial({ color: 0xe0c07a, roughness: 1, flatShading: true }),
      bales, (o, d) => {
        d.position.set(o.x, o.y + 1.15 * o.s, o.z);
        d.scale.setScalar(o.s);
        d.rotation.set(0, o.rot, Math.PI / 2);
      }
    ));

    buildings.forEach((b) => shadows.push({ x: b.x, y: terrainHeight(b.x, b.z), z: b.z, r: b.r * 0.62 }));

    scene.add(buildInstanced(
      new THREE.CylinderGeometry(0.32, 0.5, 1, 6),
      new THREE.MeshStandardMaterial({ color: C.trunk, roughness: 1, flatShading: true }),
      trunks, (o, d) => {
        d.position.set(o.x, o.y + o.h * 0.5, o.z);
        d.scale.set(o.s, o.h, o.s);
        d.rotation.set(0, 0, 0);
      }
    ));
    scene.add(buildInstanced(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }),
      foliage, (o, d) => {
        d.position.set(o.x, o.y, o.z);
        d.scale.set(o.s, o.sy, o.s);
        d.rotation.set(rand() * 0.6, rand() * Math.PI * 2, rand() * 0.6);
      }, (o) => o.color
    ));
    scene.add(buildInstanced(
      new THREE.ConeGeometry(1, 1, 7),
      new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }),
      cones, (o, d) => {
        d.position.set(o.x, o.y, o.z);
        d.scale.set(o.r, o.h, o.r);
        d.rotation.set(0, o.rot, 0);
      }, (o) => o.color
    ));
    scene.add(buildInstanced(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ roughness: 0.7, flatShading: true }),
      flowers, (o, d) => {
        d.position.set(o.x, o.y, o.z);
        d.scale.setScalar(o.s);
        d.rotation.set(rand() * Math.PI, rand() * Math.PI, 0);
      }, (o) => o.color
    ));
    const shadowMesh = buildInstanced(
      new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0x37502c, transparent: true, opacity: 0.16, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3
      }),
      shadows, (o, d) => {
        d.position.set(o.x + 0.9, o.y + 0.12, o.z + 1.4);
        d.scale.set(o.r, 1, o.r * 0.85);
        d.rotation.set(0, 0, 0);
      }
    );
    scene.add(shadowMesh);

  }
})();
