export class TimeoutError extends Error {
  ms: number

  constructor(label: string, ms: number) {
    super(`${label} timed out after ${formatDuration(ms)}`)
    this.name = "TimeoutError"
    this.ms = ms
  }
}

function formatDuration(ms: number) {
  if (ms % 1000 === 0) return `${ms / 1000}s`
  return `${(ms / 1000).toFixed(1)}s`
}

export function isAbortError(error: unknown) {
  return typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
}

export function isTimeoutError(error: unknown): error is TimeoutError {
  return error instanceof TimeoutError
}

export function errorMessage(error: unknown, fallback: string) {
  if (isTimeoutError(error)) return error.message
  if (typeof error === "string" && error.trim()) return error
  if (typeof error === "object" && error && "message" in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string" && message.trim()) return message
  }
  return fallback
}

export function withTimeout<T>(work: () => Promise<T>, ms: number, label: string): Promise<T> {
  const promise = work()

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms)

    promise.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}

export function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, ms: number, label: string) {
  const controller = new AbortController()
  const signal = init.signal
  const timedOut = { value: false }

  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener("abort", () => controller.abort(), { once: true })
  }

  const timer = setTimeout(() => {
    timedOut.value = true
    controller.abort()
  }, ms)

  return fetch(input, { ...init, signal: controller.signal }).catch((error) => {
    if (timedOut.value || (controller.signal.aborted && !signal?.aborted && isAbortError(error))) {
      throw new TimeoutError(label, ms)
    }
    throw error
  }).finally(() => clearTimeout(timer))
}
