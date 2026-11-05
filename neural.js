// ═══════════════════════════════════════════════════════════════
//  RESEAU DE NEURONES — Prediction Loto Bonheur
//  Feedforward NN pur Node.js (zero dependance)
//  Inputs: 12 features par numero | Output: proba d'apparition
// ═══════════════════════════════════════════════════════════════

const fs = require("fs");
const path = require("path");
const { loadDB } = require("./db");
const { computeCriteriaTops, DRAW_CATEGORIES, getCategoryForType } = require("./apprentissage");

const NUM_RANGE = 90;
const MODEL_PATH = path.join(__dirname, "neural_model.json");

// ═══ MINI NEURAL NETWORK ═══
class NeuralNet {
  constructor(inputSize, hiddenSize, outputSize) {
    this.inputSize = inputSize;
    this.hiddenSize = hiddenSize;
    this.outputSize = outputSize;
    this.wh = this._randomMatrix(hiddenSize, inputSize);
    this.bh = new Float64Array(hiddenSize);
    this.wo = this._randomMatrix(outputSize, hiddenSize);
    this.bo = new Float64Array(outputSize);
  }

  _randomMatrix(rows, cols) {
    const m = [];
    const scale = Math.sqrt(2 / cols);
    for (let i = 0; i < rows; i++) {
      m[i] = new Float64Array(cols);
      for (let j = 0; j < cols; j++) m[i][j] = (Math.random() - 0.5) * scale;
    }
    return m;
  }

  _relu(x) { return x > 0 ? x : 0.01 * x; }
  _reluDeriv(x) { return x > 0 ? 1 : 0.01; }
  _sigmoid(x) { return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, x)))); }

  forward(input) {
    const hidden = new Float64Array(this.hiddenSize);
    for (let i = 0; i < this.hiddenSize; i++) {
      let sum = this.bh[i];
      for (let j = 0; j < this.inputSize; j++) sum += this.wh[i][j] * input[j];
      hidden[i] = this._relu(sum);
    }
    const output = new Float64Array(this.outputSize);
    for (let i = 0; i < this.outputSize; i++) {
      let sum = this.bo[i];
      for (let j = 0; j < this.hiddenSize; j++) sum += this.wo[i][j] * hidden[j];
      output[i] = this._sigmoid(sum);
    }
    return { hidden, output };
  }

  train(input, target, lr) {
    const { hidden, output } = this.forward(input);
    const dOutput = new Float64Array(this.outputSize);
    for (let i = 0; i < this.outputSize; i++) {
      dOutput[i] = (output[i] - target[i]) * output[i] * (1 - output[i]);
    }
    const dHidden = new Float64Array(this.hiddenSize);
    for (let j = 0; j < this.hiddenSize; j++) {
      let sum = 0;
      for (let i = 0; i < this.outputSize; i++) sum += dOutput[i] * this.wo[i][j];
      let rawH = this.bh[j];
      for (let k = 0; k < this.inputSize; k++) rawH += this.wh[j][k] * input[k];
      dHidden[j] = sum * this._reluDeriv(rawH);
    }
    for (let i = 0; i < this.outputSize; i++) {
      for (let j = 0; j < this.hiddenSize; j++) this.wo[i][j] -= lr * dOutput[i] * hidden[j];
      this.bo[i] -= lr * dOutput[i];
    }
    for (let i = 0; i < this.hiddenSize; i++) {
      for (let j = 0; j < this.inputSize; j++) this.wh[i][j] -= lr * dHidden[i] * input[j];
      this.bh[i] -= lr * dHidden[i];
    }
    let loss = 0;
    for (let i = 0; i < this.outputSize; i++) {
      loss -= target[i] * Math.log(output[i] + 1e-10) + (1 - target[i]) * Math.log(1 - output[i] + 1e-10);
    }
    return loss / this.outputSize;
  }

  save(filepath) {
    const data = {
      inputSize: this.inputSize, hiddenSize: this.hiddenSize, outputSize: this.outputSize,
      wh: this.wh.map(r => Array.from(r)), bh: Array.from(this.bh),
      wo: this.wo.map(r => Array.from(r)), bo: Array.from(this.bo),
    };
    fs.writeFileSync(filepath, JSON.stringify(data), "utf8");
  }

  static load(filepath) {
    const data = JSON.parse(fs.readFileSync(filepath, "utf8"));
    const nn = new NeuralNet(data.inputSize, data.hiddenSize, data.outputSize);
    nn.wh = data.wh.map(r => new Float64Array(r));
    nn.bh = new Float64Array(data.bh);
    nn.wo = data.wo.map(r => new Float64Array(r));
    nn.bo = new Float64Array(data.bo);
    return nn;
  }
}

