import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const DEFAULT_STORE = {
  version: 1,
  users: [],
  deviceTokens: [],
  bindings: [],
};

function cloneDefaultStore() {
  return JSON.parse(JSON.stringify(DEFAULT_STORE));
}

export class RelayStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = cloneDefaultStore();
    this.loaded = false;
  }

  async load() {
    if (this.loaded) {
      return this.state;
    }
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      this.state = {
        ...cloneDefaultStore(),
        ...parsed,
        users: Array.isArray(parsed?.users) ? parsed.users : [],
        deviceTokens: Array.isArray(parsed?.deviceTokens) ? parsed.deviceTokens : [],
        bindings: Array.isArray(parsed?.bindings) ? parsed.bindings : [],
      };
    } catch {
      await this.save();
    }
    this.loaded = true;
    return this.state;
  }

  async save() {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
  }

  getSnapshot() {
    return JSON.parse(JSON.stringify(this.state));
  }

  listUsers() {
    return [...this.state.users];
  }

  listDeviceTokens() {
    return [...this.state.deviceTokens];
  }

  listBindings() {
    return [...this.state.bindings];
  }

  getUserByToken(token) {
    if (!token) return null;
    return this.state.users.find((item) => item.token === token) || null;
  }

  getUserById(userId) {
    if (!userId) return null;
    return this.state.users.find((item) => item.userId === userId) || null;
  }

  getDeviceTokenEntry(token) {
    if (!token) return null;
    return this.state.deviceTokens.find((item) => item.token === token) || null;
  }

  listBindingsForUser(userId) {
    return this.state.bindings.filter((item) => item.userId === userId);
  }

  async upsertUser({ userId, name, token }) {
    let existing = this.getUserById(userId);
    if (!existing) {
      existing = {
        userId: userId || `user-${randomUUID().slice(0, 8)}`,
        name: name || userId || 'User',
        token: token || `relay-user-${randomUUID().replaceAll('-', '')}`,
        createdAt: Date.now(),
      };
      this.state.users.push(existing);
    } else {
      existing.name = name || existing.name;
      existing.token = token || existing.token;
    }
    await this.save();
    return existing;
  }

  async upsertDeviceToken({ deviceId, deviceName, token }) {
    let existing = this.state.deviceTokens.find((item) => item.deviceId === deviceId) || null;
    if (!existing) {
      existing = {
        deviceId,
        deviceName: deviceName || deviceId,
        token: token || `relay-device-${randomUUID().replaceAll('-', '')}`,
        createdAt: Date.now(),
      };
      this.state.deviceTokens.push(existing);
    } else {
      existing.deviceName = deviceName || existing.deviceName;
      existing.token = token || existing.token;
    }
    await this.save();
    return existing;
  }

  async bindUserToDevice({ userId, deviceId }) {
    const exists = this.state.bindings.some((item) => item.userId === userId && item.deviceId === deviceId);
    if (!exists) {
      this.state.bindings.push({
        userId,
        deviceId,
        createdAt: Date.now(),
      });
      await this.save();
    }
    return this.listBindingsForUser(userId);
  }
}
