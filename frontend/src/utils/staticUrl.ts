const API_URL = import.meta.env.VITE_API_URL || ''

/**
 * Converts relative static URLs to absolute URLs pointing to the API server.
 * This is needed when frontend and backend are on different domains.
 */
export function getStaticUrl(url: string | null | undefined): string | null {
  if (!url) return null

  // If it's an emoji avatar, return as-is
  if (url.startsWith('emoji:')) return url

  // If it's already an absolute URL, return as-is
  if (url.startsWith('http://') || url.startsWith('https://')) return url

  // If it's a relative static URL, prepend API_URL
  if (url.startsWith('/static/')) {
    return `${API_URL}${url}`
  }

  return url
}
