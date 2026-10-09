# SEO and Google AdSense launch checklist

This site is a Vite + React single-page application with build-time HTML prerendering. Supabase is intentionally not modified by this guide.

## Required production environment variables

Configure these in the production build environment (for example, Cloudflare Pages → Settings → Environment variables) and trigger a fresh production deployment:

- `VITE_SITE_URL`: the canonical HTTPS origin of the real public domain, without a trailing slash (example format: `https://your-domain.example`). Use the exact domain selected in Google Search Console and AdSense. Do not leave the example value.
- `VITE_CONTACT_EMAIL`: a real monitored contact address for privacy, copyright and user requests.
- `VITE_ADSENSE_CLIENT_ID`: the publisher ID shown in the AdSense account, in the form `ca-pub-1234567890123456`. Do not invent an ID. This value is public by design and is not a secret.

The build generates `robots.txt` and `sitemap.xml` using `VITE_SITE_URL`. It prerenders the home page and public information pages, and generates `ads.txt` only when a valid AdSense publisher ID is configured. Book pages are prerendered only when their metadata is sufficiently complete and at least one HTTPS link was marked verified within the last 180 days.

## Google Search launch steps

1. Deploy the production site with the real `VITE_SITE_URL`.
2. Open `https://YOUR-DOMAIN/robots.txt` and `https://YOUR-DOMAIN/sitemap.xml`; check that the sitemap contains only canonical, public URLs.
3. Add the exact production domain to Google Search Console, verify ownership, and submit `sitemap.xml`.
4. Use URL Inspection on the home page, an information page, and several representative book pages. Confirm that the rendered HTML contains meaningful content and the intended canonical URL.
5. Validate structured data with Google's Rich Results Test when applicable. Structured data does not guarantee a rich result.
6. Check mobile usability and Core Web Vitals using PageSpeed Insights and real Search Console data. No code change can guarantee a top search position.

## Google AdSense launch steps

1. Publish accurate, complete privacy, service, contact, and copyright pages. Replace any operational placeholders with the actual operator/contact and retention information before submitting the site for review.
2. Ensure each indexed book page is useful and accurate, with correct publisher/title/grade details, meaningful original description, and working relevant source links. Do not index thin, duplicate, placeholder, or unverified pages just to increase page count.
3. Add the production domain in the AdSense account and complete Google's site review process.
4. After adding the production site to AdSense, copy the real publisher ID, set `VITE_ADSENSE_CLIENT_ID`, and redeploy before submitting the site for review. The build places Google's official asynchronous AdSense code in the HTML head of the home page and eligible book pages; it does not fabricate publisher IDs or ad-unit IDs.
5. Confirm `https://YOUR-DOMAIN/ads.txt` contains the generated publisher record. Google may take time to crawl and update the status.
6. In AdSense, configure Auto ads and review the placement preview. Ensure ads are not placed where they can be confused with navigation, answer links, download controls, or page content.
7. If the site serves users in the EEA, UK, or Switzerland, review Google's current consent requirements and use a Google-certified CMP where required.
8. Test the live site after deployment with browser developer tools. Confirm the AdSense script is not blocked by the Content Security Policy and that console/network errors are resolved.

## Important limitations

- Google Search rankings and AdSense approval are controlled by Google; neither can be guaranteed.
- The privacy and terms content is a baseline, not legal advice. Verify it against the actual data flows, hosting provider, analytics, cookies, operator identity, retention periods, and applicable Korean privacy requirements before publishing.
- AdSense requires a real account and publisher ID. The integration remains inactive until a valid `VITE_ADSENSE_CLIENT_ID` is supplied.
- Do not publish a fabricated `ads.txt` publisher record.
