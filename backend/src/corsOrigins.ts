export function isAllowedOrigin(origin: string): boolean {
  const frontendBaseUrl = process.env.FRONTEND_BASE_URL;
  const isDev = process.env.NODE_ENV !== 'production';

  if (frontendBaseUrl && origin === frontendBaseUrl) return true;

  try {
    const { hostname } = new URL(origin);
    // Netlify deploy previews/branch deploys use a `--` separator
    // (e.g. `deploy-preview-42--geogn2.netlify.app`), not a subdomain dot.
    if (
      hostname === 'geogn2.netlify.app' ||
      hostname.endsWith('.geogn2.netlify.app') ||
      hostname.endsWith('--geogn2.netlify.app')
    )
      return true;
    if (isDev && (hostname === 'localhost' || hostname === '127.0.0.1')) return true;
  } catch {
    return false;
  }

  return false;
}
