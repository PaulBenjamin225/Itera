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

// --- ROUTE HEALTH CHECK ---
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
app.post('/api/suggestions', async (req, res) => { // Route pour les suggestions d'autocomplétion
    const { query } = req.body; // Récupère le texte partiel depuis le corps de la requête

    if (!query) { // Vérifie que le texte partiel est fourni
        return res.status(400).json({ error: 'Une requête de recherche est requise.' }); // Renvoie une erreur si non fourni
    }

    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${process.env.MAPBOX_API_KEY}&autocomplete=true&types=place`; // URL de l'API Mapbox pour les suggestions

    try {
        const response = await axios.get(url); // Appel à l'API Mapbox
        const features = response.data.features; // Récupère les résultats

        // Formate les suggestions pour ne renvoyer que les informations nécessaires
        const suggestions = features.map(feature => ({ // Map chaque résultat pour extraire les champs pertinents
            id: feature.id, // Identifiant unique du lieu
            place_name: feature.place_name, // Nom complet du lieu
            center: feature.center, // Coordonnées [longitude, latitude]
        }));
        
        res.json(suggestions); // Renvoie les suggestions au format JSON

    } catch (error) {
        console.error("Erreur lors de l'appel à l'API de suggestion Mapbox:", error.message); // Log de l'erreur pour le débogage
        res.status(500).json({ error: 'Erreur serveur lors de la recherche de suggestions.' }); // Renvoie une erreur serveur
    }
});


/**
 * Route pour le géocodage simple (gardée pour d'éventuels futurs besoins).
 * Convertit une adresse textuelle exacte en coordonnées géographiques.
 * @route POST /api/geocode
 * @body { "location": "Nom de la ville ou de l'adresse" }
 * @returns { "coordinates": [longitude, latitude] } // Coordonnées géographiques
 */
app.post('/api/geocode', async (req, res) => { // Route pour le géocodage simple
    const { location } = req.body; // Récupère le nom du lieu depuis le corps de la requête

    if (!location) { // Vérifie que le nom du lieu est fourni
        return res.status(400).json({ error: 'Le nom du lieu est requis.' }); // Renvoie une erreur si non fourni
    }

    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(location)}.json?access_token=${process.env.MAPBOX_API_KEY}&limit=1`; // URL de l'API Mapbox pour le géocodage

    try {
        const response = await axios.get(url); // Appel à l'API Mapbox
        const features = response.data.features; // Récupère les résultats

        if (features && features.length > 0) { // Vérifie qu'il y a au moins un résultat
            const firstResult = features[0]; // Prend le premier résultat
            const coordinates = firstResult.center; // Récupère les coordonnées [longitude, latitude]
            res.json({ coordinates }); // Renvoie les coordonnées au format JSON
        } else {
            res.status(404).json({ error: `Lieu non trouvé pour "${location}".` }); // Renvoie une erreur si aucun lieu n'est trouvé
        }

    } catch (error) {
        console.error("Erreur lors de l'appel à l'API de Géocodage Mapbox:", error.message); // Log de l'erreur pour le débogage
        res.status(500).json({ error: 'Erreur serveur lors du géocodage.' }); // Renvoie une erreur serveur
    }
});


/**
 * Route pour le calcul d'itinéraire.
 * Calcule la distance et le tracé entre deux coordonnées géographiques.
 * @route POST /api/route
 * @body { "start": [lon, lat], "end": [lon, lat] }
 * @returns { "distance": 12345, "geometry": { ... } } // Distance en mètres et géométrie GeoJSON de l'itinéraire
 */
app.post('/api/route', async (req, res) => { // Route pour le calcul d'itinéraire
    const { start, end } = req.body; // Récupère les coordonnées de départ et d'arrivée depuis le corps de la requête

    if (!start || !end) { // Vérifie que les deux points sont fournis
        return res.status(400).json({ error: "Les coordonnées de départ et d'arrivée sont requises." }); // Renvoie une erreur si non fourni
    }

    const [startLon, startLat] = start; // Déstructure les coordonnées de départ
    const [endLon, endLat] = end; // Déstructure les coordonnées d'arrivée

    // Ajout de "&overview=full" pour demander à Mapbox une géométrie complète et détaillée.
    // Cela garantit que le tracé suit parfaitement les routes et les virages.
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${startLon},${startLat};${endLon},${endLat}?geometries=geojson&overview=full&access_token=${process.env.MAPBOX_API_KEY}`;

    // Appel à l'API Mapbox pour obtenir l'itinéraire
    try {
        const response = await axios.get(url); // Appel à l'API Mapbox
        const data = response.data; // Récupère les données de la réponse

        if (data.routes && data.routes.length > 0) { // Vérifie qu'il y a au moins un itinéraire
            const route = data.routes[0]; // Prend le premier itinéraire
            const routeGeometry = route.geometry; // Récupère la géométrie de l'itinéraire
            const distance = route.distance; // Récupère la distance de l'itinéraire (en mètres)

            res.json({ // Renvoie la distance et la géométrie au format JSON
                distance: distance, // Distance en mètres
                geometry: routeGeometry // Géométrie GeoJSON de l'itinéraire
            });
        } else {
            res.status(404).json({ error: 'Aucun itinéraire trouvé entre les points spécifiés.' }); // Renvoie une erreur si aucun itinéraire n'est trouvé
        }
    } catch (error) {
        console.error("Erreur lors de l'appel à l'API de Routage Mapbox:", error.message); // Log de l'erreur pour le débogage
        res.status(500).json({ error: "Erreur serveur lors du calcul de l'itinéraire." }); // Renvoie une erreur serveur
    }
});


// --- Démarrage du serveur ---
app.listen(PORT, () => {
    console.log(`✅ Le serveur est démarré et écoute sur le port ${PORT}`); // Message de confirmation au démarrage
});