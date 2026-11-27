export interface ReportBreadcrumb {
  type?: string;
  category?: string;
  level?: string;
  message?: string;
  timestamp?: number;
  data?: Record<string, unknown>;
}

export interface ReportableEvent {
  request?: {
    method?: string;
    url?: string;
    headers?: Record<string, string>;
  };
  user?: { id?: string | number; [key: string]: unknown };
  tags?: Record<string, unknown>;
  breadcrumbs?: ReportBreadcrumb[];
  extra?: Record<string, unknown>;
}

/** Error-report SDK data collection with every personal or payload source turned off. */
export const PRIVATE_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [] as never[],
  urlQueryParams: false,
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
};

const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;
const BREADCRUMB_DATA = ['method', 'status_code', 'url'] as const;

export function withoutQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

function headerValue(
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? headers[key] : undefined;
}

function scrubBreadcrumb(crumb: ReportBreadcrumb): ReportBreadcrumb {
  const out: ReportBreadcrumb = {
    type: crumb.type,
    category: crumb.category,
    level: crumb.level,
    timestamp: crumb.timestamp,
  };
  if (crumb.category !== 'console' && crumb.message) {
    out.message = withoutQuery(crumb.message);
  }
  if (crumb.data) {
    const data: Record<string, unknown> = {};
    for (const key of BREADCRUMB_DATA) {
      const value = crumb.data[key];
      if (value === undefined) continue;
      data[key] = typeof value === 'string' ? withoutQuery(value) : value;
    }
    out.data = data;
  }
  return out;
}

/** Keeps no bodies, cookies, headers, query strings or personal details; only the user id. */
export function scrubEvent<E extends ReportableEvent>(
  event: E,
  requestId?: string | null,
): E {
  const id = requestId ?? headerValue(event.request?.headers, 'x-request-id');
  const out: ReportableEvent = { ...event };
  if (event.request) {
    out.request = {
      method: event.request.method,
      url: event.request.url ? withoutQuery(event.request.url) : undefined,
    };
  }
  if (event.user) {
    out.user = event.user.id === undefined ? {} : { id: event.user.id };
  }
  if (event.breadcrumbs) {
    out.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  }
  if (id && REQUEST_ID.test(id)) {
    out.tags = { ...event.tags, request_id: id };
  }
  return out as E;
}
