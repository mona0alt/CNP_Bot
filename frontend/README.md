# NanoClaw Frontend

This is the web interface for NanoClaw.

## Development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start development server:
   ```bash
   npm run dev
   ```
   This will proxy API requests to `http://localhost:3000`.

## Build

To build for production:
```bash
npm run build
```
The artifacts will be in `dist/`, which is served by the backend.
