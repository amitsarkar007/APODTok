// NASA APOD feed configuration.
// The API key never reaches the browser: a Netlify Function calls NASA
// server-side (with the key stored only on Netlify) and returns the data.
const FEED_URL = '/.netlify/functions/apod';
const BATCH_DAYS = 7; // Number of random pictures to fetch per batch
const LOCAL_CACHE_KEY = 'apodtok-last-batch';
const SLOW_HINT_DELAY_MS = 6000;

// NASA's API sometimes answers 200 "success" with fake placeholder cards
// during its outages (title "NASA Science", the NASA logo as the image).
// Those are never real pictures, so they are filtered everywhere.
function isRealAPOD(apod) {
    if (!apod || typeof apod.url !== 'string' || !apod.url) return false;
    if (apod.title === 'NASA Science') return false;
    if (apod.url.includes('nasa-logo')) return false;
    if (apod.hdurl && apod.hdurl.includes('nasa-logo')) return false;
    return true;
}

// Fetch a random batch of APODs from our Netlify Function with retry + backoff.
async function fetchAPODs(count) {
    const url = `${FEED_URL}?mode=random&count=${count}`;
    const delays = [0, 3000, 8000]; // retry backoff
    let lastError = null;

    for (let attempt = 0; attempt < delays.length; attempt++) {
        if (delays[attempt] > 0) {
            await new Promise(resolve => setTimeout(resolve, delays[attempt]));
        }
        try {
            const response = await fetch(url, { cache: 'no-store' });
            if (!response.ok) {
                // The function may be slow or return 5xx during incidents - retry
                throw new Error(`Feed responded ${response.status}`);
            }
            const payload = await response.json();
            const apods = (Array.isArray(payload) ? payload : (payload.apods || []))
                .filter(isRealAPOD);
            if (apods.length === 0) {
                throw new Error('No real pictures available from NASA right now');
            }
            return apods;
        } catch (error) {
            console.warn(`APOD fetch attempt ${attempt + 1} failed:`, error);
            lastError = error;
        }
    }
    throw lastError || new Error('Failed to load images from NASA');
}

// Local cache of the last good batch, so the site still opens with content
// when NASA's API is slow or having an outage.
function saveLocalBatch(apods) {
    try {
        const realOnly = (apods || []).filter(isRealAPOD);
        if (realOnly.length === 0) return; // never save placeholder cards
        localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), apods: realOnly }));
    } catch (e) {
        // storage full or unavailable - not critical
    }
}

function loadLocalBatch() {
    try {
        const raw = localStorage.getItem(LOCAL_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed.apods)) return null;
        const realOnly = parsed.apods.filter(isRealAPOD);
        if (realOnly.length === 0) {
            // Cache held only placeholder cards from a NASA outage - purge it
            localStorage.removeItem(LOCAL_CACHE_KEY);
            return null;
        }
        return realOnly;
    } catch (e) {
        return null;
    }
}

// Register Service Worker
if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost')) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => {
                console.log('ServiceWorker registration successful');
            })
            .catch(error => {
                console.error('ServiceWorker registration failed:', error);
            });
    });
}

// DOM elements
const apodContainer = document.getElementById('apod-container');
const loadingIndicator = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');
const errorContainer = document.getElementById('error');
const retryButton = document.getElementById('retry');
const noticeContainer = document.getElementById('notice');

// State management
let apodCache = [];
let isFetching = false;
let touchStartY = 0;
let pullToRefreshActive = false;
let isScrolling = false;
let scrollTimeout;
let slowHintTimer = null;

// About modal functionality
const aboutButton = document.getElementById('about-button');
const aboutModal = document.getElementById('about-modal');
const closeAbout = document.getElementById('close-about');

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
    initializeCache();
    setupEventListeners();
});

// Initialize cache with initial set of images
async function initializeCache() {
    showLoading();
    hideError();

    // Render the last good batch instantly while NASA responds (or fails)
    const staleBatch = loadLocalBatch();
    if (staleBatch) {
        apodCache = staleBatch;
        displayAllAPODs();
    }

    startSlowHint();
    try {
        const data = await fetchAPODs(BATCH_DAYS);
        apodCache = data;
        saveLocalBatch(data);
        displayAllAPODs();
        hideNotice();
        preloadNextImages();
    } catch (error) {
        console.error('Error initializing cache:', error);
        if (!staleBatch) {
            showError();
        } else {
            // Real pictures are already on screen - be honest that they are saved ones
            showNotice();
        }
        // Pull-to-refresh / Retry will try again.
    } finally {
        stopSlowHint();
        hideLoading();
    }
}

