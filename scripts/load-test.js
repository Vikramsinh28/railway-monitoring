#!/usr/bin/env node
import { io } from 'socket.io-client';
import { setTimeout as delay } from 'timers/promises';

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const baseUrl = args.url || process.env.TARGET_URL || 'http://localhost:3000';
const kiosksCount = toNumber(args.kiosks, 1);
const monitorsCount = toNumber(args.monitors, 1);
const durationSeconds = toNumber(args.duration, 30);
const concurrency = toNumber(args.concurrency, 5);
const startMonitoring = args.startMonitoring !== false;
const timeoutMs = toNumber(args.timeout, 10000);
const transport = ['websocket', 'polling'].includes(args.transport) ? args.transport : null;

const runId = Date.now().toString(36);
const kioskPrefix = `kiosk_${runId}`;
const monitorPrefix = `monitor_${runId}`;

const metrics = {
  kioskConnectMs: [],
  kioskRegisterMs: [],
  monitorConnectMs: [],
  monitorRegisterMs: [],
  monitorStartMs: [],
  errors: 0
};

const sockets = [];

async function runWithLimit(items, limit, worker) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (queue.length) {
      const next = queue.shift();
      if (next === undefined) {
        return;
      }
      await worker(next);
    }
  });

  await Promise.all(workers);
}

async function main() {
  console.log(`Target: ${baseUrl}`);
  console.log(`Kiosks: ${kiosksCount}, Monitors: ${monitorsCount}, Concurrency: ${concurrency}`);
  console.log(`Start monitoring: ${startMonitoring}, Timeout: ${timeoutMs}ms`);
  if (transport) {
    console.log(`Transport: ${transport}`);
  }

  const kioskIds = [];

  await runWithLimit(Array.from({ length: kiosksCount }, (_, i) => i), concurrency, async (i) => {
    try {
      const { token, clientId } = await registerAndLogin('user', kioskPrefix, i);
      kioskIds.push(clientId);
      await connectAndRegisterKiosk(token, clientId);
    } catch (error) {
      metrics.errors += 1;
      console.error(`Kiosk ${i} error: ${error.message}`);
    }
  });

  const targetKioskId = kioskIds[0];

  await runWithLimit(Array.from({ length: monitorsCount }, (_, i) => i), concurrency, async (i) => {
    try {
      const { token } = await registerAndLogin('monitor', monitorPrefix, i);
      await connectAndRegisterMonitor(token, targetKioskId);
    } catch (error) {
      metrics.errors += 1;
      console.error(`Monitor ${i} error: ${error.message}`);
    }
  });

  console.log('All clients connected. Holding open connections...');
  await delay(durationSeconds * 1000);

  sockets.forEach((socket) => socket.disconnect());
  console.log('Disconnected all clients.');

  printSummary(metrics);
}

async function registerAndLogin(userType, prefix, index) {
  const username = `${prefix}_${index}@test.local`;
  const password = 'pass1234';

  const registerRes = await httpPost('/api/auth/register', {
    username,
    password,
    userType,
    name: `${prefix}_${index}`
  });

  if (registerRes && !registerRes.ok && registerRes.status !== 409) {
    const errorMessage = registerRes.data?.error || 'unknown error';
    throw new Error(`Register failed (${registerRes.status}) for ${username}: ${errorMessage}`);
  }

  const loginRes = await httpPost('/api/auth/login', {
    username,
    password,
    userType
  });

  if (!loginRes?.ok || !loginRes?.data?.success || !loginRes?.data?.token) {
    const errorMessage = loginRes?.data?.error || 'unknown error';
    const status = loginRes?.status ?? 'n/a';
    throw new Error(`Login failed (${status}) for ${username}: ${errorMessage}`);
  }

  return { token: loginRes.data.token, clientId: loginRes.data.user.clientId };
}

