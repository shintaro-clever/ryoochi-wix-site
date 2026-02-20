#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

const distDir = path.join(__dirname, 'apps', 'hub', 'dist');
const staticDir = path.join(__dirname, 'apps', 'hub', 'static');
const staticJobs = path.join(staticDir, 'jobs.html');
const STATIC_ROUTE_PREFIX = '/static';
// Quick smoke test: node server.js → curl -I http://127.0.0.1:3000/jobs

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch (error) {
    return false;
  }
}

function isSubPath(baseDir, target) {
  const relative = path.relative(baseDir, target);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

function serveFile(res, filePath, method = 'GET') {
  const ext = path.extname(filePath).toLowerCase();
  const contentType =
    {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.mjs': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8'
    }[ext] || 'text/plain; charset=utf-8';
  const headers = { 'Content-Type': contentType };
  try {
    const stats = fs.statSync(filePath);
    headers['Content-Length'] = stats.size;
  } catch {
    // ignore stat errors; stream will handle read issues below
  }
  res.writeHead(200, headers);
  if (method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(filePath)
    .on('error', () => {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Failed to read file');
    })
    .pipe(res);
}

function tryServeStatic(baseDir, requestPath, res, method) {
  const relative = requestPath.replace(/^\//, '') || 'index.html';
  const filePath = path.join(baseDir, relative);
  if (!isSubPath(baseDir, filePath) || !fileExists(filePath)) {
    return false;
  }
  serveFile(res, filePath, method);
  return true;
}

function tryServeStaticRoute(urlPath, res, method) {
  if (!urlPath.startsWith(STATIC_ROUTE_PREFIX)) {
    return false;
  }
  let relative = urlPath.slice(STATIC_ROUTE_PREFIX.length) || '/';
  if (!relative.startsWith('/')) {
    relative = `/${relative}`;
  }
  return tryServeStatic(staticDir, relative, res, method);
}

function resolveJobsPath() {
  if (fileExists(staticJobs)) {
    return staticJobs;
  }
  const distIndex = path.join(distDir, 'index.html');
  if (fileExists(distIndex)) {
    return distIndex;
  }
  return null;
}

function handleJobs(res, method) {
  const jobsPath = resolveJobsPath();
  if (jobsPath) {
    serveFile(res, jobsPath, method);
    return;
  }
  res.writeHead(500, { 'Content-Type': 'text/plain' });
  res.end('Missing Hub UI (fallback not found)');
}

const server = http.createServer((req, res) => {
  const urlPath = (req.url || '').split('?')[0] || '/';
  const method = (req.method || 'GET').toUpperCase();
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(`${method} ${urlPath} -> ${res.statusCode} (${elapsedMs.toFixed(1)}ms)`);
  });
  const isGetLikeMethod = method === 'GET' || method === 'HEAD';
  if (isGetLikeMethod && (urlPath === '/jobs' || urlPath === '/jobs/')) {
    handleJobs(res, method);
    return;
  }
  if (method === 'GET' && urlPath === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  if (isGetLikeMethod && urlPath === '/') {
    res.writeHead(302, { Location: '/jobs' });
    res.end();
    return;
  }
  if (
    isGetLikeMethod &&
    (urlPath === STATIC_ROUTE_PREFIX || urlPath.startsWith(`${STATIC_ROUTE_PREFIX}/`))
  ) {
    if (tryServeStaticRoute(urlPath, res, method)) {
      return;
    }
  }
  if (isGetLikeMethod) {
    const served =
      (fileExists(path.join(distDir, 'index.html')) &&
        tryServeStatic(distDir, urlPath, res, method)) ||
      tryServeStatic(staticDir, urlPath, res, method);
    if (served) {
      return;
    }
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, () => {
  const jobsTarget = resolveJobsPath() || 'missing';
  console.log(`Hub fallback server listening on http://localhost:${PORT}`);
  console.log(`/jobs serves: ${jobsTarget}`);
  console.log(`Static mount: ${staticDir} -> ${STATIC_ROUTE_PREFIX}`);
});
