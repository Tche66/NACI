// ═══════════════════════════════════════════════════════════════
//  LSTM v3 — Reseau recurrent pour Loto Bonheur
//  Voit les 10 derniers tirages en sequence (temporal patterns)
//  Architecture: LSTM(seqFeats→32) + Dense(32+numFeats→32→1)
//  Zero dependance externe
// ═══════════════════════════════════════════════════════════════

const fs = require("fs");
const path = require("path");
const { loadDB } = require("./db");
const { computeCriteriaTops, DRAW_CATEGORIES, getCategoryForType } = require("./apprentissage");

const NUM_RANGE = 90;
const LSTM_MODEL_PATH = path.join(__dirname, "lstm_model.json");
const SEQ_LEN = 10;
const SEQ_FEATURES = 12;
const NUM_FEATURES = 20;
const HIDDEN_SIZE = 32;
const DENSE_SIZE = 32;

function zeros(n) { return new Float64Array(n); }
function randMatrix(rows, cols) {
  const m = [];
  const s = Math.sqrt(2 / (rows + cols));
  for (let i = 0; i < rows; i++) {
    m[i] = new Float64Array(cols);
    for (let j = 0; j < cols; j++) m[i][j] = (Math.random() - 0.5) * s;
  }
  return m;
}
function sigmoid(x) { return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, x)))); }
function tanh_(x) { const e = Math.exp(2 * Math.max(-500, Math.min(500, x))); return (e - 1) / (e + 1); }
function relu(x) { return x > 0 ? x : 0.01 * x; }
function reluD(x) { return x > 0 ? 1 : 0.01; }

// ═══ CELLULE LSTM ═══
class LSTMCell {
  constructor(inputSize, hiddenSize) {
    this.inputSize = inputSize;
    this.hiddenSize = hiddenSize;
    const total = inputSize + hiddenSize;
    this.Wf = randMatrix(hiddenSize, total);
    this.bf = new Float64Array(hiddenSize).fill(1);
    this.Wi = randMatrix(hiddenSize, total);
    this.bi = zeros(hiddenSize);
    this.Wc = randMatrix(hiddenSize, total);
    this.bc = zeros(hiddenSize);
    this.Wo = randMatrix(hiddenSize, total);
    this.bo = zeros(hiddenSize);
  }

  forward(x, hPrev, cPrev) {
    const hs = this.hiddenSize;
    const concat = new Float64Array(this.inputSize + hs);
    concat.set(x, 0);
    concat.set(hPrev, this.inputSize);

    const ft = zeros(hs), it = zeros(hs), ct_ = zeros(hs), ot = zeros(hs);
    const cNew = zeros(hs), hNew = zeros(hs);

    for (let j = 0; j < hs; j++) {
      let sf = this.bf[j], si = this.bi[j], sc = this.bc[j], so = this.bo[j];
      for (let k = 0; k < concat.length; k++) {
        sf += this.Wf[j][k] * concat[k];
        si += this.Wi[j][k] * concat[k];
        sc += this.Wc[j][k] * concat[k];
        so += this.Wo[j][k] * concat[k];
      }
      ft[j] = sigmoid(sf);
      it[j] = sigmoid(si);
      ct_[j] = tanh_(sc);
      ot[j] = sigmoid(so);
      cNew[j] = ft[j] * cPrev[j] + it[j] * ct_[j];
      hNew[j] = ot[j] * tanh_(cNew[j]);
    }

    return { hNew, cNew, ft, it, ct_, ot, concat };
  }

  backward(grad_h, grad_c_next, cache, lr) {
    const { hNew, cNew, ft, it, ct_, ot, concat, cPrev } = cache;
    const hs = this.hiddenSize;
    const concatLen = concat.length;

    const dc = zeros(hs);
    for (let j = 0; j < hs; j++) {
      const tanhC = tanh_(cNew[j]);
      dc[j] = grad_h[j] * ot[j] * (1 - tanhC * tanhC) + grad_c_next[j];
    }

    const dft = zeros(hs), dit = zeros(hs), dct_ = zeros(hs), dot_ = zeros(hs);
    for (let j = 0; j < hs; j++) {
      dft[j] = dc[j] * cPrev[j] * ft[j] * (1 - ft[j]);
      dit[j] = dc[j] * ct_[j] * it[j] * (1 - it[j]);
      dct_[j] = dc[j] * it[j] * (1 - ct_[j] * ct_[j]);
      const tanhC = tanh_(cNew[j]);
      dot_[j] = grad_h[j] * tanhC * ot[j] * (1 - ot[j]);
    }

    for (let j = 0; j < hs; j++) {
      for (let k = 0; k < concatLen; k++) {
        this.Wf[j][k] -= lr * dft[j] * concat[k];
        this.Wi[j][k] -= lr * dit[j] * concat[k];
        this.Wc[j][k] -= lr * dct_[j] * concat[k];
        this.Wo[j][k] -= lr * dot_[j] * concat[k];
      }
      this.bf[j] -= lr * dft[j];
      this.bi[j] -= lr * dit[j];
      this.bc[j] -= lr * dct_[j];
      this.bo[j] -= lr * dot_[j];
    }

    const dConcat = zeros(concatLen);
    for (let k = 0; k < concatLen; k++) {
      for (let j = 0; j < hs; j++) {
        dConcat[k] += dft[j] * this.Wf[j][k] + dit[j] * this.Wi[j][k]
                    + dct_[j] * this.Wc[j][k] + dot_[j] * this.Wo[j][k];
      }
    }

    const dc_prev = zeros(hs);
    for (let j = 0; j < hs; j++) dc_prev[j] = dc[j] * ft[j];

    return { dConcat, dc_prev };
  }
}