async function connectAndRegisterKiosk(token, kioskId) {
  const t0 = Date.now();
  const socketOptions = transport ? { auth: { token }, transports: [transport] } : { auth: { token } };
  const socket = io(baseUrl, socketOptions);
  sockets.push(socket);

  socket.on('connect_error', (error) => {
    metrics.errors += 1;
    console.error(`Kiosk connect_error: ${error.message || error}`);
  });

  await waitForEvent(socket, 'connect', timeoutMs);
  metrics.kioskConnectMs.push(Date.now() - t0);

  const t1 = Date.now();
  socket.emit('register-kiosk');
  await waitForEvent(socket, 'kiosk-registered', timeoutMs);
  metrics.kioskRegisterMs.push(Date.now() - t1);

  socket.on('error', () => { metrics.errors += 1; });

  return kioskId;
}

async function connectAndRegisterMonitor(token, kioskId) {
  const t0 = Date.now();
  const socketOptions = transport ? { auth: { token }, transports: [transport] } : { auth: { token } };
  const socket = io(baseUrl, socketOptions);
  sockets.push(socket);

  socket.on('connect_error', (error) => {
    metrics.errors += 1;
    console.error(`Monitor connect_error: ${error.message || error}`);
  });

  await waitForEvent(socket, 'connect', timeoutMs);
  metrics.monitorConnectMs.push(Date.now() - t0);

  const t1 = Date.now();
  socket.emit('register-monitor');
  await waitForEvent(socket, 'monitor-registered', timeoutMs);
  metrics.monitorRegisterMs.push(Date.now() - t1);

  if (startMonitoring && kioskId) {
    const t2 = Date.now();
    socket.emit('start-monitoring', { kioskId });
    await waitForEvent(socket, 'monitoring-started', timeoutMs);
    metrics.monitorStartMs.push(Date.now() - t2);
  }

  socket.on('error', () => { metrics.errors += 1; });
}

async function httpPost(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    data
  };
}

function waitForEvent(socket, event, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for ${event}`));
    }, ms);

    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });

    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function printSummary(m) {
  console.log('\nSummary:');
  printMetric('Kiosk connect', m.kioskConnectMs);
  printMetric('Kiosk register', m.kioskRegisterMs);
  printMetric('Monitor connect', m.monitorConnectMs);
  printMetric('Monitor register', m.monitorRegisterMs);
  if (m.monitorStartMs.length) {
    printMetric('Monitor start', m.monitorStartMs);
  }
  console.log(`Errors: ${m.errors}`);
}

function printMetric(label, values) {
  if (!values.length) {
    console.log(`${label}: no samples`);
    return;
  }
  const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  const p95 = percentile(values, 95);
  const max = Math.max(...values);
  console.log(`${label}: avg ${avg}ms | p95 ${p95}ms | max ${max}ms | n=${values.length}`);
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      out.help = true;
      break;
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (value && !value.startsWith('--')) {
        out[key] = value;
        i += 1;
      } else {
        out[key] = true;
      }
    }
  }
  if (out.startMonitoring === 'false') {
    out.startMonitoring = false;
  }
  return out;
}

function toNumber(value, fallback) {
  if (value === undefined) return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function printHelp() {
  console.log(`\nRailway Monitoring Load Test\n\n` +
    `Usage:\n` +
    `  node scripts/load-test.js --url https://webrtc-test.divyavyoma.cloud --kiosks 5 --monitors 5 --duration 30\n\n` +
    `Options:\n` +
    `  --url <url>           Server base URL (default: http://localhost:3000)\n` +
    `  --kiosks <n>           Number of kiosk clients (default: 1)\n` +
    `  --monitors <n>         Number of monitor clients (default: 1)\n` +
    `  --duration <sec>       Hold connections open (default: 30)\n` +
    `  --concurrency <n>      Concurrent setup workers (default: 5)\n` +
    `  --timeout <ms>         Per-step timeout (default: 10000)\n` +
    `  --transport <type>     Force transport: websocket or polling\n` +
    `  --startMonitoring      Start sessions from monitors (default: true)\n` +
    `  --help                 Show this help\n`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
