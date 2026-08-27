/* =========================================================
   Paysage 3D — module « nuages »
   Des voiles orientés vers l'œil, dont l'opacité est dessinée
   par un bruit fractal. Ils dérivent avec le vent et se
   diluent dans la brume du lointain.

   Facultatif : sans ce fichier, le ciel reste nu.
   ========================================================= */
(function () {
  const paysage3d = (window.paysage3d = window.paysage3d || {});
  (paysage3d.modules = paysage3d.modules || []).push({
    nom: 'nuages',
    ordre: 40,
    creer
  });

  function creer(ctx) {
    const { THREE, scene, camera, C } = ctx;
    const { rand, rnd, pick } = ctx.graine('nuages');

    /* ---------- Nuages ---------- */
    // Des volumes à facettes ne font jamais illusion : un nuage n'a pas d'arête.
    // On empile donc des voiles orientés vers l'œil, dont l'opacité est dessinée
    // par un bruit fractal — bords qui se délitent, ventre plus gris que les
    // têtes, et dilution progressive dans la brume du lointain.
    const clouds = new THREE.Group();
    const cloudMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      uniforms: {
        bas: { value: new THREE.Color(0xb9c7d2) },
        haut: { value: new THREE.Color(0xfffdf8) },
        opacite: { value: 0.6 },   // ténu : monter à ~0.85 pour des nuages plus denses
        brumeCouleur: { value: new THREE.Color(C.fog) },
        brumeNear: { value: 280 },
        brumeFar: { value: 700 }
      },
      vertexShader: `
        attribute float aSeed;
        attribute float aPlat;
        varying vec2 vUv;
        varying float vSeed;
        varying float vPlat;
        varying float vDist;
        void main() {
          vUv = uv;
          vSeed = aSeed;
          vPlat = aPlat;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vDist = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 bas; uniform vec3 haut; uniform float opacite;
        uniform vec3 brumeCouleur; uniform float brumeNear; uniform float brumeFar;
        varying vec2 vUv; varying float vSeed; varying float vPlat; varying float vDist;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
        float bruit(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                     mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        float fbm(vec2 p) {
          float v = 0.0, a = 0.5;
          for (int i = 0; i < 4; i++) { v += a * bruit(p); p *= 2.07; a *= 0.5; }
          return v;
        }

        void main() {
          vec2 c = vUv - 0.5;
          // Cumulus : masse ronde et dense. Traînée : longue et diluée.
          float d = length(vec2(c.x, c.y * mix(1.7, 1.3, vPlat))) * 2.0;
          float bord = smoothstep(1.0, 0.06, d);
          float n = fbm(vUv * mix(4.2, 3.0, vPlat) + vSeed);
          float forme = bord * (0.55 + 0.8 * n);
          float a = smoothstep(mix(0.42, 0.40, vPlat), mix(0.95, 0.93, vPlat), forme) * opacite;
          // Le cumulus a le ventre plat : on tranche net sous la masse
          a *= mix(1.0, smoothstep(0.0, 0.2, vUv.y + n * 0.14 - 0.08), vPlat);

          // Le ventre est gris, les têtes sont blanches
          vec3 col = mix(bas, haut, smoothstep(0.05, 0.8, vUv.y + n * 0.3 - 0.12));

          // Dilution dans la brume : les nuages du fond s'effacent
          float brume = smoothstep(brumeNear, brumeFar, vDist);
          col = mix(col, brumeCouleur, brume * 0.9);
          a *= 1.0 - brume * 0.65;

          if (a < 0.004) discard;
          gl_FragColor = vec4(col, a);
        }`
    });

    // Deux familles de voiles : ventre plat pour les cumulus, dilués pour les
    // traînées. Chacun sa graine de bruit, pour qu'aucun ne se ressemble.
    const faireVoiles = (plat, n) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        const geo = new THREE.PlaneGeometry(1, 1);
        const c = geo.attributes.position.count;
        geo.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(c).fill(rnd(0, 40)), 1));
        geo.setAttribute('aPlat', new THREE.BufferAttribute(new Float32Array(c).fill(plat), 1));
        out.push(geo);
      }
      return out;
    };
    const voilesCumulus = faireVoiles(1, 10);
    const voilesTrainee = faireVoiles(0, 6);

    function makeCloud(taille, fin) {
      const g = new THREE.Group();
      const n = Math.floor(fin ? rnd(3, 6) : rnd(5, 9));
      for (let k = 0; k < n; k++) {
        const q = new THREE.Mesh(pick(fin ? voilesTrainee : voilesCumulus), cloudMat);
        const l = (fin ? rnd(80, 150) : rnd(70, 130)) * taille;
        // Les bourgeons du haut sont plus petits et resserrés vers le centre
        const haut = fin ? 0 : Math.max(0, (k - 3) / 5);
        const ll = l * (1 - haut * 0.42);
        q.scale.set(ll, ll * (fin ? rnd(0.15, 0.24) : rnd(0.42, 0.60)), 1);
        q.position.set(
          rnd(-0.5, 0.5) * l * (fin ? 1.2 : 0.9) * (1 - haut * 0.5),
          (fin ? rnd(-0.1, 0.1) * l * 0.3 : (rnd(-0.04, 0.06) + haut * 0.3) * l),
          rnd(-6, 6)
        );
        g.add(q);
      }
      return g;
    }

    for (let i = 0; i < 22; i++) {
      const loin = rand() < 0.45;
      const fin = rand() < 0.3;                    // traînées hautes et étirées
      const c = makeCloud(loin ? rnd(1.2, 1.9) : rnd(0.75, 1.15), fin);
      const a = rand() * Math.PI * 2;
      const r = loin ? rnd(430, 720) : rnd(190, 420);
      c.position.set(Math.cos(a) * r, fin ? rnd(255, 340) : rnd(150, 245), Math.sin(a) * r);
      c.userData.drift = rnd(0.6, 1.9) * (rand() < 0.5 ? -1 : 1);
      clouds.add(c);
    }
    scene.add(clouds);


    return {
      animer(dt) {
        // Le brouillard bouge pendant le décollage : les nuages suivent.
        cloudMat.uniforms.brumeNear.value = scene.fog.near;
        cloudMat.uniforms.brumeFar.value = scene.fog.far;
        clouds.children.forEach((c) => {
          c.position.x += c.userData.drift * dt;
          if (c.position.x > 700) c.position.x = -700;
          if (c.position.x < -700) c.position.x = 700;
          // Billboard autour de la verticale : le nuage se tourne vers l'œil
          // sans jamais basculer, son ventre reste en bas.
          c.rotation.y = Math.atan2(camera.position.x - c.position.x, camera.position.z - c.position.z);
        });
      },
      entree(fondu) {
        fondu(cloudMat.uniforms.opacite, 'value', 0, 4.5, 0);
      }
    };
  }
})();
