// Server-side APOD feed: calls NASA with the secret key and returns only
// the picture data, so NASA_API_KEY never reaches the browser.
// Query params:
//   days   (optional, 1-14, default 7) - how many days of pictures to return
//   before (optional, YYYY-MM-DD)      - return days strictly before this date
const API_URL = 'https://api.nasa.gov/planetary/apod';
const MAX_DAYS = 14;
const REQUEST_TIMEOUT_MS = 8000;

const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
};

// NASA sometimes answers 200 "success" with fake placeholder cards during
// its outages (title "NASA Science", the NASA logo as the image).
// Those are never real pictures, so they are filtered here and in the app.
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

async function fetchOneDay(dateStr, apiKey) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const response = await fetch(`${API_URL}?api_key=${apiKey}&date=${dateStr}`, { signal: controller.signal });
        if (!response.ok) return null;
        const apod = await response.json();
        return isRealAPOD(apod) ? apod : null;
    } catch (e) {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

exports.handler = async function (event) {
    const apiKey = process.env.NASA_API_KEY;
    if (!apiKey) {
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'NASA_API_KEY environment variable is not set' })
        };
    }

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

    const dates = [];
    for (let i = 0; i < days; i++) {
        const d = new Date(end);
        d.setUTCDate(d.getUTCDate() - i);
        dates.push(isoDate(d));
    }

    const results = await Promise.all(dates.map(d => fetchOneDay(d, apiKey)));
    const apods = results.filter(Boolean);

    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ apods, degraded: apods.length === 0 })
    };
};
