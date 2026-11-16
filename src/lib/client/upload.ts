/** HTTP helpers for the upload queue: JSON calls with retries and an XHR PUT with progress. */

export class RequestFailed extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
  /** Retry on network failures and server errors, never on a rejected request. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

async function readError(status: number, text: string): Promise<RequestFailed> {
  try {
    const body = JSON.parse(text) as { error?: { code?: string; message?: string } };
    return new RequestFailed(status, body.error?.code ?? 'error', body.error?.message ?? `HTTP ${status}`);
  } catch {
    return new RequestFailed(status, 'error', text.slice(0, 200) || `HTTP ${status}`);
  }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch (err) {
    throw new RequestFailed(0, 'network', (err as Error).message || 'Network error');
  }
  if (!res.ok) throw await readError(res.status, await res.text());
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Up to `attempts` tries with exponential backoff (600 ms, 1.2 s, 2.4 s). */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3, onRetry?: (n: number) => void): Promise<T> {
  let last: unknown;
  for (let n = 0; n < attempts; n++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const retryable = err instanceof RequestFailed ? err.retryable : true;
      if (!retryable || n === attempts - 1) break;
      onRetry?.(n + 1);
      await new Promise((r) => setTimeout(r, 600 * 2 ** n));
    }
  }
  throw last;
}

export interface PutResult {
  id: string;
  status: string;
  width: number;
  height: number;
  bytes: number;
  unverified?: boolean;
}

/** PUT the raw file with upload progress; XHR because fetch has no upload progress events. */
export function putFile(path: string, file: File, headers: Record<string, string>, onProgress: (fraction: number) => void): Promise<PutResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', path);
    xhr.setRequestHeader('content-type', file.type);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as PutResult);
        } catch {
          reject(new RequestFailed(xhr.status, 'bad_response', 'Unreadable response'));
        }
      } else {
        readError(xhr.status, xhr.responseText).then(reject);
      }
    };
    xhr.onerror = () => reject(new RequestFailed(0, 'network', 'Network error during upload'));
    xhr.onabort = () => reject(new RequestFailed(0, 'aborted', 'Upload cancelled'));
    xhr.send(file);
  });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
