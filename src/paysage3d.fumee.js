/* =========================================================
   Paysage 3D — module « fumée »
   Un filet de fumée monte de quelques cheminées du hameau.
   Quelques-unes seulement : toutes les maisons n'ont pas de
   feu allumé, et un village dont chaque toit fume ressemble à
   une usine — c'est justement l'irrégularité qui le rend
   habité.

   Les voiles sont ceux des nuages, en tout petit : un plan
   tourné vers l'œil dont l'opacité est dessinée par un bruit
   fractal. Un volume à facettes ne ferait pas illusion, une
   fumée n'a pas d'arête.

   Facultatif : sans ce fichier, les toits restent froids.
   ========================================================= */
(function () {
  const paysage3d = (window.paysage3d = window.paysage3d || {});
  (paysage3d.modules = paysage3d.modules || []).push({
    nom: 'fumee',
    ordre: 45,
    creer
  });

  function creer(ctx) {
    const { THREE, scene, camera, C, village } = ctx;
    const { rand, rnd } = ctx.graine('fumee');

    /* ---------- Les foyers allumés ----------
       Le socle nomme les cheminées ; on les retrouve par là plutôt qu'en
       supposant la forme interne des maisons. */
    const cheminees = [];
    village.traverse((o) => { if (o.name === 'cheminee') cheminees.push(o); });
    if (!cheminees.length) return;

    /* Un feu sur trois environ, et jamais plus de cinq : au-delà le hameau
       fume plus qu'il n'habite.

       On tire un nombre, puis on choisit ce nombre de cheminées au hasard —
       plutôt que de filtrer la liste puis de la tronquer. Tronquer aurait
       gardé les premières construites, qui sont voisines sur la route : le
       hameau aurait eu un quartier allumé et un quartier éteint, au lieu de
       feux dispersés. Le tirage est celui de la graine du module, donc le
       même village rallume toujours les mêmes maisons. */
    const combien = Math.max(1, Math.min(5, Math.round(cheminees.length * 0.3)));
    const reste = cheminees.slice();
    const allumees = [];
    for (let i = 0; i < combien && reste.length; i++) {
      allumees.push(reste.splice((rand() * reste.length) | 0, 1)[0]);
    }

    /* ---------- Le voile ----------
       Même principe que les nuages, réglé pour une fumée : bords beaucoup
       plus délités, et une opacité qui s'éteint avec l'âge de la bouffée. */
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      uniforms: {
        chaud: { value: new THREE.Color(0x9a958c) },   // à la sortie, encore grise
        froid: { value: new THREE.Color(C.cloud) },    // en se diluant, blanche
        // Vue d'avion, à deux cents unités, une fumée à 0,5 se devine à peine.
        // 0,62 la rend perceptible sans qu'elle pèse : au-delà le hameau
        // fume comme une usine, ce qui est exactement l'effet à éviter.
        opacite: { value: 0.62 },
        brumeCouleur: { value: new THREE.Color(C.fog) },
        brumeNear: { value: 280 },
        brumeFar: { value: 700 }
      },
      vertexShader: `
        attribute float aSeed;
        attribute float aVie;
        varying vec2 vUv;
        varying float vSeed;
        varying float vVie;
        varying float vDist;
        void main() {
          vUv = uv; vSeed = aSeed; vVie = aVie;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vDist = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 chaud; uniform vec3 froid; uniform float opacite;
        uniform vec3 brumeCouleur; uniform float brumeNear; uniform float brumeFar;
        varying vec2 vUv; varying float vSeed; varying float vVie; varying float vDist;

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
          float d = length(c) * 2.0;
          float bord = smoothstep(1.0, 0.05, d);
          // Le bruit se déplace avec l'âge : la bouffée se déforme en montant
          // au lieu de se contenter de grandir.
          float n = fbm(vUv * 3.4 + vSeed + vVie * 1.6);
          float forme = bord * (0.45 + 0.9 * n);

          // Naît vite, s'éteint longuement — et le seuil monte avec l'âge :
          // la bouffée ne pâlit pas d'un bloc, elle se déchire par les bords.
          float naissance = smoothstep(0.0, 0.10, vVie);
          float mort = 1.0 - smoothstep(0.25, 1.0, vVie);
          float a = smoothstep(0.30 + vVie * 0.34, 0.92, forme) * opacite * naissance * mort;

          vec3 col = mix(chaud, froid, smoothstep(0.0, 0.55, vVie));

          float brume = smoothstep(brumeNear, brumeFar, vDist);
          col = mix(col, brumeCouleur, brume * 0.9);
          a *= 1.0 - brume * 0.65;

          if (a < 0.004) discard;
          gl_FragColor = vec4(col, a);
        }`
    });

    /* ---------- Les bouffées ----------
       Une bouffée est un plan qui monte, grossit et s'efface, puis repart du
       feu. Elles sont décalées dans le temps les unes des autres : c'est ce
       décalage qui fait un filet continu plutôt qu'un chapelet de ronds. */
    const BOUFFEES = 7;
    const fumees = new THREE.Group();
    const bouffees = [];

    // Un vent commun, très faible : les filets penchent tous du même côté,
    // sinon le hameau aurait autant de météos que de cheminées.
    const VENT = { x: rnd(0.5, 1.1), z: rnd(-0.5, 0.5) };

    const monde = new THREE.Vector3();
    for (const chem of allumees) {
      chem.getWorldPosition(monde);
      // Le haut du conduit : la boîte fait 2,6 de haut, son origine est au
      // centre. La fumée sort donc un peu au-dessus.
      const base = { x: monde.x, y: monde.y + 1.5, z: monde.z };
      const force = rnd(0.75, 1.25);       // tous les feux ne tirent pas pareil

      for (let i = 0; i < BOUFFEES; i++) {
        const geo = new THREE.PlaneGeometry(1, 1);
        const n = geo.attributes.position.count;
        geo.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(n).fill(rnd(0, 40)), 1));
        geo.setAttribute('aVie', new THREE.BufferAttribute(new Float32Array(n), 1));

        const m = new THREE.Mesh(geo, mat);
        const b = {
          m, base,
          // Décalées d'un tour complet réparti : le filet est continu.
          vie: i / BOUFFEES,
          duree: rnd(4.6, 6.8) / force,
          montee: rnd(9, 14) * force,
          taille0: rnd(1.0, 1.5),
          taille1: rnd(4.5, 6.5) * force,
          balance: rnd(0.6, 1.4),          // l'ondulation propre du filet
          phase: rand() * Math.PI * 2
        };
        bouffees.push(b);
        fumees.add(m);
      }
    }
    scene.add(fumees);

    function poser(b) {
      const v = b.vie;
      // La montée ralentit : la fumée perd sa poussée en se refroidissant.
      const h = (1 - Math.pow(1 - v, 1.7)) * b.montee;
      const taille = b.taille0 + (b.taille1 - b.taille0) * v;

      // Le vent ne prend que progressivement : au ras du conduit le filet est
      // droit, il ne se couche qu'en s'élevant.
      const prise = v * v;
      b.m.position.set(
        b.base.x + VENT.x * b.montee * prise * 0.42
          + Math.sin(v * 5.2 + b.phase) * b.balance * v,
        b.base.y + h,
        b.base.z + VENT.z * b.montee * prise * 0.42
          + Math.cos(v * 4.1 + b.phase) * b.balance * v
      );
      b.m.scale.set(taille, taille, 1);

      const a = b.m.geometry.attributes.aVie;
      a.array.fill(v);
      a.needsUpdate = true;
    }

    bouffees.forEach(poser);

    return {
      animer(dt) {
        mat.uniforms.brumeNear.value = scene.fog.near;
        mat.uniforms.brumeFar.value = scene.fog.far;

        for (const b of bouffees) {
          b.vie += dt / b.duree;
          if (b.vie >= 1) {
            b.vie -= 1;
            // Une bouffée qui repart n'est pas la précédente : on retire ses
            // dés, sinon le filet se met à battre la mesure.
            b.duree = rnd(4.6, 6.8);
            b.montee = rnd(9, 14);
            b.taille1 = rnd(4.5, 6.5);
            b.phase = rand() * Math.PI * 2;
            const s = b.m.geometry.attributes.aSeed;
            s.array.fill(rnd(0, 40));
            s.needsUpdate = true;
          }
          poser(b);
          // Billboard autour de la verticale, comme les nuages : le voile se
          // tourne vers l'œil sans jamais basculer.
          b.m.rotation.y = Math.atan2(
            camera.position.x - b.m.position.x,
            camera.position.z - b.m.position.z
          );
        }
      },
      entree(fondu) {
        fondu(mat.uniforms.opacite, 'value', 0, 4.5, 0);
      }
    };
  }
})();
