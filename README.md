# APODTok

A TikTok-style interface for browsing NASA's Astronomy Picture of the Day (APOD) with a modern, responsive design.

## Features

- Infinite vertical scroll through NASA's APOD images
- Random image loading on scroll-up
- Full-viewport image display
- Image metadata display (title, date)
- Pull-to-refresh functionality
- Smooth transitions and animations
- Mobile-first responsive design
- Offline support with service worker caching
- Error handling with retry mechanism
- Modern UI with Tailwind CSS
- Netlify deployment ready

## Project Structure

```
APODTok/
├── index.html        # Main application entry point
├── app.js            # Core application logic
├── styles.css        # Custom styles
├── sw.js             # Service worker for offline support
├── favicon.svg       # Application icon
├── netlify.toml      # Netlify deployment configuration
├── netlify/          # Netlify-specific configuration and functions
├── PRD.txt           # Product Requirements Document
├── LICENSE           # MIT License file
└── README.md         # Project documentation
```

## Setup

1. Clone the repository:
```bash
git clone https://github.com/amitsarkar007/APODTok.git
cd APODTok
```

2. Deploy to Netlify:
   - Push your repository to GitHub
   - Connect your repository to Netlify
   - Set the `NASA_API_KEY` environment variable in your Netlify site settings
   - Netlify will automatically deploy your site and replace the API key placeholder

3. For local development:
   - Open `index.html` in your web browser
   - Note: The API will work with the placeholder key for testing, but with rate limits

## API Key

To get your own NASA API key:
1. Visit https://api.nasa.gov/
2. Sign up for an API key
3. Add the key as an environment variable in your Netlify site settings

## Development

The project uses:
- Vanilla JavaScript for core functionality
- Tailwind CSS for styling
- Service Worker for offline support
- NASA APOD API for content
- Netlify for deployment and environment variable management

### Key Implementation Details
- Uses the NASA APOD API's random image endpoint
- Implements infinite scroll with smooth transitions
- Caches images and API responses for offline use
- Mobile-first responsive design
- No backend required - pure frontend implementation
- Environment variables managed through Netlify

## Deployment

The project is configured for deployment on Netlify. The `netlify.toml` file contains the necessary configuration for:
- Build settings
- Environment variables
- Automatic API key replacement using netlify-plugin-replace

## License

MIT License 