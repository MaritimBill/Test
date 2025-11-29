/* henmpc-controller.js
   Hierarchical Economic layer - produces reference trajectories and warm-starts for MPC.
   Uses warmModel (TF.js) to predict an initial control guess.
*/

const HenMPC = (function(){
  let warmModel = null;

  function setModels(m){
    warmModel = m;
  }

  // computeAndPublishMPC(state, mqttClient)
  // state: array of features expected by warmModel (must match training)
  async function computeAndPublishMPC(state, mqttClient){
    if(!warmModel){
      console.warn('Warm model not loaded - falling back to heuristic warm start');
      // simple heuristic warm-start: keep grid ratio same
      const fallback = { grid_ratio: 0.5, optimal_current: 150.0 };
      if(mqttClient) mqttClient.publish('power/mpc/decision', JSON.stringify(fallback));
      return fallback;
    }

    // build input tensor - ensure dims match training (1,D)
    const input = tf.tensor([state]);
    const raw = warmModel.predict(input);
    const arr = await raw.array();
    input.dispose();
    raw.dispose();

    // assume warm model outputs [grid_ratio, optimal_current] or trajectory
    const out = arr[0];
    const decision = {
      grid_ratio: Math.min(1, Math.max(0, out[0])),
      optimal_current: Math.min(200, Math.max(50, out[1]))
    };

    // publish warm-start decision for immediate actuator use
    if(mqttClient) mqttClient.publish('power/mpc/decision', JSON.stringify(decision));
    // also call lower-layer MPC with warm start to refine
    MPC.runWithWarmStart(state, decision, mqttClient).then(res => {
      // final decision published inside MPC
    }).catch(e=>console.error(e));

    return decision;
  }

  // expose
  return {
    setModels,
    computeAndPublishMPC
  };
})();
