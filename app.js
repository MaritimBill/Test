// ----------------------
// app.js
// ----------------------

// MQTT connection settings
const brokerUrl = "wss://broker.hivemq.com:8884/mqtt";
const topicSensors = "pem/sensors";
let client;

// HTML elements
const appliedCurrentEl = document.getElementById("applied-current");
const gridRatioEl = document.getElementById("grid-ratio");
const pvRatioEl = document.getElementById("pv-ratio");
const waterTankEl = document.getElementById("water-tank");
const o2RateEl = document.getElementById("o2-rate");
const mpcCostEl = document.getElementById("mpc-cost");

// Charts
let currentChart, waterChart;

function initCharts() {
    const ctx1 = document.getElementById("currentChart").getContext("2d");
    currentChart = new Chart(ctx1, {
        type: "line",
        data: { labels: [], datasets: [{ label: "Current (A)", data: [], borderColor: "blue", fill: false }] },
        options: { responsive: true, plugins: { legend: { display: true } } }
    });

    const ctx2 = document.getElementById("waterChart").getContext("2d");
    waterChart = new Chart(ctx2, {
        type: "line",
        data: { labels: [], datasets: [{ label: "Water Tank (L)", data: [], borderColor: "green", fill: false }] },
        options: { responsive: true, plugins: { legend: { display: true } } }
    });
}

function updateCharts(sensorData) {
    const time = new Date().toLocaleTimeString();

    // Current chart
    currentChart.data.labels.push(time);
    currentChart.data.datasets[0].data.push(sensorData.applied_current);
    if (currentChart.data.labels.length > 20) {
        currentChart.data.labels.shift();
        currentChart.data.datasets[0].data.shift();
    }
    currentChart.update();

    // Water chart
    waterChart.data.labels.push(time);
    waterChart.data.datasets[0].data.push(sensorData.water_tank_l);
    if (waterChart.data.labels.length > 20) {
        waterChart.data.labels.shift();
        waterChart.data.datasets[0].data.shift();
    }
    waterChart.update();
}

function connectMQTT() {
    client = mqtt.connect(brokerUrl);

    client.on("connect", () => {
        console.log("Connected to MQTT broker");
        client.subscribe(topicSensors, (err) => {
            if (err) console.error("Subscribe error:", err);
        });
    });

    client.on("message", (topic, message) => {
        try {
            const data = JSON.parse(message.toString());
            updateUI(data);
            updateCharts(data);
        } catch (e) {
            console.error("Invalid JSON:", e);
        }
    });
}

function updateUI(data) {
    appliedCurrentEl.textContent = data.applied_current ?? "--";
    gridRatioEl.textContent = data.grid_ratio ?? "--";
    pvRatioEl.textContent = data.pv_ratio ?? "--";
    waterTankEl.textContent = data.water_tank_l ?? "--";
    o2RateEl.textContent = data.o2_rate ?? "--";
    mpcCostEl.textContent = data.mpc_cost ?? "--";
}

// Initialize charts & MQTT
initCharts();
connectMQTT();

// ----------------------
// Buttons
// ----------------------
document.getElementById("apply-current").onclick = () => {
    const value = Number(document.getElementById("manual-current").value);
    client.publish("pem/commands", JSON.stringify({ applied_current: value }));
};

document.getElementById("request-mpc").onclick = () => {
    client.publish("pem/commands", JSON.stringify({ request_mpc: true }));
};

document.getElementById("compute-mpc").onclick = () => {
    client.publish("pem/commands", JSON.stringify({ compute_mpc: true }));
};

document.getElementById("refill-water").onclick = () => {
    client.publish("pem/commands", JSON.stringify({ refill_water: true }));
};
