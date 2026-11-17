/** Telling production from local dev: code compares the request's hostname with SITE_URL's. Pure. */

export function productionHostname(siteUrl: string | undefined): string {
  try {
    return new URL(siteUrl ?? '').hostname;
  } catch {
    return 'gallery.jaygovindsahu.com';
  }
}

/** Dev-only switches (DEV_BYPASS_AUTH, AI_MOCK) are honoured only when this is false. */
export function isProductionHost(hostname: string, siteUrl: string | undefined): boolean {
  return hostname === productionHostname(siteUrl);
}
