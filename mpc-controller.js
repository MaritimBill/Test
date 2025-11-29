/* mpc-controller.js
   Lightweight MPC that uses a JS surrogate model for fast rollouts and a local search optimizer.
   Surrogate: maps (current, grid_ratio, pv_ratio, water, gridPrice, pvForecast) -> [o2_rate(L/s), efficiency, purity, temp]
*/

// Surrogate net (tiny approximate physics + learned terms)
const Surrogate = (function(){
  // We'll implement a function combining physics (Faraday) + learned nonlinear correction.
  // Faraday baseline (L/s) for O2: current * 0.00021 (as used in MATLAB)
  function predict(input){
    // input: [current, grid_ratio, pv_ratio, water, gridPrice, pvForecast]
    const I = input[0];
    const gridRatio = input[1];
    const pvRatio = input[2];
    const water = Math.max(0.1, input[3]);
    const gridPrice = input[4];
    const pvForecast = input[5];

    // base production (L/s)
    let o2_base = I * 0.00021;
    // efficiency variation: modestly lower at very high current
    let eff = 0.85 - 0.0006*Math.max(0, I-120) + (Math.random()-0.5)*0.005;
    eff = Math.min(0.95, Math.max(0.65, eff));
    let o2_rate = o2_base * (0.9 + eff*0.2); // small scaling
    // purity degrades slightly when water low or extreme currents
    let purity = 99.7 - Math.max(0, (100-water)*0.02) - Math.max(0, (I-180)*0.01);
    purity = Math.max(95, Math.min(100, purity));
    // temperature increases with current
    let temp = 60 + (I-80)*0.08 + (Math.random()-0.5)*1.2;

    return [o2_rate, eff, purity, temp];
  }

  return { predict };
})();

const MPC = (function(){
  // local search optimizer around warm-start
  async function runWithWarmStart(state, warmDecision, mqttClient){
    // state: [current, water, grid_ratio, pv_ratio, gridPrice, pvForecast]
    // warmDecision: {grid_ratio, optimal_current}
    // initialize
    let best = { x: [warmDecision.grid_ratio, warmDecision.optimal_current], cost: await evalCost([warmDecision.grid_ratio, warmDecision.optimal_current], state) };
    // hill-climb
    for(let iter=0; iter<160; iter++){
      const cand = [
        Math.min(1, Math.max(0, best.x[0] + (Math.random()-0.5)*0.08)),
        Math.min(200, Math.max(50, best.x[1] + (Math.random()-0.5)*6.0))
      ];
      const c = await evalCost(cand, state);
      if(c < best.cost){ best = { x: cand.slice(), cost: c }; }
    }
    const decision = { grid_ratio: best.x[0], optimal_current: Math.round(best.x[1]*10)/10, cost: Math.round(best.cost*100)/100 };
    if(mqttClient) mqttClient.publish('power/mpc/decision', JSON.stringify(decision));
    if(mqttClient) mqttClient.publish('web/mpc/status', JSON.stringify({status:'OPTIMIZED',cost:decision.cost}));
    // return decision
    return decision;
  }

  async function evalCost(x, state){
    const I = x[1];
    const grid_ratio = x[0];
    const pv_ratio = 1 - grid_ratio;
    const input = [I, grid_ratio, pv_ratio, state[1] || 50, state[4] || 0.15, state[5] && state[5][0] ? state[5][0] : 50];
    const y = Surrogate.predict(input);
    const o2_rate = y[0];
    const purity = y[2];
    // economic cost: energy cost per second (I * 1.8 W approx -> kW), convert to $ (approx)
    const energyCost = (I * 1.8) / 1000.0 * (grid_ratio*state[4] + pv_ratio*0.02); // pv marginal cost small
    const revenue = o2_rate * 3600 * 0.02; // $ per L-hour approx (tune)
    const purityPenalty = purity < 99.5 ? Math.pow(99.5-purity,2) * 100 : 0;
    const smoothPenalty = Math.abs(I - state[0]) * 0.001;
    // objective: lower is better
    return energyCost - revenue + purityPenalty + smoothPenalty;
  }

  return { runWithWarmStart };
})();
