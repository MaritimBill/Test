/* mpc-controller.js
   Lightweight MPC that uses surrogateModel.predict() for fast rollouts.
   This implementation is intentionally compact: a hill-climb search around warm-start.
*/

const MPC = (function(){
  let surrogateModel = null;
  let warmModel = null;

  function setModels(sur, warm){
    surrogateModel = sur;
    warmModel = warm;
  }

  // runWithWarmStart(state, warmDecision, mqttClient)
  async function runWithWarmStart(state, warmDecision, mqttClient){
    // warmDecision: {grid_ratio, optimal_current}
    const horizon = 6; // short horizon for embedded/edge
    // control variable to optimize (grid_ratio scalar + applied current)
    let x0 = [warmDecision.grid_ratio, warmDecision.optimal_current];

    // simple local search: random perturbation hillclimb
    let best = { x: x0.slice(), cost: await evalCost(x0, state) };
    for(let iter=0; iter<120; ++iter){
      const cand = [
        Math.min(1, Math.max(0, best.x[0] + (Math.random()-0.5)*0.1)),
        Math.min(200, Math.max(50, best.x[1] + (Math.random()-0.5)*8.0))
      ];
      const cost = await evalCost(cand, state);
      if(cost < best.cost){
        best = { x: cand, cost };
      }
    }

    // final decision
    const decision = { grid_ratio: best.x[0], optimal_current: Math.round(best.x[1]*10)/10, cost: best.cost };
    if(mqttClient) mqttClient.publish('power/mpc/decision', JSON.stringify(decision));
    if(mqttClient) mqttClient.publish('web/mpc/status', JSON.stringify({status:'OPTIMIZED', cost:decision.cost}));
    console.log('MPC decision', decision);
    // push metric to chart
    if(window.pushCost) window.pushCost(decision.cost);
    return decision;
  }

  async function evalCost(x, state){
    // x = [grid_ratio, current]
    // form input for surrogate: must match training input order.
    // We'll assume surrogate takes [current, grid_ratio, pv_ratio, water, gridPrice, pvForecast] etc.
    const grid_ratio = x[0];
    const current = x[1];
    const pv_ratio = 1 - grid_ratio;
    // state likely contains some of these; build input consistent with your training
    const modelInput = tf.tensor([[ current, grid_ratio, pv_ratio, state[1] || 100, state[4] || 0.15, state[5] || 0.5 ]]);

    if(!surrogateModel){
      // fallback simple physics cost: energy cost + penalty for low water
      const energyCost = current * 1.8 * (grid_ratio*0.15 + pv_ratio*0.05)/1000.0;
      const waterPenalty = state[1] < 10 ? 1e3 : 0;
      modelInput.dispose();
      return energyCost + waterPenalty;
    }

    // surrogate returns predicted outputs (e.g. o2_rate, efficiency, purity, temp)
    const pred = surrogateModel.predict(modelInput);
    const arr = await pred.array();
    modelInput.dispose();
    pred.dispose();

    const y = arr[0]; // y[0]=o2_rate, y[1]=eff, y[2]=purity, y[3]=temp for example
    // cost function design: energy cost - value of O2 produced + penalty if purity < 99.5
    const o2_rate = y[0] || 0.0;
    const eff = y[1] || 0.85;
    const purity = y[2] || 99.5;
    const energyCost = current * 1.8 * (grid_ratio*0.15 + pv_ratio*0.05)/1000.0; // $ per sec-ish
    const revenue = o2_rate * 3600 * 0.02; // value per L (tune)
    const purityPenalty = purity < 99.5 ? Math.pow(99.5 - purity,2) * 1000 : 0;
    const smoothPenalty = Math.abs(current - state[0]) * 0.01;

    return energyCost - revenue + purityPenalty + smoothPenalty;
  }

  return {
    setModels,
    runWithWarmStart
  };
})();
