// app.js - main wiring
const MQTT_BROKER = 'ws://broker.hivemq.com:8000/mqtt'; // public websocket endpoint
const CLIENT_ID = 'web_pem_' + Math.random().toString(16).slice(2,8);

let mqttClient = null;
let surrogateModel = null;
let warmModel = null;

const status = {
  mqtt: false,
  modelsLoaded: false
};

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
  mpcCostChart: document.getElementById('mpcCostChart'),
  perfChart: document.getElementById('perfChart')
};

function log(msg){
  const t = new Date().toLocaleTimeString();
  ui.log.value = `[${t}] ${msg}\n` + ui.log.value;
}

// MQTT connect
function connectMQTT(){
  mqttClient = mqtt.connect(MQTT_BROKER, { clientId: CLIENT_ID });
  mqttClient.on('connect', () => {
    status.mqtt = true;
    ui.mqttStatus.textContent = 'MQTT: connected';
    log('MQTT connected');
    // subscribe to important topics
    mqttClient.subscribe('arduino/sensors');
    mqttClient.subscribe('matlab/simulation');
    mqttClient.subscribe('arduino/water/alert');
    mqttClient.subscribe('power/mpc/decision');
    mqttClient.subscribe('web/mpc/status');
  });

  mqttClient.on('message', (topic, payload) => {
    try {
      const msg = payload.toString();
      handleMQTT(topic, msg);
    } catch(e){
      console.error(e);
    }
  });

  mqttClient.on('error', (err)=> {
    ui.mqttStatus.textContent = 'MQTT: error';
    log('MQTT error: '+ err.message);
  });

  mqttClient.on('close', ()=> {
    status.mqtt = false;
    ui.mqttStatus.textContent = 'MQTT: disconnected';
    log('MQTT disconnected');
  });
}

// handle incoming
function handleMQTT(topic, message){
  // lightweight parsing
  if(topic === 'arduino/sensors' || topic === 'matlab/simulation'){
    try {
      const obj = JSON.parse(message);
      if(obj.appliedCurrent !== undefined) ui.appliedCurrent.textContent = (obj.appliedCurrent).toFixed(1) + ' A';
      if(obj.grid_ratio !== undefined) ui.gridRatio.textContent = Math.round(obj.grid_ratio*100) + ' %';
      if(obj.pv_ratio !== undefined) ui.pvRatio.textContent = Math.round((1-obj.grid_ratio)*100) + ' %';
      if(obj.water_tank_l !== undefined){
        ui.waterTank.textContent = obj.water_tank_l.toFixed(2) + ' L';
        const scaled = Math.min(100, Math.round(obj.water_tank_l)); // assuming initial = 100
        ui.waterBar.value = scaled;
      }
      if(obj.o2_rate !== undefined) ui.o2Rate.textContent = (obj.o2_rate*3600).toFixed(2) + ' L/h';
      log(`RX ${topic}`);
    } catch(e){
      log(`RX ${topic} (non-JSON)`);
    }
    return;
  }

  if(topic === 'arduino/water/alert'){
    try {
      const obj = JSON.parse(message);
      log('WATER ALERT: ' + JSON.stringify(obj));
      // visual banner
      ui.waterStatus.textContent = `Water: ${obj.water_l.toFixed(2)} L - ALERT`;
      // optional: flash
      ui.waterStatus.style.color = 'orange';
      setTimeout(()=> ui.waterStatus.style.color = '', 5000);
    } catch(e){
      ui.waterStatus.textContent = 'Water alert';
    }
    return;
  }

  if(topic === 'power/mpc/decision'){
    log('MPC decision applied: ' + message);
  }

  if(topic === 'web/mpc/status'){
    log('WEB MPC: ' + message);
  }
}

// load TF models (surrogate + warmstart)
async function loadModels(){
  ui.modelStatus.textContent = 'Models: loading...';
  try {
    surrogateModel = await tf.loadLayersModel('/models/surrogate/model.json');
    warmModel = await tf.loadLayersModel('/models/warmstart/model.json');
    ui.modelStatus.textContent = 'Models: loaded';
    status.modelsLoaded = true;
    log('TF.js models loaded');
    // inform controllers
    HenMPC.setModels(warmModel);
    MPC.setModels(surrogateModel, warmModel);
  } catch(e){
    ui.modelStatus.textContent = 'Models: failed';
    log('Model load error: ' + e.message);
  }
}

// UI actions
ui.applyManual.addEventListener('click', ()=>{
  const val = Number(ui.manualCurrent.value);
  if(Number.isFinite(val)){
    // publish to pem/current (Arduino/MATLAB)
    if(mqttClient && status.mqtt) mqttClient.publish('web/control', 'manual');
    if(mqttClient && status.mqtt) mqttClient.publish('pem/current', String(val));
    log(`Published manual current ${val} A`);
  }
});

ui.requestMPC.addEventListener('click', async ()=>{
  // assemble state features: (o2_rate, water, current, grid_price, pv_price)
  // For demo we read UI values; in production pull from sensors or matlab topic
  const state = await getStateVector();
  log('Requesting MPC decision (web)');
  // call HenMPC compute path (upper layer) which will call MPC
  HenMPC.computeAndPublishMPC(state, mqttClient);
});

ui.refillWater.addEventListener('click', ()=>{
  if(mqttClient && status.mqtt){
    mqttClient.publish('web/water/command', 'refill');
    log('Published refill request');
  }
});

// small helper build state vector
async function getStateVector(){
  // attempt to parse UI fields; fallback defaults
  const current = parseFloat(ui.appliedCurrent.textContent) || 150;
  const water = parseFloat(ui.waterTank.textContent) || 100;
  const grid_ratio = parseFloat(ui.gridRatio.textContent) || 0.5;
  const pv_ratio = parseFloat(ui.pvRatio.textContent) || (1-grid_ratio);
  // fetch price/time from kenya-data.js helper
  const gridPrice = await KenyaData.getCurrentTariff(); // returns $/kWh
  const pvForecast = await KenyaData.getShortTermPVForecast(); // array or scalar
  // state vector example (matches training order - must match model)
  const state = [ current, water, grid_ratio, pv_ratio, gridPrice, pvForecast ];
  return state;
}

// basic charts
let costChart;
function initCharts(){
  const ctx = ui.mpcCostChart.getContext('2d');
  costChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{ label:'MPC cost', data: [], fill:false }]
    },
    options: { animation:false, responsive:true }
  });
}
function pushCost(cost){
  if(!costChart) return;
  costChart.data.labels.unshift(new Date().toLocaleTimeString());
  costChart.data.datasets[0].data.unshift(cost);
  if(costChart.data.labels.length>30){ costChart.data.labels.pop(); costChart.data.datasets[0].data.pop(); }
  costChart.update();
}

// initialize
window.addEventListener('load', async ()=>{
  initCharts();
  connectMQTT();
  await loadModels();
  log('App initialized');
});
