# ShareBite

Full-stack food donation and surplus sharing platform connecting donors and NGOs with Real AI food vision verification.

## Features
- **Donor Portal**: Upload surplus food photos with mandatory Real AI vision inspection and verification.
- **NGO Dashboard**: Browse available surplus food donations and accept them for community distribution.
- **AI Food Vision**: Multimodal vision analysis powered by Google Gemini to inspect and verify genuine, edible food while rejecting non-food uploads.
- **Zero Configuration Database**: Embedded SQLite database (`foodshare.db`).

## Setup & Running
1. Clone the repository
2. Add your Gemini API key in `.env`:
   ```env
   GEMINI_API_KEY=your_gemini_api_key
   ```
3. Run the application:
   ```bash
   node server.js
   ```
4. Open [http://localhost:3000](http://localhost:3000)
