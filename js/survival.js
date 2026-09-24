/* STUB — substituído na etapa "Itens & Sobrevivência" */
(function () {
  const G = window.G;
  G.survival = {
    initStats(p) { p.stats = { hunger: 0, thirst: 0, fatigue: 0, endurance: 1, panic: 0, stress: 0, boredom: 0, pain: 0, wet: 0, infection: 0, sickness: 0, temperature: 37 }; p.injuries = []; },
    update(p, dtMin, dt) {},
    moodles(p) { return []; },
  };
})();
