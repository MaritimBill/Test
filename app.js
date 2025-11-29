/* app.js
   Main web app wiring. Self-contained.
   - Connects to MQTT broker (ws) and subscribes to arduino/matlab topics
   - Publishes `pem/current` and `power/mpc/decision`
   - Uses KenyaData to supply realistic features for MPC
*/

const MQTT_BROKER_WS = 'ws://broker.hivemq.com:8000/mqtt';
const CLIENT_ID = 'web_he_nmpc_' + Math.random().toString(16).slice(2,8);

let mqttClient = null;

const ui = {
  mqttStatus: document.getElementById('mqttStatus'),
  modelStatus: document.getElementById('modelStatus'),
  waterStatus: document.getElementById('waterStatus'),
  appliedCurrent: document.getElementById('appliedCurrent'),
  gridRatio: document.getElementById('gridRatio'),
  pvRatio: document.getElementById('pvRatio'),
  waterTank: document.getElementById('waterTank'),
  waterBar: document.getElementById('waterBar'),
  o2Rate: document.getElementById('o2Rate'),
  log: document.getElementById('log'),
  modeSelect: document.getElementById('modeSelect'),
  manualCurrent: document.getElementById('manualCurrent'),
  applyManual: document.getElementById('applyManual'),
  requestMPC: document.getElementById('requestMPC'),
  refillWater: document.getElementById('refillWater'),
  lastCost: document.getElementById('lastCost'),
  mpcCostChart: document.getElementById('mpcCostChart'),
  perfChart: document.getElementById('perfChart')
};

function log(msg){
  const t = new Date().toLocaleTimeString();
  ui.log.value = `[${t}] ${msg}\n` + ui.log.value;
}

function connectMQTT(){
  // use MQTT over websockets via HiveMQ public broker
  mqttClient = mqtt.connect(MQTT_BROKER_WS, { clientId: CLIENT_ID });
  mqttClient.on('connect', ()=> {
    ui.mqttStatus.textContent = 'MQTT: connected';
    log('MQTT connected');
    mqttClient.subscribe('arduino/sensors');
    mqttClient.subscribe('matlab/simulation');
    mqttClient.subscribe('arduino/water/alert');
    mqttClient.subscribe('power/mpc/decision');
    mqttClient.subscribe('web/mpc/status');
  });
  mqttClient.on('message', (topic, payload) => {
    try { handleMQTT(topic, payload.toString()); } catch(e){ console.error(e); }
  });
  mqttClient.on('error', err => { log('MQTT error: ' + err.message); ui.mqttStatus.textContent = 'MQTT: error'; });
  mqttClient.on('close', ()=> { log('MQTT closed'); ui.mqttStatus.textContent = 'MQTT: disconnected'; });
}

function handleMQTT(topic, message){
  if(topic === 'arduino/sensors' || topic === 'matlab/simulation'){
    try {
      const obj = JSON.parse(message);
      if(obj.appliedCurrent !== undefined) ui.appliedCurrent.textContent = obj.appliedCurrent.toFixed(1) + ' A';
      if(obj.grid_ratio !== undefined) ui.gridRatio.textContent = Math.round(obj.grid_ratio*100) + ' %';
      if(obj.pv_ratio !== undefined) ui.pvRatio.textContent = Math.round(obj.pv_ratio*100) + ' %';
      if(obj.water_tank_l !== undefined){
        ui.waterTank.textContent = obj.water_tank_l.toFixed(2) + ' L';
        ui.waterBar.value = Math.min(100, Math.round(obj.water_tank_l));
      }
      if(obj.o2_rate !== undefined) ui.o2Rate.textContent = (obj.o2_rate*3600).toFixed(2) + ' L/h';
      log(`RX ${topic}`);
    } catch(e){
      log(`RX ${topic} (non-json)`);
    }
    return;
  }

  if(topic === 'arduino/water/alert'){
    const obj = JSON.parse(message);
    log('WATER ALERT: ' + message);
    ui.waterStatus.textContent = `Water: ${obj.water_l.toFixed(2)} L - ALERT`;
    ui.waterStatus.style.color = 'orange';
    setTimeout(()=> ui.waterStatus.style.color='', 5000);
    return;
  }

  if(topic === 'power/mpc/decision'){
    log('MPC decision: ' + message);
    try{ const d=JSON.parse(message); ui.lastCost.textContent = d.cost||'--'; }catch{}
    return;
  }

  if(topic === 'web/mpc/status'){
    log('WEB MPC: ' + message);
  }
}

// assemble state vector for ANN
async function buildStateVector(){
  const current = parseFloat(ui.appliedCurrent.textContent) || 150;
  const water = parseFloat(ui.waterTank.textContent) || 100;
  const grid_ratio = (ui.gridRatio.textContent && ui.gridRatio.textContent.includes('%')) ? parseFloat(ui.gridRatio.textContent)/100 : 0.5;
  const pv_ratio = 1 - grid_ratio;
  const gridPrice = KenyaData.tariffNow();
  const pvForecastArr = KenyaData.pvForecast(60, 10); // next 60 min per 10min
  return [ current, water, grid_ratio, pv_ratio, gridPrice, pvForecastArr ];
}

// UI actions
ui.applyManual.addEventListener('click', ()=> {
  const val = Number(ui.manualCurrent.value);
  if(!Number.isFinite(val)) return;
  if(mqttClient) mqttClient.publish('pem/current', String(val));
  if(mqttClient) mqttClient.publish('web/control', 'manual');
  log('Sent manual current ' + val);
});

ui.requestMPC.addEventListener('click', async ()=> {
  const state = await buildStateVector();
  log('Requesting HENMPC schedule & warm-start');
  const res = await HenMPC.scheduleAndRun(state, mqttClient);
  log('HENMPC result: ' + JSON.stringify(res));
});

ui.refillWater.addEventListener('click', ()=> {
  if(mqttClient) mqttClient.publish('web/water/command', 'refill');
  log('Published refill command');
});

// simple charts (cost history)
let costChart;
function initCharts(){
  const ctx = ui.mpcCostChart.getContext('2d');
  costChart = new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets: [{ label:'MPC cost', data: [], borderColor:'#00b3ff', fill:false }]},
    options: { animation:false, responsive:true, scales:{ x:{display:false} } }
  });
}
function pushCost(val){
  if(!costChart) return;
  costChart.data.labels.unshift(new Date().toLocaleTimeString());
  costChart.data.datasets[0].data.unshift(val);
  if(costChart.data.labels.length>30){ costChart.data.labels.pop(); costChart.data.datasets[0].data.pop(); }
  costChart.update();
}

// initialize everything
window.addEventListener('load', async ()=>{
  initCharts();
  connectMQTT();
  log('App ready — connecting to MQTT and services');
  // periodic auto-scheduling every 30s (simulate continuous planner)
  setInterval(async ()=>{
    if(!mqttClient || !mqttClient.connected) return;
    const state = await buildStateVector();
    const res = await HenMPC.scheduleAndRun(state, mqttClient);
    if(res && res.cost) pushCost(res.cost);
  }, 30000);
});

// expose pushCost for MPC to call
window.pushCost = pushCost;
