// Shared response reader for admin panel fetches.
//
// Every admin component was written as:
//
//   const json = await res.json()
//   if (!res.ok) alert(json.error ?? '…')
//   ...
//   catch { alert('Network error. Please try again.') }
//
// which parses before checking the status, so ANY non-JSON response throws
// and gets reported as a network problem. The case that actually bit: an
// expired admin session made middleware answer /admin/api/* with a redirect
// to the HTML login page, and every screen blamed the network. Middleware
// now returns a 401 with a JSON body, but the parse-before-check pattern
// would still mislabel a proxy error, a platform 502, or an empty body.
//
// Returns null when the response is OK, otherwise a message worth showing.
export async function readApiError(
  res: Response,
  fallback: string,
): Promise<string | null> {
  if (res.status === 401) {
    // Deliberately doesn't say "admin" session: this helper is also used by
    // ExcelDropzone, whose /api/import* routes are not behind the /admin
    // middleware gate, so a 401 there wouldn't mean an admin session at all.
    return 'Your session has expired or you are not signed in. Reload the page, sign in again, and retry.'
  }

  let body: unknown = null
  try {
    // clone() so callers that need the success payload can still read it —
    // a Response body can only be consumed once.
    body = await res.clone().json()
  } catch {
    // Not JSON: an error page, a proxy response, or an empty body. Surface
    // the status rather than pretending to know what happened.
    return res.ok ? null : `${fallback} (server returned ${res.status})`
  }

  if (res.ok) return null

  const message = (body as { error?: string } | null)?.error
  return message ?? `${fallback} (server returned ${res.status})`
}

// Message for the catch block, which should now only ever be a genuine
// transport failure — DNS, offline, connection reset, request aborted.
export const TRANSPORT_ERROR =
  "Couldn't reach the server. Check your connection and try again."
