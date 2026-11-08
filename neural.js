// ═══════════════════════════════════════════════════════════════
//  RESEAU DE NEURONES v2 — Deep NN pour Loto Bonheur
//  2 couches cachees (48→24), 20 features, dropout, LR decay
//  Zero dependance externe
// ═══════════════════════════════════════════════════════════════

const fs = require("fs");
const path = require("path");
const { loadDB } = require("./db");
const { computeCriteriaTops, DRAW_CATEGORIES, getCategoryForType } = require("./apprentissage");

const NUM_RANGE = 90;
const MODEL_PATH = path.join(__dirname, "neural_model.json");

class NeuralNet {
  constructor(inputSize, h1Size, h2Size, outputSize) {
    this.inputSize = inputSize;
    this.h1Size = h1Size;
    this.h2Size = h2Size || 0;
    this.outputSize = outputSize || 1;
    this.w1 = this._randomMatrix(h1Size, inputSize);
    this.b1 = new Float64Array(h1Size);
    if (this.h2Size > 0) {
      this.w2 = this._randomMatrix(h2Size, h1Size);
      this.b2 = new Float64Array(h2Size);
      this.wo = this._randomMatrix(this.outputSize, h2Size);
    } else {
      this.w2 = null; this.b2 = null;
      this.wo = this._randomMatrix(this.outputSize, h1Size);
    }
    this.bo = new Float64Array(this.outputSize);
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

  forward(input, dropRate) {
    const drop = dropRate || 0;
    const h1 = new Float64Array(this.h1Size);
    const h1Raw = new Float64Array(this.h1Size);
    for (let i = 0; i < this.h1Size; i++) {
      let sum = this.b1[i];
      for (let j = 0; j < this.inputSize; j++) sum += this.w1[i][j] * input[j];
      h1Raw[i] = sum;
      h1[i] = this._relu(sum);
      if (drop > 0 && Math.random() < drop) h1[i] = 0;
    }
    let lastHidden = h1, lastSize = this.h1Size;
    let h2 = null, h2Raw = null;
    if (this.h2Size > 0) {
      h2 = new Float64Array(this.h2Size);
      h2Raw = new Float64Array(this.h2Size);
      for (let i = 0; i < this.h2Size; i++) {
        let sum = this.b2[i];
        for (let j = 0; j < this.h1Size; j++) sum += this.w2[i][j] * h1[j];
        h2Raw[i] = sum;
        h2[i] = this._relu(sum);
        if (drop > 0 && Math.random() < drop) h2[i] = 0;
      }
      lastHidden = h2; lastSize = this.h2Size;
    }
    const output = new Float64Array(this.outputSize);
    for (let i = 0; i < this.outputSize; i++) {
      let sum = this.bo[i];
      for (let j = 0; j < lastSize; j++) sum += this.wo[i][j] * lastHidden[j];
      output[i] = this._sigmoid(sum);
    }
    return { h1, h1Raw, h2, h2Raw, lastHidden, output };
  }

  train(input, target, lr) {
    const { h1, h1Raw, h2, h2Raw, lastHidden, output } = this.forward(input, 0.15);
    const lastSize = this.h2Size > 0 ? this.h2Size : this.h1Size;
    const dOutput = new Float64Array(this.outputSize);
    for (let i = 0; i < this.outputSize; i++) {
      dOutput[i] = (output[i] - target[i]) * output[i] * (1 - output[i]);
    }
    const dLastHidden = new Float64Array(lastSize);
    for (let j = 0; j < lastSize; j++) {
      let sum = 0;
      for (let i = 0; i < this.outputSize; i++) sum += dOutput[i] * this.wo[i][j];
      const rawVal = this.h2Size > 0 ? h2Raw[j] : h1Raw[j];
      dLastHidden[j] = sum * this._reluDeriv(rawVal);
    }
    for (let i = 0; i < this.outputSize; i++) {
      for (let j = 0; j < lastSize; j++) this.wo[i][j] -= lr * dOutput[i] * lastHidden[j];
      this.bo[i] -= lr * dOutput[i];
    }
    if (this.h2Size > 0) {
      const dH1 = new Float64Array(this.h1Size);
      for (let j = 0; j < this.h1Size; j++) {
        let sum = 0;
        for (let i = 0; i < this.h2Size; i++) sum += dLastHidden[i] * this.w2[i][j];
        dH1[j] = sum * this._reluDeriv(h1Raw[j]);
      }
      for (let i = 0; i < this.h2Size; i++) {
        for (let j = 0; j < this.h1Size; j++) this.w2[i][j] -= lr * dLastHidden[i] * h1[j];
        this.b2[i] -= lr * dLastHidden[i];
      }
      for (let i = 0; i < this.h1Size; i++) {
        for (let j = 0; j < this.inputSize; j++) this.w1[i][j] -= lr * dH1[i] * input[j];
        this.b1[i] -= lr * dH1[i];
      }
    } else {
      for (let i = 0; i < this.h1Size; i++) {
        for (let j = 0; j < this.inputSize; j++) this.w1[i][j] -= lr * dLastHidden[i] * input[j];
        this.b1[i] -= lr * dLastHidden[i];
      }
    }
    let loss = 0;
    for (let i = 0; i < this.outputSize; i++) {
      loss -= target[i] * Math.log(output[i] + 1e-10) + (1 - target[i]) * Math.log(1 - output[i] + 1e-10);
    }
    return loss / this.outputSize;
  }

  save(filepath) {
    const data = {
      version: 2,
      inputSize: this.inputSize, h1Size: this.h1Size, h2Size: this.h2Size, outputSize: this.outputSize,
      w1: this.w1.map(r => Array.from(r)), b1: Array.from(this.b1),
      w2: this.w2 ? this.w2.map(r => Array.from(r)) : null, b2: this.b2 ? Array.from(this.b2) : null,
      wo: this.wo.map(r => Array.from(r)), bo: Array.from(this.bo),
    };
    fs.writeFileSync(filepath, JSON.stringify(data), "utf8");
  }

  static load(filepath) {
    const data = JSON.parse(fs.readFileSync(filepath, "utf8"));
    if (data.version === 2) {
      const nn = new NeuralNet(data.inputSize, data.h1Size, data.h2Size, data.outputSize);
      nn.w1 = data.w1.map(r => new Float64Array(r));
      nn.b1 = new Float64Array(data.b1);
      if (data.w2 && data.h2Size > 0) {
        nn.w2 = data.w2.map(r => new Float64Array(r));
        nn.b2 = new Float64Array(data.b2);
      }
      nn.wo = data.wo.map(r => new Float64Array(r));
      nn.bo = new Float64Array(data.bo);
      return nn;
    }
    // Retrocompatible: ancien modele v1 (1 couche, 12 features)
    const nn = new NeuralNet(data.inputSize, data.hiddenSize, 0, data.outputSize);
    nn.w1 = data.wh.map(r => new Float64Array(r));
    nn.b1 = new Float64Array(data.bh);
    nn.wo = data.wo.map(r => new Float64Array(r));
    nn.bo = new Float64Array(data.bo);
    nn._legacy = true;
    return nn;
  }
}

// ═══ FEATURE EXTRACTION v2 — 20 features ═══
function extractFeatures(num, raw, todayNums, jour) {
  const maxFreq = Math.max(...raw.freq.slice(1)) || 1;
  const maxFreqR = Math.max(...raw.freqR.slice(1)) || 1;
  const maxMom = Math.max(...raw.momentum.slice(1)) || 1;
  const maxMarkov = Math.max(...raw.markov.slice(1)) || 1;
  const maxPairs = Math.max(...raw.pairBoost.slice(1)) || 1;
  const maxJour = Math.max(...raw.jourFreq.slice(1)) || 1;
  const maxTerm = Math.max(...raw.termBoost.slice(1)) || 1;
  const maxCond = Math.max(...raw.condScore.slice(1), 1);
  const maxSD = raw.sameDayScore ? Math.max(...raw.sameDayScore.slice(1), 1) : 1;

  const j = (jour !== null && jour !== undefined) ? jour : 0;
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
    num / NUM_RANGE,
    (num % 2 === 1) ? 1 : 0,
    Math.floor((num - 1) / 10) / 8,
    (num % 10) / 9,
    Math.sin(2 * Math.PI * j / 7),
    Math.cos(2 * Math.PI * j / 7),
    Math.min(raw.freqR[num] / (maxFreqR * 0.3 + 0.01), 1),
    raw.freq[num] > 0 ? Math.min(raw.lastSeen[num] / (raw.freq[num] * 0.5 + 1), 1) : 0,
  ];
}

