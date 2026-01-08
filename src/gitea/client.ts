import { Agent, Dispatcher, Headers, RequestInit, Response, fetch } from 'undici';
import { logDebug } from '../util/logging';

export interface ClientOptions {
  baseUrl: string;
  token?: string;
  insecureSkipVerify?: boolean;
  timeoutMs?: number;
}

export class GiteaClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly agent: Dispatcher;
  private readonly timeoutMs: number;

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.agent = new Agent({
      connect: {
        rejectUnauthorized: !options.insecureSkipVerify
      }
    });
  }

  async getJson<T>(path: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
    const res = await this.request(path, init, timeoutMs);
    const text = await res.text();
    const contentType = res.headers.get('content-type') ?? '';
    if (!res.ok) {
      throw new Error(`Request failed (${res.status}): ${text || res.statusText}`);
    }
    if (contentType.includes('application/json')) {
      return JSON.parse(text) as T;
    }
    throw new Error(`Unexpected response type: ${contentType || 'unknown'}`);
  }

  async getText(path: string, init?: RequestInit, timeoutMs?: number): Promise<string> {
    const res = await this.request(path, init, timeoutMs);
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Request failed (${res.status}): ${text || res.statusText}`);
    }
    return text;
  }

  private async request(path: string, init?: RequestInit, timeoutOverride?: number): Promise<Response> {
    const url = `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
    const headers = new Headers(init?.headers ?? {});
    headers.set('accept', 'application/json');
    if (this.token) {
      headers.set('authorization', `token ${this.token}`);
    }
    const controller = new AbortController();
    const timeoutMs = timeoutOverride ?? this.timeoutMs;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      logDebug(`Request ${init?.method ?? 'GET'} ${url}`);
      const response = await fetch(url, {
        dispatcher: this.agent,
        ...init,
        headers,
        signal: controller.signal
      });
      return response as Response;
    } finally {
      clearTimeout(timeout);
    }
  }
}
