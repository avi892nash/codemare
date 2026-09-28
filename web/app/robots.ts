import type { MetadataRoute } from 'next';

/**
 * /robots.txt. Crawlers stay out of the hidden Library, the authoring tools
 * and the dev-only design sheet (those pages also carry `noindex`).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/library', '/author', '/dev'] }],
  };
}