// ═══ FEATURE EXTRACTION ═══
function extractFeatures(num, raw, todayNums) {
  const maxFreq = Math.max(...raw.freq.slice(1)) || 1;
  const maxFreqR = Math.max(...raw.freqR.slice(1)) || 1;
  const maxMom = Math.max(...raw.momentum.slice(1)) || 1;
  const maxMarkov = Math.max(...raw.markov.slice(1)) || 1;
  const maxPairs = Math.max(...raw.pairBoost.slice(1)) || 1;
  const maxJour = Math.max(...raw.jourFreq.slice(1)) || 1;
  const maxTerm = Math.max(...raw.termBoost.slice(1)) || 1;
  const maxCond = Math.max(...raw.condScore.slice(1), 1);
  const maxSD = raw.sameDayScore ? Math.max(...raw.sameDayScore.slice(1), 1) : 1;

  return [
    raw.freq[num] / maxFreq,
    raw.freqR[num] / maxFreqR,
    raw.momentum[num] / maxMom,
    Math.min(raw.lastSeen[num] / 50, 1),
    raw.overdueRatio[num] / 3,
    raw.markov[num] / maxMarkov,
    raw.pairBoost[num] / maxPairs,
    raw.jourFreq[num] / maxJour,
    raw.termBoost[num] / maxTerm,
    raw.condScore[num] / maxCond,
    raw.sameDayScore ? raw.sameDayScore[num] / maxSD : 0,
    todayNums.has(num) ? 1 : 0,
  ];
}

// ═══ TRAIN ═══
function trainNeural(draws, epochs, hiddenSize) {
  epochs = epochs || 3;
  hiddenSize = hiddenSize || 32;
  const nn = new NeuralNet(12, hiddenSize, 1);
  const lr = 0.01;
  const trainSize = Math.min(3000, draws.length - 100);

  for (let epoch = 0; epoch < epochs; epoch++) {
    let totalLoss = 0, samples = 0;

    for (let i = 0; i < trainSize; i++) {
      const target = draws[i];
      const hist = draws.slice(i + 1);
      const filtered = hist.filter(d => d.type === target.type);
      if (filtered.length < 20) continue;

      const parts = target.date.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      let jour = null;
      if (parts) jour = new Date(parseInt(parts[3]), parseInt(parts[2]) - 1, parseInt(parts[1])).getDay();

      const sameDayBefore = [];
      for (let j = i + 1; j < draws.length && draws[j].date === target.date; j++) sameDayBefore.push(draws[j]);

      const tops = computeCriteriaTops(filtered, hist, 15, jour, sameDayBefore);
      if (!tops || !tops._raw) continue;

      const realSet = new Set(target.gagnants);
      const todayNums = new Set(sameDayBefore.flatMap(d => d.gagnants));

      for (const n of target.gagnants) {
        totalLoss += nn.train(extractFeatures(n, tops._raw, todayNums), [1], lr);
        samples++;
      }
      for (let k = 0; k < 10; k++) {
        const rn = Math.floor(Math.random() * NUM_RANGE) + 1;
        if (realSet.has(rn)) continue;
        totalLoss += nn.train(extractFeatures(rn, tops._raw, todayNums), [0], lr);
        samples++;
      }
    }
    console.log("  Epoch " + (epoch + 1) + "/" + epochs + ": loss=" + (totalLoss / samples).toFixed(4) + " (" + samples + " samples)");
  }
  return nn;
}

