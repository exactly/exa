export default class ServiceError extends Error {
  constructor(
    service: string,
    readonly status: number,
    cause?: unknown,
    type?: string,
    detail?: string,
  ) {
    if (type === undefined && detail === undefined && typeof cause === "string" && cause) {
      try {
        const payload = JSON.parse(cause) as unknown;
        if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
          const p = payload as Record<string, unknown>;
          if (typeof p.error === "string" && p.error && p.error !== "Error") type = p.error;
          else if (typeof p.code === "string" && p.code !== "Error" && p.code.endsWith("Error")) type = p.code;
          if (typeof p.message === "string" && p.message) detail = p.message;
          else if (Array.isArray(p.errors)) {
            const first = p.errors[0] as Record<string, unknown> | undefined;
            if (typeof first?.title === "string" && first.title) detail = first.title;
          }
          if (!detail && typeof p.err === "string" && p.err) detail = p.err;
        }
      } catch {
        const title = /<title>([^<]+)<\/title>/i.exec(cause);
        if (title?.[1]) detail = title[1];
        else if (!cause.includes("<") && cause.length <= 200) detail = cause;
      }
    }
    super(detail || `${status}`, { cause }); // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- empty string must fall back to status
    this.name = `${service}${type && type !== "Error" ? type.replace(/Error$/, "") : status}`;
  }
}