// ═══ RESEAU LSTM COMPLET ═══
class LSTMNet {
  constructor() {
    this.lstm = new LSTMCell(SEQ_FEATURES, HIDDEN_SIZE);
    this.wd1 = randMatrix(DENSE_SIZE, HIDDEN_SIZE + NUM_FEATURES);
    this.bd1 = zeros(DENSE_SIZE);
    this.wd2 = randMatrix(1, DENSE_SIZE);
    this.bd2 = zeros(1);
  }

  forwardSeq(sequence) {
    let h = zeros(HIDDEN_SIZE);
    let c = zeros(HIDDEN_SIZE);
    const caches = [];
    for (let t = 0; t < sequence.length; t++) {
      const prev_c = new Float64Array(c);
      const result = this.lstm.forward(sequence[t], h, c);
      caches.push({ ...result, cPrev: prev_c });
      h = result.hNew;
      c = result.cNew;
    }
    return { h, c, caches };
  }

  forwardDense(lstmH, numFeats, dropRate) {
    const input = new Float64Array(HIDDEN_SIZE + NUM_FEATURES);
    input.set(lstmH, 0);
    input.set(numFeats, HIDDEN_SIZE);

    const d1 = zeros(DENSE_SIZE);
    const d1Raw = zeros(DENSE_SIZE);
    for (let i = 0; i < DENSE_SIZE; i++) {
      let s = this.bd1[i];
      for (let j = 0; j < input.length; j++) s += this.wd1[i][j] * input[j];
      d1Raw[i] = s;
      d1[i] = relu(s);
      if (dropRate > 0 && Math.random() < dropRate) d1[i] = 0;
    }

    let s = this.bd2[0];
    for (let j = 0; j < DENSE_SIZE; j++) s += this.wd2[0][j] * d1[j];
    const out = sigmoid(s);

    return { input, d1, d1Raw, out };
  }

  trainStep(sequence, numFeats, target, lr) {
    const { h, c, caches } = this.forwardSeq(sequence);
    const dense = this.forwardDense(h, numFeats, 0.15);

    const dOut = (dense.out - target) * dense.out * (1 - dense.out);

    const dD1 = zeros(DENSE_SIZE);
    for (let j = 0; j < DENSE_SIZE; j++) {
      dD1[j] = dOut * this.wd2[0][j] * reluD(dense.d1Raw[j]);
    }

    for (let j = 0; j < DENSE_SIZE; j++) {
      this.wd2[0][j] -= lr * dOut * dense.d1[j];
    }
    this.bd2[0] -= lr * dOut;

    for (let i = 0; i < DENSE_SIZE; i++) {
      for (let j = 0; j < dense.input.length; j++) {
        this.wd1[i][j] -= lr * dD1[i] * dense.input[j];
      }
      this.bd1[i] -= lr * dD1[i];
    }

    const dH = zeros(HIDDEN_SIZE);
    for (let j = 0; j < HIDDEN_SIZE; j++) {
      for (let i = 0; i < DENSE_SIZE; i++) {
        dH[j] += dD1[i] * this.wd1[i][j];
      }
    }

    // BPTT tronque (5 steps max pour la vitesse)
    let grad_h = dH;
    let grad_c = zeros(HIDDEN_SIZE);
    const bpttDepth = Math.min(5, caches.length);
    for (let t = caches.length - 1; t >= caches.length - bpttDepth; t--) {
      const { dConcat, dc_prev } = this.lstm.backward(grad_h, grad_c, caches[t], lr);
      grad_h = new Float64Array(dConcat.buffer, SEQ_FEATURES * 8, HIDDEN_SIZE);
      grad_c = dc_prev;
    }

    const loss = -(target * Math.log(dense.out + 1e-10) + (1 - target) * Math.log(1 - dense.out + 1e-10));
    return loss;
  }

