export declare global {
  const http: {
    get: (url: string) => { body: string };
    post: (url: string, init: { headers?: HeadersInit } & Body) => Response;
    put: (url: string, init: { headers?: HeadersInit } & Body) => Response;
    delete: (url: string, init: { headers?: HeadersInit }) => Response;
    request: (
      url: string,
      init: {
        method: "CONNECT" | "DELETE" | "GET" | "HEAD" | "OPTIONS" | "PATCH" | "POST" | "PUT" | "TRACE";
      } & { headers?: HeadersInit } & Body,
    ) => Response;
  };
  const output: { id?: number };
}

export type Body =
  | { body?: string }
  | { multipartForm?: { uploadType: string; data: { filePath: string; mediaType?: string } } };
export type Response = { ok: boolean; status: number; body: string; headers: Headers };
