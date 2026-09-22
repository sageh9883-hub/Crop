# Gabinarou WebView APK Builder

API de génération d'applications Android WebView.

## API

POST /api/build

Exemple :

{
  "url": "https://example.com/",
  "name": "Mon Application",
  "packageName": "com.example.monapplication",
  "iconUrl": "https://example.com/icon.png",
  "versionName": "1.0.0"
}

Réponse :

{
  "success": true,
  "jobId": "...",
  "status": "queued",
  "statusUrl": "/api/build/..."
}

Puis :

GET /api/build/:id

Lorsque le build est terminé :

GET /api/download/:id

## Health

GET /health

## Sécurité

Définir BUILDER_API_KEY dans Render pour protéger l'API.

Ne jamais mettre une clé privée Android dans GitHub.
