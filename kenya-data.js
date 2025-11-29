/* kenya-data.js
   small helper to fetch realistic solar and tariff data.
   NOTE: Replace with server-side proxies for production (avoid CORS issues on NASA API).
*/

const KenyaData = (function(){
  // Example: a lightweight wrapper that uses NASA POWER daily API for a given lat/lon.
  async function fetchNasaPowerDaily(lat= -1.2921, lon=36.8219, start='20220101', end='20221231'){
    // NOTE: CORS may block direct calls; in dev you can use a small proxy or run locally.
    const base = 'https://power.larc.nasa.gov/api/temporal/daily/point';
    const params = `?parameters=ALLSKY_SFC_SW_DWN,ALLSKY_SFC_PAR&community=RE&longitude=${lon}&latitude=${lat}&start=${start}&end=${end}&format=JSON`;
    const url = base + params;
    const r = await fetch(url);
    if(!r.ok) throw new Error('NASA POWER fetch failed: ' + r.status);
    const json = await r.json();
    return json;
  }

  // small sample tariff getter (replace with your live API)
  async function getCurrentTariff(){
    // realistic default: 0.15 $/kWh for grid; you can adapt using time-of-use table
    return 0.15;
  }

  // tiny PV short-term forecast stub (in production replace with PV forecast)
  async function getShortTermPVForecast(){
    // return normalized expected PV power (0..1)
    return 0.6;
  }

  // quick sample dataset for demo/training (synthetic)
  function sampleTrainingBatch(n=1000){
    const X = [];
    const Y = [];
    for(let i=0;i<n;i++){
      const current = 80 + Math.random()*80; // 80-160A
      const grid_ratio = Math.random();
      const pv = Math.random()*200; // kW
      const water = 30 + Math.random()*80;
      // Faraday-based O2 rate approx: liters per second per amp scale (demo)
      const o2_rate = current * 0.00021 * (0.8 + 0.4*Math.random()); // match your matlab scaling
      const eff = 0.8 + 0.15*Math.random();
      const purity = 99.5 - 0.1*Math.random();
      X.push([current, grid_ratio, 1-grid_ratio, water, 0.15, pv]);
      Y.push([o2_rate, eff, purity, 60 + Math.random()*10]);
    }
    return {X,Y};
  }

  return { fetchNasaPowerDaily, getCurrentTariff, getShortTermPVForecast, sampleTrainingBatch };
})();
