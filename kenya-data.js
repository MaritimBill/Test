/* kenya-data.js
   Provides realistic synthetic PV & tariff & demand scenarios used by the browser MPC.
   - PV: sinusoidal daily pattern plus cloud noise and random dips
   - Tariff: time-of-day bands (lower at night)
   - Demand: hospital baseline + random peaks
*/

const KenyaData = (function(){
  // location/time helpers (assume Kenya local time)
  function hourOfDay() { return new Date().getHours() + new Date().getMinutes()/60; }

  // PV (kW) capacity assumption
  const PV_CAPACITY = 100; // kW plant (tune to your system)

  function pvNow() {
    const h = hourOfDay();
    // sun from 6 to 18 roughly: use smooth sinusoid
    const sunrise = 6, sunset = 18;
    if(h < sunrise || h > sunset) return 0;
    const t = (h - sunrise) / (sunset - sunrise); // 0..1
    let base = Math.sin(Math.PI * t) * PV_CAPACITY; // peak at midday
    // cloud noise & random transient dips
    base *= 0.6 + 0.4*Math.exp(-Math.abs(t-0.5)*6); // shaping
    base *= (0.85 + (Math.random()-0.5)*0.15); // small noise
    // occasional cloud dip
    if(Math.random() < 0.02) base *= (0.3 + Math.random()*0.6);
    return Math.max(0, base);
  }

  // Grid tariff $ per kWh (simple TOU)
  function tariffNow() {
    const h = new Date().getHours();
    if(h >= 0 && h < 6) return 0.08;
    if(h >=6 && h < 10) return 0.20;
    if(h >=10 && h < 16) return 0.12;
    if(h >=16 && h < 21) return 0.25;
    return 0.10;
  }

  // Hospital oxygen demand (L/min) simplified profile
  function demandNow() {
    const base = 20 + Math.sin(new Date().getHours()/24*2*Math.PI)*3; // baseline
    const noise = (Math.random()-0.5)*2;
    // occasional spike events
    const spike = Math.random() < 0.02 ? 20 + Math.random()*80 : 0;
    return Math.max(0, base + noise + spike);
  }

  // Provide short PV forecast array (next N steps, step = minutes)
  function pvForecast(minutes=60, step=10) {
    const out = [];
    const now = new Date();
    for(let t=0;t<minutes;t+=step){
      const future = new Date(now.getTime() + t*60000);
      const h = future.getHours() + future.getMinutes()/60;
      // use same shape
      const sunrise=6, sunset=18;
      if(h < sunrise || h > sunset) out.push(0);
      else {
        const tt = (h - sunrise)/(sunset-sunrise);
        let b = Math.sin(Math.PI*tt)*PV_CAPACITY;
        b *= 0.6 + 0.4*Math.exp(-Math.abs(tt-0.5)*6);
        // small forecast uncertainty
        b *= (0.9 + (Math.random()-0.5)*0.2);
        out.push(Math.max(0, b));
      }
    }
    return out;
  }

  return { pvNow, tariffNow, demandNow, pvForecast, PV_CAPACITY };
})();
