import { randomUUID } from 'node:crypto';
import { loadConfig } from './config.js';
import { ENROLLMENT_GRANT_MS } from './constants.js';
import { enrollmentGrantHash, randomToken } from './crypto.js';
import { MemoryStore } from './memory-store.js';
import { createRequestNotifier } from './notify.js';
import { PostgresStore } from './postgres-store.js';
import { AccessService } from './service.js';
import { createWebAuthn } from './webauthn.js';

let runtimePromise;

async function buildRuntime() {
  const config = loadConfig();
  const store = config.memory ? new MemoryStore() : new PostgresStore(config.databaseURL);
  const service = new AccessService({ config, store, webauthn: createWebAuthn(config), notifier: createRequestNotifier(config.requestMail) });

  if (config.memory && process.env.ACCESS_DEV_ENROLLMENT_TOKEN) {
    const token = process.env.ACCESS_DEV_ENROLLMENT_TOKEN;
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new Error('ACCESS_DEV_ENROLLMENT_TOKEN must be base64url');
    const now = Date.now();
    const holder = {
      id: randomUUID(),
      publicId: process.env.ACCESS_DEV_PUBLIC_ID || 'PROB–H–LOCAL',
      webauthnUserId: randomToken(),
      condition: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    await store.seedHolder(holder, {
      id: randomUUID(),
      holderId: holder.id,
      tokenHash: enrollmentGrantHash(token),
      createdAt: now,
      expiresAt: now + ENROLLMENT_GRANT_MS,
      consumedAt: null,
    });
  }

  return { config, store, service };
}

export function getRuntime() {
  if (!runtimePromise) runtimePromise = buildRuntime();
  return runtimePromise;
}

export function resetRuntimeForTests() {
  runtimePromise = undefined;
}