// ═══ TRAIN v2 ═══
function trainNeural(draws, epochs, h1Size, h2Size) {
  epochs = epochs || 5;
  h1Size = h1Size || 48;
  h2Size = h2Size || 24;
  const nn = new NeuralNet(20, h1Size, h2Size, 1);
  const baseLR = 0.008;
  const trainSize = Math.min(3000, draws.length - 100);

  for (let epoch = 0; epoch < epochs; epoch++) {
    let totalLoss = 0, samples = 0;
    const lr = baseLR * (1 - epoch / (epochs * 1.5));
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
        totalLoss += nn.train(extractFeatures(n, tops._raw, todayNums, jour), [1], lr);
        samples++;
      }
      for (let k = 0; k < 10; k++) {
        const rn = Math.floor(Math.random() * NUM_RANGE) + 1;
        if (realSet.has(rn)) continue;
        totalLoss += nn.train(extractFeatures(rn, tops._raw, todayNums, jour), [0], lr);
        samples++;
      }
    }
    console.log("  Epoch " + (epoch + 1) + "/" + epochs + ": loss=" + (totalLoss / samples).toFixed(4) + " lr=" + lr.toFixed(4) + " (" + samples + " samples)");
  }
  return nn;
}

// ═══ PREDICT v2 ═══
function predictNeural(nn, draws, typeFilter, jourSemaine, todayDraws) {
  const filtered = typeFilter ? draws.filter(d => d.type === typeFilter) : draws;
  if (filtered.length < 20) return null;
  const tops = computeCriteriaTops(filtered, draws, 15, jourSemaine, todayDraws || []);
  if (!tops || !tops._raw) return null;
  const todayNums = new Set((todayDraws || []).flatMap(d => d.gagnants));
  const useLegacy = nn._legacy && nn.inputSize === 12;
  const scores = [];
  for (let n = 1; n <= NUM_RANGE; n++) {
    const feats = useLegacy
      ? extractFeatures(n, tops._raw, todayNums, jourSemaine).slice(0, 12)
      : extractFeatures(n, tops._raw, todayNums, jourSemaine);
    const { output } = nn.forward(feats);
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

  console.log("RESEAU DE NEURONES v2 — " + draws.length + " tirages");
  console.log("Architecture: 20 -> 48 -> 24 -> 1\n");

  console.log("=== ENTRAINEMENT ===");
  const nn = trainNeural(draws, 5, 48, 24);
  nn.save(MODEL_PATH);
  console.log("Modele sauvegarde.\n");

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
  console.log("Predictions: " + total);
  console.log("Avg: " + (hits / total).toFixed(3) + " exacts/pred");
  console.log("Lift: x" + (hits / total / eR).toFixed(2));
  console.log(">=1: " + ((1 - h0 / total) * 100).toFixed(1) + "%");
  console.log(">=2: " + ((h2 + h3) / total * 100).toFixed(1) + "% (" + (h2 + h3) + ")");
  console.log("0:" + h0 + " 1:" + h1 + " 2:" + h2 + " 3+:" + h3);
}
