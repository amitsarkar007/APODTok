// NASA API configuration
let API_KEY = null;
const API_URL = 'https://api.nasa.gov/planetary/apod';
const CACHE_SIZE = 5; // Number of images to fetch per batch
const LOCAL_CACHE_KEY = 'apodtok-last-batch';
const SLOW_HINT_DELAY_MS = 6000;

// Initialize API key from Netlify Function
async function initializeAPIKey() {
    try {
        // First try to get from window (if available)
        if (window.NASA_API_KEY) {
            API_KEY = window.NASA_API_KEY;
            return;
        }

        // Fallback to Netlify function
        const response = await fetch('/.netlify/functions/get-api-key', { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`Failed to fetch API key: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        if (!data.apiKey) {
            throw new Error('API key not found in response');
        }
        API_KEY = data.apiKey;
    } catch (error) {
        console.error('Failed to fetch API key:', error);
        showError();
        throw error;
    }
}

// Fetch APOD data directly from NASA with retry + backoff.
// (The old fallback to the free allorigins.win CORS proxy was removed:
//  that service is dead, and api.nasa.gov already allows browser requests.)
async function fetchAPODs(count) {
    const url = `${API_URL}?api_key=${API_KEY}&count=${count}`;
    const delays = [0, 3000, 8000]; // retry backoff
    let lastError = null;

    for (let attempt = 0; attempt < delays.length; attempt++) {
        if (delays[attempt] > 0) {
            await new Promise(resolve => setTimeout(resolve, delays[attempt]));
        }
        try {
            const response = await fetch(url);
            if (!response.ok) {
                // NASA is sometimes slow or returns 5xx during incidents - retry
                throw new Error(`NASA API responded ${response.status}`);
            }
            const data = await response.json();
            if (!Array.isArray(data) || data.length === 0) {
                throw new Error('NASA API returned no images');
            }
            return data;
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
        localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), apods }));
    } catch (e) {
        // storage full or unavailable - not critical
    }
}

function loadLocalBatch() {
    try {
        const raw = localStorage.getItem(LOCAL_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed.apods) && parsed.apods.length ? parsed.apods : null;
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
document.addEventListener('DOMContentLoaded', async () => {
    await initializeAPIKey();
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
        const data = await fetchAPODs(CACHE_SIZE);
        apodCache = data;
        saveLocalBatch(data);
        displayAllAPODs();
        preloadNextImages();
    } catch (error) {
        console.error('Error initializing cache:', error);
        if (!staleBatch) {
            showError();
        }
        // With a stale batch on screen, stay quiet: the user can keep browsing
        // and pull-to-refresh / Retry will try again.
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
        const newImages = await fetchAPODs(CACHE_SIZE);

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
        saveLocalBatch(apodCache.slice(-20)); // keep the stored batch small
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
        // For video content (usually YouTube)
        const iframe = document.createElement('iframe');
        iframe.className = 'apod-video';
        iframe.src = apod.url;
        iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
        iframe.allowFullscreen = true;
        apodCard.appendChild(iframe);
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