// Preload next set of images
async function preloadNextImages() {
    if (isFetching) return;

    isFetching = true;
    try {
        // Random batches can overlap what is already on screen; retry a few
        // times so scrolling keeps producing fresh pictures.
        const known = new Set(apodCache.map(a => a.date));
        let newImages = [];
        for (let attempt = 0; attempt < 3 && newImages.length === 0; attempt++) {
            const fresh = await fetchAPODs(BATCH_DAYS);
            newImages = fresh.filter(a => !known.has(a.date));
        }
        if (newImages.length === 0) return;

        // Start preloading images before adding them to the DOM
        const preloadPromises = newImages
            .filter(apod => apod.media_type === 'image')
            .map(apod => {
                // Try to preload both regular and HD versions
                const promises = [preloadImage(apod.url)];
                if (apod.hdurl) {
                    promises.push(preloadImage(apod.hdurl));
                }
                return Promise.allSettled(promises);
            });

        // Wait for all preload attempts to complete (success or failure)
        await Promise.all(preloadPromises);

        apodCache = [...apodCache, ...newImages];
        saveLocalBatch(apodCache.slice(0, 20)); // keep the stored batch small (newest first)
        appendNewAPODs(newImages);
    } catch (error) {
        console.error('Error preloading images:', error);
    } finally {
        isFetching = false;
    }
}

// Display all APODs in the cache
function displayAllAPODs() {
    apodContainer.innerHTML = '';
    apodCache.forEach(apod => {
        const apodCard = createAPODCard(apod);
        apodContainer.appendChild(apodCard);
    });
}

// Append new APODs to the container
function appendNewAPODs(newImages) {
    newImages.forEach(apod => {
        const apodCard = createAPODCard(apod);
        apodContainer.appendChild(apodCard);
    });
}

// Create an APOD card element
function createAPODCard(apod) {
    const apodCard = document.createElement('div');
    apodCard.className = 'apod-card';

    // Handle different media types
    if (apod.media_type === 'video') {
        if (/\.(mp4|webm|ogg)(\?|$)/i.test(apod.url)) {
            // Direct video file (NASA's WordPress APOD feed)
            const video = document.createElement('video');
            video.className = 'apod-video';
            video.controls = true;
            video.playsInline = true;
            video.preload = 'metadata';
            if (apod.hdurl) {
                video.poster = apod.hdurl;
            }
            video.src = apod.url;
            apodCard.appendChild(video);
        } else {
            // For embedded video content (usually YouTube)
            const iframe = document.createElement('iframe');
            iframe.className = 'apod-video';
            iframe.src = apod.url;
            iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
            iframe.allowFullscreen = true;
            apodCard.appendChild(iframe);
        }
    } else {
        // For image content
        const image = document.createElement('img');
        image.className = 'apod-image';

        // Add loading state
        image.classList.add('loading');
        const loader = document.createElement('div');
        loader.className = 'image-loader';
        apodCard.appendChild(loader);

        let retryCount = 0;
        const maxRetries = 2; // Will try url, then hdurl if available

        const tryLoadImage = (url) => {
            image.src = url;
        };

        // Handle image load success
        image.onload = () => {
            image.classList.remove('loading');
            image.classList.add('loaded');
            loader.remove();
        };

        // Handle image load error with retry logic
        image.onerror = () => {
            retryCount++;
            if (retryCount < maxRetries && apod.hdurl) {
                // Try loading HD version if available
                console.log(`Retrying with HD URL for ${apod.title}`);
                tryLoadImage(apod.hdurl);
            } else {
                loader.remove();
                const errorDiv = document.createElement('div');
                errorDiv.className = 'image-error';
                errorDiv.innerHTML = `
                    <p>Failed to load image</p>
                    <small>${apod.title}</small>
                `;
                apodCard.appendChild(errorDiv);
            }
        };

        // Start loading the image
        tryLoadImage(apod.url);
        image.alt = apod.title;
        apodCard.appendChild(image);
    }

    const info = document.createElement('div');
    info.className = 'apod-info';

    const title = document.createElement('div');
    title.className = 'apod-title';
    title.textContent = apod.title;

    const date = document.createElement('div');
    date.className = 'apod-date';
    date.textContent = new Date(apod.date).toLocaleDateString();

    info.appendChild(title);
    info.appendChild(date);
    apodCard.appendChild(info);

    return apodCard;
}

