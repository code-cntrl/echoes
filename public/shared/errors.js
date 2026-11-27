// An error with an HTTP status. The shared rules throw it on the hub, in device-only mode and on a
// linked phone alike; the hub sends it as the response status.
export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
