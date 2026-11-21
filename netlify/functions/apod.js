// Server-side APOD feed: pulls from NASA's new WordPress "APOD Basic" JSON
// API and returns only picture data. The legacy api.nasa.gov APOD API was
// migrated to this WordPress API on 2026-09-10 (legacy goes offline
// 2026-12-01; it answered with fake placeholder cards during the transition).
// The new API needs NO key, so no secret is involved anywhere.
// Docs: https://api.nasa.gov/assets/files/apod/APOD-APIs-and-RSS-info.pdf
//
// Query params:
//   days   (optional, 1-14, default 7) - how many days of pictures to return
//   before (optional, YYYY-MM-DD)      - return days strictly before this date
const WP_API = 'https://science.nasa.gov/wp-json/wp/v2/apod-basic';
const MAX_DAYS = 14;
const REQUEST_TIMEOUT_MS = 8000;

const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
};

// Safety net from the legacy-API outage: never let placeholder cards through.
function isRealAPOD(apod) {
    if (!apod || typeof apod.url !== 'string' || !apod.url) return false;
    if (apod.title === 'NASA Science') return false;
    if (apod.url.includes('nasa-logo')) return false;
    if (apod.hdurl && apod.hdurl.includes('nasa-logo')) return false;
    return true;
}

function isoDate(d) {
    return d.toISOString().slice(0, 10);
}

// '2026-11-20' -> '261120' (legacy YYMMDD date code the WP filters use)
function legacyCode(dateStr) {
    return dateStr.slice(2, 4) + dateStr.slice(5, 7) + dateStr.slice(8, 10);
}

// Ask the dynamic image service for a phone-friendly size when possible
function resized(url, width) {
    if (!url || !url.includes('dynamicimage')) return url;
    return url.split('?')[0] + `?w=${width}&fit=clip`;
}

function extractVideoSrc(html) {
    if (!html) return null;
    const video = html.match(/<video[^>]*src="([^"]+)"/i);
    if (video) return video[1];
    const iframe = html.match(/<iframe[^>]*src="([^"]+)"/i);
    if (iframe) return iframe[1];
    return null;
}

// Map the WordPress entry to the legacy APOD shape the app renders:
// { date, title, explanation, media_type, url, hdurl, copyright }
// Images: url = resized image, hdurl = full-size image.
// Videos: url = direct mp4 or embed src, hdurl = poster image.
function mapEntry(e) {
    if (!e || !e.date || !e.title) return null;
    const base = {
        date: e.date,
        title: e.title,
        explanation: e.explanation || '',
        copyright: e.copyright || undefined
    };
    if (e.media_type === 'image') {
        if (!e.hdurl) return null;
        return Object.assign(base, {
            media_type: 'image',
            url: resized(e.hdurl, 1200),
            hdurl: e.hdurl
        });
    }
    const src = extractVideoSrc(e.basic_html);
    if (!src) return null;
    return Object.assign(base, {
        media_type: 'video',
        url: src,
        hdurl: e.hdurl || undefined
    });
}

async function fetchRange(dateFrom, dateTo) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const url = `${WP_API}?date_from=${legacyCode(dateFrom)}&date_to=${legacyCode(dateTo)}&per_page=25`;
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) return [];
        const data = await response.json();
        if (!Array.isArray(data)) return [];
        return data.map(mapEntry).filter(isRealAPOD);
    } catch (e) {
        return [];
    } finally {
        clearTimeout(timer);
    }
}

exports.handler = async function (event) {
    const params = (event && event.queryStringParameters) || {};
    let days = parseInt(params.days, 10);
    if (!Number.isFinite(days) || days < 1) days = 7;
    days = Math.min(days, MAX_DAYS);

    // `before` is exclusive; default is tomorrow so today is included.
    let end = new Date();
    if (params.before && /^\d{4}-\d{2}-\d{2}$/.test(params.before)) {
        const candidate = new Date(params.before + 'T00:00:00Z');
        if (!isNaN(candidate.getTime())) {
            candidate.setUTCDate(candidate.getUTCDate() - 1);
            end = candidate;
        }
    }

    const newest = isoDate(end);
    const oldestDate = new Date(end);
    oldestDate.setUTCDate(oldestDate.getUTCDate() - (days - 1));
    const oldest = isoDate(oldestDate);

    const apods = (await fetchRange(oldest, newest))
        .sort((a, b) => (a.date < b.date ? 1 : -1));

    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ apods, degraded: apods.length === 0 })
    };
};