  predict(sequence, numFeats) {
    const { h } = this.forwardSeq(sequence);
    const { out } = this.forwardDense(h, numFeats, 0);
    return out;
  }

  save(filepath) {
    const serM = m => m.map(r => Array.from(r));
    const serA = a => Array.from(a);
    fs.writeFileSync(filepath, JSON.stringify({
      version: 3, type: "lstm",
      lstm: {
        inputSize: this.lstm.inputSize, hiddenSize: this.lstm.hiddenSize,
        Wf: serM(this.lstm.Wf), bf: serA(this.lstm.bf),
        Wi: serM(this.lstm.Wi), bi: serA(this.lstm.bi),
        Wc: serM(this.lstm.Wc), bc: serA(this.lstm.bc),
        Wo: serM(this.lstm.Wo), bo: serA(this.lstm.bo),
      },
      wd1: serM(this.wd1), bd1: serA(this.bd1),
      wd2: serM(this.wd2), bd2: serA(this.bd2),
    }), "utf8");
  }

  static load(filepath) {
    const d = JSON.parse(fs.readFileSync(filepath, "utf8"));
    if (d.type !== "lstm" || d.version !== 3) return null;
    const net = new LSTMNet();
    const loadM = m => m.map(r => new Float64Array(r));
    net.lstm.Wf = loadM(d.lstm.Wf); net.lstm.bf = new Float64Array(d.lstm.bf);
    net.lstm.Wi = loadM(d.lstm.Wi); net.lstm.bi = new Float64Array(d.lstm.bi);
    net.lstm.Wc = loadM(d.lstm.Wc); net.lstm.bc = new Float64Array(d.lstm.bc);
    net.lstm.Wo = loadM(d.lstm.Wo); net.lstm.bo = new Float64Array(d.lstm.bo);
    net.wd1 = loadM(d.wd1); net.bd1 = new Float64Array(d.bd1);
    net.wd2 = loadM(d.wd2); net.bd2 = new Float64Array(d.bd2);
    return net;
  }
}

// ═══ FEATURES SEQUENCE (12 features par tirage) ═══
function extractSeqFeatures(draw, allDraws, filtered) {
  const nums = draw.gagnants;
  const sum = nums.reduce((a, b) => a + b, 0);
  const pairs = nums.filter(n => n % 2 === 0).length;
  const highs = nums.filter(n => n > 45).length;
  const decades = new Set(nums.map(n => Math.floor((n - 1) / 10)));
  const terminals = new Set(nums.map(n => n % 10));

  let repeatCount = 0;
  const idx = filtered.indexOf(draw);
  if (idx >= 0 && idx + 1 < filtered.length) {
    const prev = new Set(filtered[idx + 1].gagnants);
    repeatCount = nums.filter(n => prev.has(n)).length;
  }

  return new Float64Array([
    sum / 450,
    pairs / 5,
    highs / 5,
    decades.size / 9,
    terminals.size / 10,
    repeatCount / 5,
    Math.min(...nums) / 90,
    Math.max(...nums) / 90,
    (Math.max(...nums) - Math.min(...nums)) / 89,
    nums[2] / 90,
    (sum % 10) / 9,
    nums.filter(n => n <= 30).length / 5,
  ]);
}

// ═══ FEATURES PAR NUMERO (20 features) ═══
function extractNumFeatures(num, raw, todayNums, jour) {
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

  return new Float64Array([
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
  ]);
}

// ═══ ENTRAINEMENT ═══
function trainLSTM(draws, epochs) {
  epochs = epochs || 3;
  const net = new LSTMNet();
  const baseLR = 0.003;
  const trainSize = Math.min(2000, draws.length - 200);

  console.log(`[LSTM] Architecture: seq(${SEQ_FEATURES})x${SEQ_LEN} -> LSTM(${HIDDEN_SIZE}) + num(${NUM_FEATURES}) -> Dense(${DENSE_SIZE}) -> 1`);

  for (let epoch = 0; epoch < epochs; epoch++) {
    let totalLoss = 0, samples = 0;
    const lr = baseLR * (1 - epoch / (epochs * 2));

    for (let i = 0; i < trainSize; i++) {
      const target = draws[i];
      const hist = draws.slice(i + 1);
      const filtered = hist.filter(d => d.type === target.type);
      if (filtered.length < SEQ_LEN + 20) continue;

      const seq = [];
      for (let s = 0; s < SEQ_LEN; s++) {
        seq.push(extractSeqFeatures(filtered[s], hist, filtered));
      }

      const parts = target.date.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      let jour = null;
      if (parts) jour = new Date(parseInt(parts[3]), parseInt(parts[2]) - 1, parseInt(parts[1])).getDay();

      const sameDayBefore = [];
      for (let j = i + 1; j < draws.length && draws[j].date === target.date; j++) sameDayBefore.push(draws[j]);
      const tops = computeCriteriaTops(filtered, hist, 15, jour, sameDayBefore);
      if (!tops || !tops._raw) continue;

      const todayNums = new Set(sameDayBefore.flatMap(d => d.gagnants));
      const realSet = new Set(target.gagnants);

      for (const n of target.gagnants) {
        const numF = extractNumFeatures(n, tops._raw, todayNums, jour);
        totalLoss += net.trainStep(seq, numF, 1, lr);
        samples++;
      }

      for (let k = 0; k < 8; k++) {
        const rn = Math.floor(Math.random() * NUM_RANGE) + 1;
        if (realSet.has(rn)) continue;
        const numF = extractNumFeatures(rn, tops._raw, todayNums, jour);
        totalLoss += net.trainStep(seq, numF, 0, lr);
        samples++;
      }
    }
    console.log(`  Epoch ${epoch + 1}/${epochs}: loss=${(totalLoss / samples).toFixed(4)} lr=${lr.toFixed(4)} (${samples} samples)`);
  }
  return net;
}

