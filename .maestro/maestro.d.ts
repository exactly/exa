export declare global {
  const http: {
    delete: (url: string, init: { headers?: HeadersInit }) => Response;
    get: (url: string) => { body: string };
    post: (url: string, init: Body & { headers?: HeadersInit }) => Response;
    put: (url: string, init: Body & { headers?: HeadersInit }) => Response;
    request: (
      url: string,
      init: Body & { headers?: HeadersInit } & {
        method: "CONNECT" | "DELETE" | "GET" | "HEAD" | "OPTIONS" | "PATCH" | "POST" | "PUT" | "TRACE";
      },
    ) => Response;
  };
}

export type Body =
  | { body?: string }
  | { multipartForm?: { data: { filePath: string; mediaType?: string }; uploadType: string } };
export type Response = { body: string; headers: Headers; ok: boolean; status: number };