// Preload images function
function preloadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(url);
        img.onerror = () => reject(url);
        img.src = url;
    });
}

// Event listeners setup
function setupEventListeners() {
    // Scroll event for infinite scroll
    apodContainer.addEventListener('scroll', handleScroll);

    // Touch events for pull-to-refresh with passive option
    apodContainer.addEventListener('touchstart', handleTouchStart, { passive: true });
    apodContainer.addEventListener('touchmove', handleTouchMove, { passive: true });
    apodContainer.addEventListener('touchend', handleTouchEnd, { passive: true });

    // Mouse events for pull-to-refresh
    apodContainer.addEventListener('mousedown', handleMouseDown);
    apodContainer.addEventListener('mousemove', handleMouseMove);
    apodContainer.addEventListener('mouseup', handleMouseUp);

    // Retry button
    retryButton.addEventListener('click', initializeCache);

    // About button
    aboutButton.addEventListener('click', () => {
        aboutModal.classList.add('active');
    });

    // Close modal
    closeAbout.addEventListener('click', () => {
        aboutModal.classList.remove('active');
    });

    // Close modal when clicking outside
    aboutModal.addEventListener('click', (e) => {
        if (e.target === aboutModal) {
            aboutModal.classList.remove('active');
        }
    });
}

// Scroll handler for infinite scroll
function handleScroll() {
    if (isScrolling) {
        clearTimeout(scrollTimeout);
    }

    isScrolling = true;
    scrollTimeout = setTimeout(() => {
        isScrolling = false;

        const scrollTop = apodContainer.scrollTop;
        const scrollHeight = apodContainer.scrollHeight;
        const clientHeight = apodContainer.clientHeight;

        // Check if we're near the bottom
        if (scrollHeight - scrollTop - clientHeight < 100) {
            preloadNextImages();
        }
    }, 150);
}

// Touch event handlers
function handleTouchStart(e) {
    if (apodContainer.scrollTop === 0) {
        touchStartY = e.touches[0].clientY;
    }
}

function handleTouchMove(e) {
    if (touchStartY === 0) return;

    const touchY = e.touches[0].clientY;
    const pullDistance = touchY - touchStartY;

    if (pullDistance > 0 && apodContainer.scrollTop === 0) {
        e.preventDefault();
        pullToRefreshActive = true;
        apodContainer.style.transform = `translateY(${pullDistance}px)`;
    }
}

function handleTouchEnd() {
    if (pullToRefreshActive) {
        apodContainer.style.transform = '';
        initializeCache();
    }
    touchStartY = 0;
    pullToRefreshActive = false;
}

// Mouse event handlers
function handleMouseDown(e) {
    if (apodContainer.scrollTop === 0) {
        touchStartY = e.clientY;
    }
}

function handleMouseMove(e) {
    if (touchStartY === 0) return;

    const mouseY = e.clientY;
    const pullDistance = mouseY - touchStartY;

    if (pullDistance > 0 && apodContainer.scrollTop === 0) {
        e.preventDefault();
        pullToRefreshActive = true;
        apodContainer.style.transform = `translateY(${pullDistance}px)`;
    }
}

function handleMouseUp() {
    if (pullToRefreshActive) {
        apodContainer.style.transform = '';
        initializeCache();
    }
    touchStartY = 0;
    pullToRefreshActive = false;
}

// UI helper functions
function showLoading() {
    loadingIndicator.classList.remove('hidden');
}

function hideLoading() {
    loadingIndicator.classList.add('hidden');
}

function startSlowHint() {
    stopSlowHint();
    if (loadingText) {
        loadingText.textContent = 'Loading images from NASA...';
        slowHintTimer = setTimeout(() => {
            loadingText.textContent = "NASA's API is slow right now - still trying...";
        }, SLOW_HINT_DELAY_MS);
    }
}

function stopSlowHint() {
    if (slowHintTimer) {
        clearTimeout(slowHintTimer);
        slowHintTimer = null;
    }
}

function showError() {
    errorContainer.classList.remove('hidden');
}

function hideError() {
    errorContainer.classList.add('hidden');
}

function showNotice() {
    if (noticeContainer) noticeContainer.classList.remove('hidden');
}

function hideNotice() {
    if (noticeContainer) noticeContainer.classList.add('hidden');
}
