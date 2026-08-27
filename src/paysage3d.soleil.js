/* =========================================================
   Paysage 3D — module « soleil »
   Un disque net noyé dans sa propre diffusion, toujours
   tourné vers l'œil, et qui s'allume pendant le décollage.

   Facultatif : sans ce fichier, le ciel garde son dégradé et
   sa lumière — il n'y a simplement plus d'astre à regarder.
   ========================================================= */
(function () {
  const paysage3d = (window.paysage3d = window.paysage3d || {});
  (paysage3d.modules = paysage3d.modules || []).push({
    nom: 'soleil',
    ordre: 30,
    creer
  });

  function creer(ctx) {
    const { THREE, scene, camera, sunPos } = ctx;

    /* ---------- Soleil ---------- */
    // Pas de rayons dessinés : un disque net noyé dans sa propre diffusion,
    // comme un vrai soleil vu à travers l'atmosphère. Toujours face à l'œil.
    const sunGroup = new THREE.Group();
    sunGroup.position.copy(sunPos);
    const sunMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: {
        coeur: { value: new THREE.Color(0xfffdf2) },
        bord: { value: new THREE.Color(0xffd873) },
        halo: { value: new THREE.Color(0xffc978) },
        force: { value: 1 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 coeur; uniform vec3 bord; uniform vec3 halo;
        uniform float force; varying vec2 vUv;
        void main() {
          float d = length(vUv - 0.5) * 2.0;
          float disque = smoothstep(0.130, 0.100, d);          // le bord du disque
          float couronne = smoothstep(0.34, 0.11, d);           // la couronne serrée
          float diffusion = pow(max(0.0, 1.0 - d), 4.0);        // la lumière diffusée
          vec3 col = mix(halo, mix(bord, coeur, disque), couronne);
          float a = clamp(disque + couronne * 0.42 + diffusion * 0.46, 0.0, 1.0);
          gl_FragColor = vec4(col, a * force);
        }`
    });
    const sunDisc = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), sunMat);
    sunGroup.add(sunDisc);
    scene.add(sunGroup);


    return {
      // Le disque reste face à la caméra, sinon on le verrait par la tranche.
      animer() {
        sunGroup.lookAt(camera.position);
      },
      // Il s'allume avec le décollage, un peu après le reste.
      entree(fondu) {
        fondu(sunMat.uniforms.force, 'value', 0, 3.4, 0.4);
      }
    };
  }
})();
