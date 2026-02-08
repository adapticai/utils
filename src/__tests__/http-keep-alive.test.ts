import { describe, it, expect } from 'vitest';
import http from 'http';
import https from 'https';

import {
  KEEP_ALIVE_DEFAULTS,
  httpAgent,
  httpsAgent,
  getAgentPoolStatus,
  verifyFetchKeepAlive,
} from '../utils/http-keep-alive';

describe('KEEP_ALIVE_DEFAULTS', () => {
  it('should have keepAlive enabled', () => {
    expect(KEEP_ALIVE_DEFAULTS.keepAlive).toBe(true);
  });

  it('should have reasonable socket limits', () => {
    expect(KEEP_ALIVE_DEFAULTS.maxSockets).toBeGreaterThan(0);
    expect(KEEP_ALIVE_DEFAULTS.maxTotalSockets).toBeGreaterThan(KEEP_ALIVE_DEFAULTS.maxSockets);
    expect(KEEP_ALIVE_DEFAULTS.maxFreeSockets).toBeGreaterThan(0);
  });

  it('should have keepAlive milliseconds configured', () => {
    expect(KEEP_ALIVE_DEFAULTS.keepAliveMsecs).toBeGreaterThan(0);
  });

  it('should have a timeout configured', () => {
    expect(KEEP_ALIVE_DEFAULTS.timeout).toBeGreaterThan(0);
  });
});

describe('httpAgent', () => {
  it('should be an instance of http.Agent', () => {
    expect(httpAgent).toBeInstanceOf(http.Agent);
  });

  it('should have keepAlive enabled', () => {
    expect(httpAgent.keepAlive).toBe(true);
  });

  it('should have correct maxSockets', () => {
    expect(httpAgent.maxSockets).toBe(KEEP_ALIVE_DEFAULTS.maxSockets);
  });

  it('should have correct maxFreeSockets', () => {
    expect(httpAgent.maxFreeSockets).toBe(KEEP_ALIVE_DEFAULTS.maxFreeSockets);
  });
});

describe('httpsAgent', () => {
  it('should be an instance of https.Agent', () => {
    expect(httpsAgent).toBeInstanceOf(https.Agent);
  });

  it('should have keepAlive enabled', () => {
    expect(httpsAgent.keepAlive).toBe(true);
  });

  it('should have correct maxSockets', () => {
    expect(httpsAgent.maxSockets).toBe(KEEP_ALIVE_DEFAULTS.maxSockets);
  });

  it('should have correct maxFreeSockets', () => {
    expect(httpsAgent.maxFreeSockets).toBe(KEEP_ALIVE_DEFAULTS.maxFreeSockets);
  });
});

describe('getAgentPoolStatus', () => {
  it('should return pool status for http agent', () => {
    const status = getAgentPoolStatus(httpAgent, 'http-test');
    expect(status.name).toBe('http-test');
    expect(status.keepAlive).toBe(true);
    expect(typeof status.activeSockets).toBe('number');
    expect(typeof status.freeSockets).toBe('number');
    expect(typeof status.pendingRequests).toBe('number');
    expect(status.maxSockets).toBe(KEEP_ALIVE_DEFAULTS.maxSockets);
    expect(status.maxFreeSockets).toBe(KEEP_ALIVE_DEFAULTS.maxFreeSockets);
  });

  it('should return pool status for https agent', () => {
    const status = getAgentPoolStatus(httpsAgent, 'https-test');
    expect(status.name).toBe('https-test');
    expect(status.keepAlive).toBe(true);
  });

  it('should report zero active sockets on fresh agent', () => {
    const freshAgent = new http.Agent({ keepAlive: true });
    const status = getAgentPoolStatus(freshAgent, 'fresh');
    expect(status.activeSockets).toBe(0);
    expect(status.freeSockets).toBe(0);
    expect(status.pendingRequests).toBe(0);
    freshAgent.destroy();
  });

  it('should use default name when none provided', () => {
    const status = getAgentPoolStatus(httpAgent);
    expect(status.name).toBe('default');
  });

  it('should handle agent without keepAlive', () => {
    const noKeepAliveAgent = new http.Agent({ keepAlive: false });
    const status = getAgentPoolStatus(noKeepAliveAgent, 'no-keep-alive');
    expect(status.keepAlive).toBe(false);
    noKeepAliveAgent.destroy();
  });
});

describe('verifyFetchKeepAlive', () => {
  it('should return supported status', () => {
    const result = verifyFetchKeepAlive();
    expect(result.supported).toBe(true);
  });

  it('should return the current Node.js version', () => {
    const result = verifyFetchKeepAlive();
    expect(result.nodeVersion).toBe(process.version);
  });

  it('should detect undici built-in for Node.js >= 18', () => {
    const result = verifyFetchKeepAlive();
    const majorVersion = parseInt(process.version.slice(1).split('.')[0], 10);

    if (majorVersion >= 18) {
      expect(result.undiciBuiltIn).toBe(true);
      expect(result.keepAliveExpected).toBe(true);
    }
  });

  it('should confirm keep-alive is expected for Node.js >= 20', () => {
    const result = verifyFetchKeepAlive();
    const majorVersion = parseInt(process.version.slice(1).split('.')[0], 10);

    // This package requires Node >= 20 per package.json
    if (majorVersion >= 20) {
      expect(result.keepAliveExpected).toBe(true);
    }
  });
});

describe('Connection pooling documentation verification', () => {
  it('should confirm native fetch is available (Node >= 18)', () => {
    expect(typeof globalThis.fetch).toBe('function');
  });

  it('should confirm http.Agent supports keepAlive', () => {
    const agent = new http.Agent({ keepAlive: true });
    expect(agent.keepAlive).toBe(true);
    agent.destroy();
  });

  it('should confirm https.Agent supports keepAlive', () => {
    const agent = new https.Agent({ keepAlive: true });
    expect(agent.keepAlive).toBe(true);
    agent.destroy();
  });
});
