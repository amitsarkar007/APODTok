// NASA API configuration
const API_KEY = window.NASA_API_KEY || 'NASA_API_KEY_PLACEHOLDER';
const API_URL = 'https://api.nasa.gov/planetary/apod';
const CACHE_SIZE = 5; // Number of images to cache in advance

// Proxy helper function
async function fetchWithProxy(url) {
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    const response = await fetch(proxyUrl);
    const data = await response.json();
    return JSON.parse(data.contents);
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
const errorContainer = document.getElementById('error');
const retryButton = document.getElementById('retry');

// State management
let apodCache = [];
let isFetching = false;
let touchStartY = 0;
let pullToRefreshActive = false;
let lastScrollTop = 0;
let isScrolling = false;
let scrollTimeout;

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
    try {
        const url = `${API_URL}?api_key=${API_KEY}&count=${CACHE_SIZE}`;
        const data = await fetchWithProxy(url);
        apodCache = data;
        displayAllAPODs();
        preloadNextImages();
    } catch (error) {
        console.error('Error initializing cache:', error);
        showError();
    } finally {
        hideLoading();
    }
}

// Preload next set of images
async function preloadNextImages() {
    if (isFetching) return;
    
    isFetching = true;
    try {
        const url = `${API_URL}?api_key=${API_KEY}&count=${CACHE_SIZE}`;
        const newImages = await fetchWithProxy(url);
        
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
            if (retryCount === 1 && apod.hdurl) {
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

function showError() {
    errorContainer.classList.remove('hidden');
}

function hideError() {
    errorContainer.classList.add('hidden');
} 