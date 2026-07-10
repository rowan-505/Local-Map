export class PublicMapApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'PublicMapApiError';
    this.status = status;
  }
}
