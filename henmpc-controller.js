/* henmpc-controller.js
   Upper-layer HE-NMPC: warm-start generator (neural net) + economic scheduling.
   This implementation is self-contained: the ANN is coded as small weight matrices.
   It returns a warm initial guess (grid_ratio, optimal_current).
*/

// small helper NN ops
function matVecMul(W, x){
  const y = new Array(W.length).fill(0);
  for(let i=0;i<W.length;i++){
    let s = 0;
    for(let j=0;j<x.length;j++) s += W[i][j]*x[j];
    y[i] = s;
  }
  return y;
}
function addBias(v, b){ return v.map((val,i)=>val + (b[i]||0)); }
function relu(v){ return v.map(x=> Math.max(0,x)); }

// Warm-start ANN (weights tuned for sensible behavior, small network)
const WarmNet = (function(){
  // Input: [current(A), water(L), grid_ratio, pv_ratio, gridPrice($/kWh), pvForecast(kW)]
  // Output: [grid_ratio_guess, optimal_current_guess]
  const W1 = [
    [0.004,  -0.01,  0.6,  -0.2, -1.5,  0.01],
    [0.01,    0.0,  -0.4,   0.8, -0.5, -0.02],
    [0.002,  -0.005, 0.1,  0.05, -0.2,  0.01]
  ];
  const b1 = [0.1, 0.2, 0.05];
  const W2 = [
    [1.2, -0.6, 0.1],
    [80.0, -10.0, 5.0]
  ];
  const b2 = [0.0, 120.0];

  function predict(input){
    // normalize roughly
    const inNorm = [
      input[0]/200.0,      // current /200
      input[1]/100.0,      // water /100
      input[2],            // grid_ratio
      input[3],            // pv_ratio
      input[4]/0.5,        // gridPrice /0.5
      input[5]/100.0       // pvForecast /100kW
    ];
    let h = matVecMul(W1, inNorm);
    h = addBias(h,b1);
    h = relu(h);
    let out = matVecMul(W2, h);
    out = addBias(out, b2);
    // postprocess
    const grid_ratio = Math.min(1, Math.max(0, out[0]));
    const optimal_current = Math.min(200, Math.max(50, out[1]));
    return [grid_ratio, optimal_current];
  }

  return { predict };
})();

const HenMPC = (function(){
  async function computeWarmStart(state){
    // state: [current, water, grid_ratio, pv_ratio, gridPrice, pvForecast]
    return WarmNet.predict(state);
  }

  // schedule step: produces a reference and warm start then calls lower-layer MPC
  async function scheduleAndRun(state, mqttClient){
    const warm = await computeWarmStart(state);
    // publish warm immediate decision
    const warmDecision = { grid_ratio: warm[0], optimal_current: Math.round(warm[1]*10)/10 };
    if(mqttClient) mqttClient.publish('power/mpc/decision', JSON.stringify(warmDecision));
    // call the lower-layer optimizer to refine
    const refined = await MPC.runWithWarmStart(state, warmDecision, mqttClient);
    return refined;
  }

  return { computeWarmStart, scheduleAndRun };
})();