// ═══ PREDICTION ═══
function predictLSTM(net, draws, typeFilter, jourSemaine, todayDraws) {
  const filtered = typeFilter ? draws.filter(d => d.type === typeFilter) : draws;
  if (filtered.length < SEQ_LEN + 20) return null;

  const seq = [];
  for (let s = 0; s < SEQ_LEN; s++) {
    seq.push(extractSeqFeatures(filtered[s], draws, filtered));
  }

  const tops = computeCriteriaTops(filtered, draws, 15, jourSemaine, todayDraws || []);
  if (!tops || !tops._raw) return null;
  const todayNums = new Set((todayDraws || []).flatMap(d => d.gagnants));

  const { h } = net.forwardSeq(seq);

  const scores = [];
  for (let n = 1; n <= NUM_RANGE; n++) {
    const numF = extractNumFeatures(n, tops._raw, todayNums, jourSemaine);
    const { out } = net.forwardDense(h, numF, 0);
    scores.push({ num: n, prob: out });
  }
  scores.sort((a, b) => b.prob - a.prob);
  return scores;
}

module.exports = { LSTMNet, trainLSTM, predictLSTM, LSTM_MODEL_PATH };

// ═══ CLI ═══
if (require.main === module) {
  const db = loadDB();
  const draws = db.draws;
  const parseDate = (s) => { const p = s.match(/(\d{2})\/(\d{2})\/(\d{4})/); return p ? new Date(parseInt(p[3]), parseInt(p[2]) - 1, parseInt(p[1])) : new Date(0); };

  console.log(`\nLSTM v3 — ${draws.length} tirages`);
  console.log("=".repeat(50));

  console.log("\n=== ENTRAINEMENT ===");
  const net = trainLSTM(draws, 3);
  net.save(LSTM_MODEL_PATH);
  console.log("Modele LSTM sauvegarde.\n");

  console.log("=== BACKTEST 6 MOIS ===");
  const lastDate = parseDate(draws[0].date);
  const testStart = new Date(lastDate);
  testStart.setMonth(testStart.getMonth() - 6);

  let total = 0, hits = 0, h0 = 0, h1 = 0, h2 = 0, h3 = 0;
  for (let i = 0; i < draws.length; i++) {
    const target = draws[i];
    const dt = parseDate(target.date);
    if (dt < testStart) break;
    const hist = draws.slice(i + 1);
    const filtered = hist.filter(d => d.type === target.type);
    if (filtered.length < SEQ_LEN + 20) continue;
    const jour = dt.getDay();
    const todayBefore = draws.filter((d, j) => j > i && d.date === target.date);
    const scores = predictLSTM(net, hist, target.type, jour, todayBefore);
    if (!scores) continue;
    const predicted = new Set(scores.slice(0, 5).map(s => s.num));
    const real = new Set(target.gagnants);
    let hh = 0;
    for (const n of real) if (predicted.has(n)) hh++;
    total++; hits += hh;
    if (hh === 0) h0++; else if (hh === 1) h1++; else if (hh === 2) h2++; else h3++;
  }

  const eR = 5 * 5 / 90;
  console.log(`Predictions: ${total}`);
  console.log(`Avg: ${(hits / total).toFixed(3)} exacts/pred (hasard: ${eR.toFixed(3)})`);
  console.log(`Lift: x${(hits / total / eR).toFixed(2)}`);
  console.log(`>=1: ${((1 - h0 / total) * 100).toFixed(1)}%`);
  console.log(`>=2: ${((h2 + h3) / total * 100).toFixed(1)}% (${h2 + h3})`);
  console.log(`0:${h0} 1:${h1} 2:${h2} 3+:${h3}`);
}
