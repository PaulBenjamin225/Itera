// =============================================
//              Serveur Backend
//      Application de Cartographie et Routage
// =============================================

require("dotenv").config();

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const https = require("https");

const app = express();
const PORT = process.env.PORT || 5000;

// ================================
//          CONFIG GLOBALE
// ================================

// Keep-alive : améliore les performances des appels sortants vers Mapbox
const httpsAgent = new https.Agent({ keepAlive: true });

// Middlewares
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Rate limit pour éviter le spam (surtout sur /api/suggestions)
const suggestionsLimiter = rateLimit({
  windowMs: 10 * 1000, // 10s
  max: 30, // 30 requêtes / 10s / IP
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/suggestions", suggestionsLimiter);

// Vérifie la présence de la clé API
if (!process.env.MAPBOX_API_KEY) {
  console.warn("⚠️ MAPBOX_API_KEY manquante dans le .env (ou variables Render).");
}

// ================================
//            CACHE TTL
// ================================
const SUGGEST_TTL_MS = 60_000; // 60 sec
const suggestCache = new Map(); // key -> { exp, data }

function cacheGet(key) {
  const v = suggestCache.get(key);
  if (!v) return null;
  if (Date.now() > v.exp) {
    suggestCache.delete(key);
    return null;
  }
  return v.data;
}

function cacheSet(key, data) {
  suggestCache.set(key, { exp: Date.now() + SUGGEST_TTL_MS, data });
}

// ================================
//              ROUTES
// ================================

// Health check
app.get("/", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "API Itera est en ligne et prête.",
  });
});

/**
 * Route suggestions d'autocomplétion (Mapbox Geocoding).
 * @route POST /api/suggestions
 * @body { "query": "abid", "proximity": [lon, lat] (optionnel) }
 * @returns { [{ id, place_name, center }] }
 */
app.post("/api/suggestions", async (req, res) => {
  try {
    let { query, proximity } = req.body;

    query = (query || "").trim();
    if (query.length < 2) {
      return res.json([]);
    }

    // Proximity optionnel : si non fourni, valeur par défaut (Abidjan)
    const defaultProximity = [-4.0083, 5.3097];
    const prox =
      Array.isArray(proximity) &&
      proximity.length === 2 &&
      Number.isFinite(proximity[0]) &&
      Number.isFinite(proximity[1])
        ? proximity
        : defaultProximity;

    // Cache key
    const cacheKey = `${query.toLowerCase()}|${prox[0].toFixed(3)},${prox[1].toFixed(3)}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    // URL Mapbox (optimisée)
    const url =
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
      `?access_token=${process.env.MAPBOX_API_KEY}` +
      `&autocomplete=true` +
      `&types=place` +
      `&limit=7` +
      `&language=fr` +
      `&country=CI` +
      `&proximity=${prox[0]},${prox[1]}`;

    const response = await axios.get(url, {
      timeout: 6000,
      httpsAgent,
      validateStatus: () => true,
    });

    if (response.status >= 400) {
      console.error("Mapbox suggestions error:", response.status, response.data);
      return res.status(502).json({ error: "Erreur côté Mapbox (suggestions)." });
    }

    const features = response.data?.features || [];
    const suggestions = features.map((f) => ({
      id: f.id,
      place_name: f.place_name,
      center: f.center,
    }));

    cacheSet(cacheKey, suggestions);
    return res.json(suggestions);
  } catch (error) {
    const isTimeout = error.code === "ECONNABORTED";
    console.error("Erreur /api/suggestions:", isTimeout ? "timeout" : error.message);
    return res.status(500).json({
      error: "Erreur serveur lors de la recherche de suggestions.",
    });
  }
});

/**
 * Route géocodage simple.
 * @route POST /api/geocode
 * @body { "location": "Abidjan" }
 * @returns { "coordinates": [lon, lat] }
 */
app.post("/api/geocode", async (req, res) => {
  try {
    const location = (req.body?.location || "").trim();
    if (!location) return res.status(400).json({ error: "Le nom du lieu est requis." });

    const url =
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(location)}.json` +
      `?access_token=${process.env.MAPBOX_API_KEY}` +
      `&limit=1` +
      `&language=fr` +
      `&country=CI`;

    const response = await axios.get(url, {
      timeout: 6000,
      httpsAgent,
      validateStatus: () => true,
    });

    if (response.status >= 400) {
      console.error("Mapbox geocode error:", response.status, response.data);
      return res.status(502).json({ error: "Erreur côté Mapbox (géocodage)." });
    }

    const features = response.data?.features || [];
    if (!features.length) {
      return res.status(404).json({ error: `Lieu non trouvé pour "${location}".` });
    }

    const coordinates = features[0].center;
    return res.json({ coordinates });
  } catch (error) {
    const isTimeout = error.code === "ECONNABORTED";
    console.error("Erreur /api/geocode:", isTimeout ? "timeout" : error.message);
    return res.status(500).json({ error: "Erreur serveur lors du géocodage." });
  }
});

/**
 * Route calcul itinéraire (Mapbox Directions).
 * @route POST /api/route
 * @body { "start": [lon, lat], "end": [lon, lat] }
 *
 * @returns {
 *  distance: number,
 *  duration: number,
 *  feature: GeoJSONFeature(LineString)
 * }
 */
app.post("/api/route", async (req, res) => {
  try {
    const { start, end } = req.body || {};

    const validPoint = (p) =>
      Array.isArray(p) &&
      p.length === 2 &&
      Number.isFinite(p[0]) &&
      Number.isFinite(p[1]);

    if (!validPoint(start) || !validPoint(end)) {
      return res.status(400).json({
        error: "Les coordonnées de départ et d'arrivée sont requises sous forme [lon, lat].",
      });
    }

    const [startLon, startLat] = start;
    const [endLon, endLat] = end;

    const url =
      `https://api.mapbox.com/directions/v5/mapbox/driving/${startLon},${startLat};${endLon},${endLat}` +
      `?geometries=geojson` +
      `&overview=full` +
      `&access_token=${process.env.MAPBOX_API_KEY}`;

    const response = await axios.get(url, {
      timeout: 8000,
      httpsAgent,
      validateStatus: () => true,
    });

    if (response.status >= 400) {
      console.error("Mapbox route error:", response.status, response.data);
      return res.status(502).json({ error: "Erreur côté Mapbox (routage)." });
    }

    const data = response.data;
    if (!data?.routes?.length) {
      return res.status(404).json({
        error: "Aucun itinéraire trouvé entre les points spécifiés.",
      });
    }

    const route = data.routes[0];

    // Feature GeoJSON directement utilisable côté frontend
    const feature = {
      type: "Feature",
      properties: {
        distance: route.distance,
        duration: route.duration,
      },
      geometry: route.geometry,
    };

    return res.json({
      distance: route.distance, // mètres
      duration: route.duration, // secondes
      feature, // GeoJSON Feature(LineString)
    });
  } catch (error) {
    const isTimeout = error.code === "ECONNABORTED";
    console.error("Erreur /api/route:", isTimeout ? "timeout" : error.message);
    return res.status(500).json({
      error: "Erreur serveur lors du calcul de l'itinéraire.",
    });
  }
});

// ================================
//           DÉMARRAGE
// ================================
app.listen(PORT, () => {
  console.log(`✅ Le serveur est démarré et écoute sur le port ${PORT}`);
});
