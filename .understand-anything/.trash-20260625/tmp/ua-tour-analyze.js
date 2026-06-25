#!/usr/bin/env node
'use strict';
const fs = require('fs');

function main() {
  const inPath = process.argv[2];
  const outPath = process.argv[3];
  if (!inPath || !outPath) {
    console.error('usage: node ua-tour-analyze.js <input.json> <output.json>');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const nodes = data.nodes || [];
  const edges = data.edges || [];
  const layers = data.layers || [];

  const nodeById = new Map();
  for (const n of nodes) nodeById.set(n.id, n);

  // adjacency
  const fanIn = new Map();
  const fanOut = new Map();
  for (const n of nodes) { fanIn.set(n.id, 0); fanOut.set(n.id, 0); }
  const outAdj = new Map(); // for BFS following imports/calls
  for (const n of nodes) outAdj.set(n.id, []);
  const edgeSet = new Set(); // "src|tgt|type"

  for (const e of edges) {
    if (!nodeById.has(e.source) || !nodeById.has(e.target)) continue;
    fanOut.set(e.source, fanOut.get(e.source) + 1);
    fanIn.set(e.target, fanIn.get(e.target) + 1);
    edgeSet.add(e.source + '|' + e.target + '|' + e.type);
    if (e.type === 'imports' || e.type === 'calls') {
      outAdj.get(e.source).push(e.target);
    }
  }

  const nameOf = (id) => (nodeById.get(id) || {}).name || id;
  const summaryOf = (id) => (nodeById.get(id) || {}).summary || '';

  // A. fan-in ranking
  const fanInRanking = nodes
    .map(n => ({ id: n.id, fanIn: fanIn.get(n.id), name: n.name }))
    .sort((a, b) => b.fanIn - a.fanIn)
    .slice(0, 20);

  // B. fan-out ranking
  const fanOutRanking = nodes
    .map(n => ({ id: n.id, fanOut: fanOut.get(n.id), name: n.name }))
    .sort((a, b) => b.fanOut - a.fanOut)
    .slice(0, 20);

  // entry point scoring helpers
  const fanOutVals = nodes.map(n => fanOut.get(n.id)).sort((a, b) => a - b);
  const fanInVals = nodes.map(n => fanIn.get(n.id)).sort((a, b) => a - b);
  const pct = (arr, p) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(p * arr.length))] : 0;
  const fanOutTop10 = pct(fanOutVals, 0.9);
  const fanInBottom25 = pct(fanInVals, 0.25);

  const codeEntryNames = new Set([
    'index.ts','index.js','main.ts','main.js','app.ts','app.js','server.ts','server.js',
    'mod.rs','main.go','main.py','main.rs','manage.py','app.py','wsgi.py','asgi.py','run.py',
    '__main__.py','Application.java','Main.java','Program.cs','config.ru','index.php',
    'App.swift','Application.kt','main.cpp','main.c','index.html'
  ]);

  // C. entry point candidates
  const candidates = [];
  for (const n of nodes) {
    let score = 0;
    const fp = (n.filePath || '').replace(/\\/g, '/');
    const depth = fp.split('/').length - 1;
    if (n.type === 'document') {
      if (n.name === 'README.md' && depth === 0) score += 5;
      else if (/\.md$/i.test(n.name) && depth === 0) score += 2;
    } else {
      if (codeEntryNames.has(n.name)) score += 3;
      if (depth <= 1) score += 1;
      if (fanOut.get(n.id) >= fanOutTop10 && fanOutTop10 > 0) score += 1;
      if (fanIn.get(n.id) <= fanInBottom25) score += 1;
    }
    if (score > 0) candidates.push({ id: n.id, score, name: n.name, summary: summaryOf(n.id), type: n.type });
  }
  candidates.sort((a, b) => b.score - a.score);
  const entryPointCandidates = candidates.slice(0, 5);

  // D. BFS from top CODE entry point
  const codeCandidate = candidates.find(c => c.type !== 'document') || candidates[0];
  const start = codeCandidate ? codeCandidate.id : (nodes[0] && nodes[0].id);
  const depthMap = {};
  const order = [];
  if (start) {
    const q = [start];
    depthMap[start] = 0;
    const seen = new Set([start]);
    while (q.length) {
      const cur = q.shift();
      order.push(cur);
      for (const nb of (outAdj.get(cur) || [])) {
        if (!seen.has(nb)) {
          seen.add(nb);
          depthMap[nb] = depthMap[cur] + 1;
          q.push(nb);
        }
      }
    }
  }
  const byDepth = {};
  for (const id of order) {
    const d = depthMap[id];
    (byDepth[d] = byDepth[d] || []).push(id);
  }

  // E. non-code inventory
  const nonCodeFiles = { documentation: [], infrastructure: [], data: [], config: [] };
  for (const n of nodes) {
    const item = { id: n.id, name: n.name, type: n.type, summary: summaryOf(n.id) };
    if (n.type === 'document') nonCodeFiles.documentation.push(item);
    else if (['service', 'pipeline', 'resource'].includes(n.type)) nonCodeFiles.infrastructure.push(item);
    else if (['table', 'schema', 'endpoint'].includes(n.type)) nonCodeFiles.data.push(item);
    else if (n.type === 'config') nonCodeFiles.config.push(item);
  }

  // F. clusters from bidirectional edges
  const has = (a, b, t) => edgeSet.has(a + '|' + b + '|' + t);
  const pairKey = (a, b) => [a, b].sort().join('||');
  const pairs = new Map();
  for (const e of edges) {
    const t = e.type;
    if ((t === 'imports' || t === 'calls') && has(e.target, e.source, t)) {
      pairs.set(pairKey(e.source, e.target), [e.source, e.target]);
    }
  }
  // also count plain mutual edge density between node pairs
  const clusters = [];
  const usedPair = new Set();
  for (const [k, pr] of pairs) {
    if (usedPair.has(k)) continue;
    usedPair.add(k);
    const members = new Set(pr);
    // expand: add nodes connecting to 2+ members
    for (const n of nodes) {
      if (members.has(n.id)) continue;
      let conn = 0;
      for (const m of members) {
        if (fanOut.get(n.id) && (has(n.id, m, 'imports') || has(n.id, m, 'calls'))) conn++;
        if (has(m, n.id, 'imports') || has(m, n.id, 'calls')) conn++;
      }
      if (conn >= 2 && members.size < 5) members.add(n.id);
    }
    // edge count among members
    let ec = 0;
    for (const e of edges) if (members.has(e.source) && members.has(e.target)) ec++;
    clusters.push({ nodes: [...members], edgeCount: ec });
  }
  clusters.sort((a, b) => b.edgeCount - a.edgeCount);
  const topClusters = clusters.slice(0, 10);

  // G. layers
  const layerOut = {
    count: layers.length,
    list: layers.map(l => ({ id: l.id, name: l.name, description: l.description }))
  };

  // H. node summary index
  const nodeSummaryIndex = {};
  for (const n of nodes) {
    nodeSummaryIndex[n.id] = { name: n.name, type: n.type, summary: n.summary || '' };
  }

  const result = {
    scriptCompleted: true,
    entryPointCandidates,
    fanInRanking,
    fanOutRanking,
    bfsTraversal: { startNode: start, order, depthMap, byDepth },
    nonCodeFiles,
    clusters: topClusters,
    layers: layerOut,
    nodeSummaryIndex,
    totalNodes: nodes.length,
    totalEdges: edges.length
  };
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log('done. nodes=' + nodes.length + ' edges=' + edges.length + ' bfsOrder=' + order.length);
}

try { main(); } catch (e) { console.error(e && e.stack ? e.stack : String(e)); process.exit(1); }
