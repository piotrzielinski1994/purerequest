import type {
  Auth,
  HttpMethod,
  HttpVersion,
  KeyValue,
  RequestResponse,
} from "@/lib/workspace/model";

export type HttpRequest = {
  method: HttpMethod;
  url: string;
  headers: KeyValue[];
  body: string | null;
  auth: Auth;
  timeoutMs: number;
  httpVersion: HttpVersion;
  requestId: string;
};

export type HttpResponse = RequestResponse;

export type SendResult =
  | { ok: true; response: HttpResponse }
  | { ok: false; error: string; cancelled?: boolean };

export type HttpClient = {
  send: (req: HttpRequest) => Promise<SendResult>;
  cancel: (requestId: string) => Promise<void>;
};

export type ResponseState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "success"; response: HttpResponse }
  | { status: "error"; message: string };