// ═══ PREDICT ═══
function predictNeural(nn, draws, typeFilter, jourSemaine, todayDraws) {
  const filtered = typeFilter ? draws.filter(d => d.type === typeFilter) : draws;
  if (filtered.length < 20) return null;

  const tops = computeCriteriaTops(filtered, draws, 15, jourSemaine, todayDraws || []);
  if (!tops || !tops._raw) return null;

  const todayNums = new Set((todayDraws || []).flatMap(d => d.gagnants));
  const scores = [];
  for (let n = 1; n <= NUM_RANGE; n++) {
    const { output } = nn.forward(extractFeatures(n, tops._raw, todayNums));
    scores.push({ num: n, prob: output[0] });
  }
  scores.sort((a, b) => b.prob - a.prob);
  return scores;
}

module.exports = { NeuralNet, extractFeatures, trainNeural, predictNeural, MODEL_PATH };

// ═══ CLI ═══
if (require.main === module) {
  const db = loadDB();
  const draws = db.draws;
  const parseDate = (s) => { const p = s.match(/(\d{2})\/(\d{2})\/(\d{4})/); return p ? new Date(parseInt(p[3]), parseInt(p[2]) - 1, parseInt(p[1])) : new Date(0); };

  console.log("RESEAU DE NEURONES — " + draws.length + " tirages");
  console.log("");

  console.log("=== ENTRAINEMENT ===");
  const nn = trainNeural(draws, 5, 32);
  nn.save(MODEL_PATH);
  console.log("Modele sauvegarde.");
  console.log("");

  console.log("=== BACKTEST 6 MOIS ===");
  const lastDate = parseDate(draws[0].date);
  const testStart = new Date(lastDate);
  testStart.setMonth(testStart.getMonth() - 6);

  const byDate = {};
  for (let i = 0; i < draws.length; i++) {
    if (!byDate[draws[i].date]) byDate[draws[i].date] = [];
    byDate[draws[i].date].push(i);
  }

  let total = 0, hits = 0, h0 = 0, h1 = 0, h2 = 0, h3 = 0;

  for (let i = 0; i < draws.length; i++) {
    const target = draws[i];
    const dt = parseDate(target.date);
    if (dt < testStart) break;

    const hist = draws.slice(i + 1);
    const filtered = hist.filter(d => d.type === target.type);
    if (filtered.length < 20) continue;

    const jour = dt.getDay();
    const todayBefore = (byDate[target.date] || []).filter(idx => idx > i).map(idx => draws[idx]);

    const scores = predictNeural(nn, hist, target.type, jour, todayBefore);
    if (!scores) continue;

    const predicted = new Set(scores.slice(0, 5).map(s => s.num));
    const real = new Set(target.gagnants);
    let h = 0;
    for (const n of real) if (predicted.has(n)) h++;

    total++; hits += h;
    if (h === 0) h0++; else if (h === 1) h1++; else if (h === 2) h2++; else h3++;
  }

  const eR = 5 * 5 / 90;
  console.log("");
  console.log("Predictions: " + total);
  console.log("Avg: " + (hits / total).toFixed(3) + " exacts/pred");
  console.log("Lift: x" + (hits / total / eR).toFixed(2));
  console.log(">=1: " + ((1 - h0 / total) * 100).toFixed(1) + "%");
  console.log(">=2: " + ((h2 + h3) / total * 100).toFixed(1) + "% (" + (h2 + h3) + ")");
  console.log("0:" + h0 + " 1:" + h1 + " 2:" + h2 + " 3+:" + h3);
  console.log("");
  console.log("Systeme stats actuel: avg=0.308, lift=x1.11, 2+: 2.0%");
}
