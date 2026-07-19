export async function apiRequest<T>(input: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body !== undefined && init.body !== null;
  const defaultHeaders =
    hasBody && !(init?.body instanceof FormData)
      ? {
          "content-type": "application/json",
        }
      : {};
  const response = await fetch(input, {
    headers: {
      ...defaultHeaders,
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(extractErrorMessage(text) || `HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await response.json()) as T;
  }

  return (await response.text()) as T;
}

export function toJsonBody(value: unknown): RequestInit {
  return {
    method: "POST",
    body: JSON.stringify(value),
  };
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return extractErrorMessage(error.message);
  }

  return "操作失败，请稍后重试。";
}

function extractErrorMessage(text: string): string {
  if (!text) {
    return "";
  }

  try {
    const parsed = JSON.parse(text) as { message?: string };
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message;
    }
  } catch {
    // Ignore JSON parse failures and fall back to the original text.
  }

  return text;
}
