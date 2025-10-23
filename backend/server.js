// =============================================
//              Serveur Backend
//      Application de Cartographie et Routage
// =============================================


// --- Importation des dépendances ---
require('dotenv').config(); // Pour charger les variables d'environnement depuis le fichier .env
const express = require('express'); // Framework web pour Node.js
const axios = require('axios');   // Client HTTP pour faire des requêtes (vers l'API Mapbox)
const cors = require('cors');     // Middleware pour gérer les requêtes Cross-Origin (CORS)


// --- Initialisation de l'application Express ---
const app = express();
// Prêt pour le déploiement : utilise le port fourni par l'environnement ou 5000 en local
const PORT = process.env.PORT || 5000;


// --- Middlewares ---
app.use(cors()); // Autorise les requêtes provenant de notre frontend
app.use(express.json()); // Permet à Express de comprendre le JSON envoyé dans le corps des requêtes


// =============================================
//          DÉFINITION DES ROUTES (API)
// =============================================

// --- CORRECTION : ROUTE HEALTH CHECK ---
// Ajout d'une route à la racine GET /
// C'est cette route que Render va appeler pour vérifier si le serveur est en vie.
// Elle doit renvoyer une réponse avec un code de succès (200).
app.get('/', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'API Itera est en ligne et prête.' });
});


/**
 * Route pour les suggestions d'autocomplétion.
 * Prend un texte partiel et renvoie une liste de villes correspondantes.
 * @route POST /api/suggestions
 * @body { "query": "Texte partiel tapé par l'utilisateur" }
 * @returns { [{ id, place_name, center }] }
 */
app.post('/api/suggestions', async (req, res) => {
    const { query } = req.body;

    if (!query) {
        return res.status(400).json({ error: 'Une requête de recherche est requise.' });
    }

    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${process.env.MAPBOX_API_KEY}&autocomplete=true&types=place`;

    try {
        const response = await axios.get(url);
        const features = response.data.features;
        
        const suggestions = features.map(feature => ({
            id: feature.id,
            place_name: feature.place_name,
            center: feature.center,
        }));
        
        res.json(suggestions);

    } catch (error) {
        console.error("Erreur lors de l'appel à l'API de suggestion Mapbox:", error.message);
        res.status(500).json({ error: 'Erreur serveur lors de la recherche de suggestions.' });
    }
});


/**
 * Route pour le géocodage simple (gardée pour d'éventuels futurs besoins).
 * Convertit une adresse textuelle exacte en coordonnées géographiques.
 * @route POST /api/geocode
 * @body { "location": "Nom de la ville ou de l'adresse" }
 * @returns { "coordinates": [longitude, latitude] }
 */
app.post('/api/geocode', async (req, res) => {
    const { location } = req.body;

    if (!location) {
        return res.status(400).json({ error: 'Le nom du lieu est requis.' });
    }

    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(location)}.json?access_token=${process.env.MAPBOX_API_KEY}&limit=1`;

    try {
        const response = await axios.get(url);
        const features = response.data.features;

        if (features && features.length > 0) {
            const firstResult = features[0];
            const coordinates = firstResult.center;
            res.json({ coordinates });
        } else {
            res.status(404).json({ error: `Lieu non trouvé pour "${location}".` });
        }

    } catch (error) {
        console.error("Erreur lors de l'appel à l'API de Géocodage Mapbox:", error.message);
        res.status(500).json({ error: 'Erreur serveur lors du géocodage.' });
    }
});


/**
 * Route pour le calcul d'itinéraire.
 * Calcule la distance et le tracé entre deux coordonnées géographiques.
 * @route POST /api/route
 * @body { "start": [lon, lat], "end": [lon, lat] }
 * @returns { "distance": 12345, "geometry": { ... } }
 */
app.post('/api/route', async (req, res) => {
    const { start, end } = req.body;

    if (!start || !end) {
        return res.status(400).json({ error: "Les coordonnées de départ et d'arrivée sont requises." });
    }

    const [startLon, startLat] = start;
    const [endLon, endLat] = end;

    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${startLon},${startLat};${endLon},${endLat}?geometries=geojson&access_token=${process.env.MAPBOX_API_KEY}`;

    try {
        const response = await axios.get(url);
        const data = response.data;

        if (data.routes && data.routes.length > 0) {
            const route = data.routes[0];
            const routeGeometry = route.geometry;
            const distance = route.distance;

            res.json({
                distance: distance,
                geometry: routeGeometry
            });
        } else {
            res.status(404).json({ error: 'Aucun itinéraire trouvé entre les points spécifiés.' });
        }
    } catch (error) {
        console.error("Erreur lors de l'appel à l'API de Routage Mapbox:", error.message);
        res.status(500).json({ error: "Erreur serveur lors du calcul de l'itinéraire." });
    }
});


// --- Démarrage du serveur ---
app.listen(PORT, () => {
    console.log(`✅ Le serveur est démarré et écoute sur le port ${PORT}`);
});