/** An error with a message that is safe and useful to show to the user. */
export class ReadingListSourceError extends Error {
  constructor(
    message: string,
    readonly originalError?: unknown,
  ) {
    super(message);
    this.name = 'ReadingListSourceError';
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
