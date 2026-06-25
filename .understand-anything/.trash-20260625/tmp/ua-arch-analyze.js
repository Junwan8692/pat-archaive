#!/usr/bin/env node
'use strict';
const fs = require('fs');

function main() {
  const inPath = process.argv[2];
  const outPath = process.argv[3];
  if (!inPath || !outPath) { console.error('usage: node script.js <in> <out>'); process.exit(1); }
  const data = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const fileNodes = data.fileNodes || [];
  const importEdges = data.importEdges || [];
  const allEdges = data.allEdges || [];

  const idToNode = {};
  fileNodes.forEach(n => { idToNode[n.id] = n; });
  const norm = p => (p || '').replace(/\\/g, '/');

  // Common prefix of directory segments
  const paths = fileNodes.map(n => norm(n.filePath));
  function commonPrefix(arr) {
    if (!arr.length) return '';
    const split = arr.map(p => p.split('/').slice(0, -1)); // dir segments only
    let pref = split[0];
    for (const s of split) {
      let i = 0;
      while (i < pref.length && i < s.length && pref[i] === s[i]) i++;
      pref = pref.slice(0, i);
    }
    return pref.join('/');
  }
  const prefix = commonPrefix(paths);
  const prefLen = prefix ? prefix.split('/').length : 0;

  // A. Directory grouping
  const directoryGroups = {};
  const fileToGroup = {};
  fileNodes.forEach(n => {
    const p = norm(n.filePath);
    const segs = p.split('/');
    const rel = segs.slice(prefLen);
    let group;
    if (rel.length <= 1) group = '(root)';
    else group = rel[0];
    (directoryGroups[group] = directoryGroups[group] || []).push(n.id);
    fileToGroup[n.id] = group;
  });

  // B. Node type grouping
  const nodeTypeGroups = {};
  fileNodes.forEach(n => { (nodeTypeGroups[n.type] = nodeTypeGroups[n.type] || []).push(n.id); });

  // C. fan-in / fan-out from imports
  const fanIn = {}, fanOut = {};
  fileNodes.forEach(n => { fanIn[n.id] = 0; fanOut[n.id] = 0; });
  importEdges.forEach(e => {
    if (fanOut[e.source] !== undefined) fanOut[e.source]++;
    if (fanIn[e.target] !== undefined) fanIn[e.target]++;
  });

  // D. cross-category edges (by node type, non-import)
  const ccMap = {};
  allEdges.forEach(e => {
    const s = idToNode[e.source], t = idToNode[e.target];
    if (!s || !t) return;
    if (s.type === t.type && s.type === 'file') return; // skip pure file-file
    const key = s.type + '->' + t.type + ':' + e.type;
    ccMap[key] = (ccMap[key] || 0) + 1;
  });
  const crossCategoryEdges = Object.entries(ccMap).map(([k, count]) => {
    const [ft, rest] = k.split('->');
    const [tt, et] = rest.split(':');
    return { fromType: ft, toType: tt, edgeType: et, count };
  }).sort((a, b) => b.count - a.count);

  // E. inter-group imports
  const igMap = {};
  importEdges.forEach(e => {
    const g1 = fileToGroup[e.source], g2 = fileToGroup[e.target];
    if (g1 === undefined || g2 === undefined || g1 === g2) return;
    const k = g1 + '->' + g2;
    igMap[k] = (igMap[k] || 0) + 1;
  });
  const interGroupImports = Object.entries(igMap).map(([k, count]) => {
    const [from, to] = k.split('->');
    return { from, to, count };
  }).sort((a, b) => b.count - a.count);

  // F. intra-group density
  const intraGroupDensity = {};
  Object.keys(directoryGroups).forEach(g => { intraGroupDensity[g] = { internalEdges: 0, totalEdges: 0, density: 0 }; });
  importEdges.forEach(e => {
    const g1 = fileToGroup[e.source], g2 = fileToGroup[e.target];
    if (g1 !== undefined) intraGroupDensity[g1].totalEdges++;
    if (g2 !== undefined && g2 !== g1) intraGroupDensity[g2].totalEdges++;
    if (g1 !== undefined && g1 === g2) { intraGroupDensity[g1].internalEdges++; }
  });
  Object.keys(intraGroupDensity).forEach(g => {
    const o = intraGroupDensity[g];
    o.density = o.totalEdges ? +(o.internalEdges / o.totalEdges).toFixed(3) : 0;
  });

  // G. pattern matching
  const dirPatterns = [
    [/^(routes|api|controllers|endpoints|handlers|controller|routers|blueprints|serializers)$/, 'api'],
    [/^(services|core|lib|domain|logic|signals|composables|mailers|jobs|channels)$/, 'service'],
    [/^(models|db|data|persistence|repository|entities|migrations|entity|sql|database)$/, 'data'],
    [/^(components|views|pages|ui|layouts|screens)$/, 'ui'],
    [/^(middleware|plugins|interceptors|guards)$/, 'middleware'],
    [/^(utils|helpers|common|shared|tools|templatetags|pkg)$/, 'utility'],
    [/^(config|constants|env|settings|management|commands)$/, 'config'],
    [/^(__tests__|test|tests|spec|specs)$/, 'test'],
    [/^(types|interfaces|schemas|contracts|dtos|dto|request|response)$/, 'types'],
    [/^(hooks)$/, 'hooks'],
    [/^(store|state|reducers|actions|slices)$/, 'state'],
    [/^(assets|static|public)$/, 'assets'],
    [/^(cmd|bin|internal)$/, 'entry'],
    [/^(docs|documentation|wiki)$/, 'documentation'],
    [/^(deploy|deployment|infra|infrastructure|k8s|kubernetes|helm|charts|terraform|tf|docker)$/, 'infrastructure'],
    [/^(\.github|\.gitlab|\.circleci)$/, 'ci-cd'],
  ];
  function matchDir(name) {
    for (const [re, label] of dirPatterns) if (re.test(name)) return label;
    return null;
  }
  function matchFile(p) {
    const base = p.split('/').pop();
    if (/\.(test|spec)\./.test(base) || /^test_.*\.py$/.test(base) || /_test\.go$/.test(base) || /Test\.java$/.test(base) || /_spec\.rb$/.test(base)) return 'test';
    if (/\.d\.ts$/.test(base)) return 'types';
    if (/\.sql$/.test(base)) return 'data';
    if (/\.(graphql|gql|proto)$/.test(base)) return 'types';
    if (/\.(md|rst)$/.test(base)) return 'documentation';
    if (/^Dockerfile/.test(base) || /^docker-compose/.test(base)) return 'infrastructure';
    if (/\.(tf|tfvars)$/.test(base)) return 'infrastructure';
    if (base === 'vercel.json' || base === 'tsconfig.json' || base === 'package.json' || /\.(toml|yaml|yml)$/.test(base)) return 'config';
    return null;
  }
  const patternMatches = {};
  Object.keys(directoryGroups).forEach(g => {
    let m = matchDir(g);
    if (!m && g === '(root)') {
      // infer from file extensions of root members
      const cnt = {};
      directoryGroups[g].forEach(id => { const fm = matchFile(norm(idToNode[id].filePath)); if (fm) cnt[fm] = (cnt[fm] || 0) + 1; });
      m = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0] || 'mixed';
    }
    patternMatches[g] = m || 'unknown';
  });

  // H. deployment topology
  const allPaths = fileNodes.map(n => norm(n.filePath));
  const infraFiles = allPaths.filter(p => /Dockerfile|docker-compose|\.tf$|k8s|kubernetes|helm|\.github\/workflows|gitlab-ci|Jenkinsfile|vercel\.json/.test(p));
  const deploymentTopology = {
    hasDockerfile: allPaths.some(p => /Dockerfile/.test(p)),
    hasCompose: allPaths.some(p => /docker-compose/.test(p)),
    hasK8s: allPaths.some(p => /k8s|kubernetes|helm/.test(p)),
    hasTerraform: allPaths.some(p => /\.tf$/.test(p)),
    hasCI: allPaths.some(p => /\.github\/workflows|gitlab-ci|Jenkinsfile/.test(p)),
    hasVercel: allPaths.some(p => /vercel\.json/.test(p)),
    infraFiles
  };

  // I. data pipeline
  const dataPipeline = {
    schemaFiles: allPaths.filter(p => /\.sql$|\.graphql$|\.proto$|schema/.test(p)),
    migrationFiles: allPaths.filter(p => /migration/.test(p)),
    dataModelFiles: fileNodes.filter(n => (n.type === 'table' || n.type === 'schema')).map(n => n.id),
    apiHandlerFiles: fileNodes.filter(n => (n.tags || []).some(t => /api-handler|edge-function|service/.test(t))).map(n => n.id)
  };

  // J. doc coverage
  const groups = Object.keys(directoryGroups);
  const groupsWithDocsSet = new Set();
  groups.forEach(g => {
    if (directoryGroups[g].some(id => idToNode[id].type === 'document' || /\.md$/.test(norm(idToNode[id].filePath)))) groupsWithDocsSet.add(g);
  });
  const docCoverage = {
    groupsWithDocs: groupsWithDocsSet.size,
    totalGroups: groups.length,
    coverageRatio: groups.length ? +(groupsWithDocsSet.size / groups.length).toFixed(2) : 0,
    undocumentedGroups: groups.filter(g => !groupsWithDocsSet.has(g))
  };

  // K. dependency direction
  const pairSeen = {};
  const dependencyDirection = [];
  interGroupImports.forEach(({ from, to, count }) => {
    const key = [from, to].sort().join('|');
    if (pairSeen[key]) return;
    const rev = igMap[to + '->' + from] || 0;
    if (count >= rev) dependencyDirection.push({ dependent: from, dependsOn: to });
    else dependencyDirection.push({ dependent: to, dependsOn: from });
    pairSeen[key] = true;
  });

  const filesPerGroup = {};
  Object.keys(directoryGroups).forEach(g => { filesPerGroup[g] = directoryGroups[g].length; });
  const nodeTypeCounts = {};
  Object.keys(nodeTypeGroups).forEach(t => { nodeTypeCounts[t] = nodeTypeGroups[t].length; });

  const result = {
    scriptCompleted: true,
    commonPrefix: prefix,
    directoryGroups, nodeTypeGroups, crossCategoryEdges,
    interGroupImports, intraGroupDensity, patternMatches,
    deploymentTopology, dataPipeline, docCoverage, dependencyDirection,
    fileStats: { totalFileNodes: fileNodes.length, filesPerGroup, nodeTypeCounts },
    fileFanIn: fanIn, fileFanOut: fanOut
  };
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  process.exit(0);
}
try { main(); } catch (e) { console.error(e.stack || e.message); process.exit(1); }
