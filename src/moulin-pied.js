/* =========================================================
   Le moulin du pied de page — mise en veille

   Le moulin lui-même est du balisage, et ses ailes tournent par
   une animation CSS : sans ce fichier, il tourne quand même.

   Ce script ne fait qu'une chose, et elle est négative : tant
   qu'on n'est pas descendu jusqu'au moulin, il l'endort. Une
   animation hors de l'écran ne se voit pas, mais elle se paie —
   c'est la même règle que pour le décor du haut, qui coupe sa
   boucle de rendu dès que le hero sort du champ.
   ========================================================= */
(function () {
  'use strict';

  const moulin = document.querySelector('.moulin-pied');
  if (!moulin || !('IntersectionObserver' in window)) return;

  // On endort d'abord : la page s'ouvre tout en haut, le moulin est loin.
  // C'est aussi pour cela que la classe est posée ici et non dans le HTML —
  // sans script, personne ne l'endort, et les ailes tournent.
  moulin.classList.add('moulin-pied--dort');

  let enVue = false, ongletVisible = !document.hidden;
  const regler = () => moulin.classList.toggle('moulin-pied--dort', !(enVue && ongletVisible));

  new IntersectionObserver((entrees) => {
    enVue = entrees[0].isIntersecting;
    regler();
  }, { threshold: 0 }).observe(moulin);

  document.addEventListener('visibilitychange', () => {
    ongletVisible = !document.hidden;
    regler();
  });
})();
