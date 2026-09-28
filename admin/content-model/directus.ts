/** Minimal Directus REST client for the apply script (Node ≥ 20 fetch). */

export class DirectusError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    body: string
  ) {
    super(`${method} ${path} → ${status}: ${body.slice(0, 500)}`);
    this.name = 'DirectusError';
  }
}

export class Directus {
  private token: string | null = null;

  constructor(private readonly baseUrl: string) {}

  /** /server/ping is public; since Directus 12, /server/health needs a login. */
  async waitUntilHealthy(timeoutMs = 120_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let last = '';
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${this.baseUrl}/server/ping`);
        if (res.ok) return;
        last = `HTTP ${res.status}`;
      } catch (error) {
        last = (error as Error).message;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`Directus at ${this.baseUrl} did not become healthy: ${last}`);
  }

  async login(email: string, password: string): Promise<void> {
    const res = await this.request<{ access_token: string }>('POST', '/auth/login', { email, password }, false);
    this.token = res.access_token;
  }

  useToken(token: string): void {
    this.token = token;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }
  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }
  patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  /** GET that resolves to null on 403/404 (Directus answers 403 for unknown collections). */
  async find<T>(path: string): Promise<T | null> {
    try {
      return await this.get<T>(path);
    } catch (error) {
      if (error instanceof DirectusError && (error.status === 403 || error.status === 404)) return null;
      throw error;
    }
  }

  private async request<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (auth && this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new DirectusError(res.status, method, path, text);
    if (!text) return undefined as T;
    const parsed = JSON.parse(text) as { data?: T };
    return (parsed.data ?? parsed) as T;
  }
}
