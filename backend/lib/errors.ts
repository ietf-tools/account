/**
 * Reading a message off a caught value.
 *
 * Every `catch` here receives an `unknown` — the thrown thing can be one of our
 * own error classes, a DOMException from `fetch`, or anything a dependency chose
 * to throw. The routes narrow to the error classes they handle and rethrow the
 * rest; this is for the handful of places that only want to *log* or forward the
 * message and shouldn't care which it was.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message
  }
  return String(err)
}
