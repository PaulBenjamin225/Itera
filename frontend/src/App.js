import React, { useRef, useEffect, useState } from 'react'; //  import des dépendances React
import mapboxgl from 'mapbox-gl'; // import de la bibliothèque Mapbox GL JS
import axios from 'axios'; // import de la bibliothèque Axios pour les requêtes HTTP
import { Box, TextField, Button, List, ListItemButton, ListItemText, Paper, Typography, CircularProgress, ListItemIcon } from '@mui/material'; // import des composants Material-UI
import PlaceIcon from '@mui/icons-material/Place'; // import de l'icône de lieu Material-UI
import { ToastContainer, toast } from 'react-toastify'; // import de la bibliothèque React Toastify pour les notifications
import 'react-toastify/dist/ReactToastify.css'; // import du CSS de React Toastify
import 'mapbox-gl/dist/mapbox-gl.css'; // import du CSS de Mapbox GL JS
import './App.css'; // import du CSS personnalisé de l'application
import logo from './assets/Itera_logo.png'; // import du logo de l'application

// Configuration de Mapbox
if (!process.env.REACT_APP_MAPBOX_TOKEN) {
    console.error("ERREUR CRITIQUE: La variable d'environnement REACT_APP_MAPBOX_TOKEN est manquante.");
}

mapboxgl.accessToken = process.env.REACT_APP_MAPBOX_TOKEN; // Clé d'accès Mapbox depuis les variables d'environnement
 
const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000'; // URL de base de l'API backend

// Hook personnalisé pour le debounce
function useDebounce(value, delay) {
    const [debouncedValue, setDebouncedValue] = useState(value); // État pour stocker la valeur décalée
    useEffect(() => {
        const handler = setTimeout(() => { setDebouncedValue(value); }, delay); // Met à jour la valeur décalée après le délai spécifié
        return () => { clearTimeout(handler); }; // Nettoie le timeout si la valeur ou le délai changent avant la fin du délai
    }, [value, delay]); // Déclenche l'effet lorsque la valeur ou le délai changent
    return debouncedValue; // Retourne la valeur décalée
}

// Composant principal de l'application
function App() {
    const mapContainer = useRef(null); // Référence au conteneur de la carte
    const map = useRef(null); // Référence à l'objet carte Mapbox
    const markers = useRef([]); // Référence aux marqueurs sur la carte
    const [isLoading, setIsLoading] = useState(false); // État pour indiquer si le calcul de l'itinéraire est en cours
    const [startAddress, setStartAddress] = useState(''); // État pour l'adresse de départ
    const [endAddress, setEndAddress] = useState(''); // État pour l'adresse d'arrivée
    const [startSuggestions, setStartSuggestions] = useState([]); // État pour les suggestions d'adresses de départ
    const [endSuggestions, setEndSuggestions] = useState([]); // État pour les suggestions d'adresses d'arrivée
    const [startCoords, setStartCoords] = useState(null); // État pour les coordonnées de départ
    const [endCoords, setEndCoords] = useState(null); // État pour les coordonnées d'arrivée
    const [distance, setDistance] = useState(null); // État pour la distance de l'itinéraire

    // Ajout des états pour suivre le focus des champs de texte
    const [isStartFocused, setIsStartFocused] = useState(false); 
    const [isEndFocused, setIsEndFocused] = useState(false);

    // Utilisation du hook de debounce pour les adresses
    const debouncedStartAddress = useDebounce(startAddress, 300);
    const debouncedEndAddress = useDebounce(endAddress, 300);

    // Initialisation de la carte Mapbox
    useEffect(() => {
        if (map.current) return; // initialise la carte uniquement une fois
        if (!mapContainer.current) return; // vérifie que le conteneur de la carte est prêt
        map.current = new mapboxgl.Map({ // Crée une nouvelle carte Mapbox
            container: mapContainer.current, // conteneur HTML pour la carte
            style: 'mapbox://styles/mapbox/streets-v12', // style de la carte
            center: [-4.0083, 5.35995], // centre initial [longitude, latitude] (Afrique de l'Ouest)
            zoom: 5, // niveau de zoom initial
        });
        const resizeObserver = new ResizeObserver(() => { if (map.current) map.current.resize(); }); // Assure que la carte redimensionne correctement
        resizeObserver.observe(mapContainer.current); // Observe les changements de taille du conteneur de la carte
        return () => resizeObserver.disconnect(); // Nettoie l'observateur lors du démontage du composant
    }, []);

    // Récupération des suggestions d'adresses pour le départ
    useEffect(() => {
        if (debouncedStartAddress.length > 2 && !startCoords) { // Vérifie la longueur de l'adresse et si les coordonnées ne sont pas déjà définies
            const fetchSuggestions = async () => { // Fonction pour récupérer les suggestions
                try {
                    const response = await axios.post(`${API_BASE_URL}/api/suggestions`, { query: debouncedStartAddress }); // Appel à l'API backend pour les suggestions
                    setStartSuggestions(response.data); // Mise à jour des suggestions dans l'état
                } catch { toast.error("Le service de suggestion est indisponible."); } // Gestion des erreurs
            };
            fetchSuggestions(); // Appel de la fonction pour récupérer les suggestions
        } else {
            setStartSuggestions([]); // Vide les suggestions si l'adresse est trop courte ou si les coordonnées sont déjà définies
        }
    }, [debouncedStartAddress, startCoords]);

    // Récupération des suggestions d'adresses pour l'arrivée
    useEffect(() => {
        if (debouncedEndAddress.length > 2 && !endCoords) { // Vérifie la longueur de l'adresse et si les coordonnées ne sont pas déjà définies
            const fetchSuggestions = async () => { // Fonction pour récupérer les suggestions
                try {
                    const response = await axios.post(`${API_BASE_URL}/api/suggestions`, { query: debouncedEndAddress }); // Appel à l'API backend pour les suggestions
                    setEndSuggestions(response.data);
                } catch { toast.error("Le service de suggestion est indisponible."); }
            };
            fetchSuggestions(); // Appel de la fonction pour récupérer les suggestions
        } else {
            setEndSuggestions([]); // Vide les suggestions si l'adresse est trop courte ou si les coordonnées sont déjà définies
        }
    }, [debouncedEndAddress, endCoords]);

    // Gestion du clic sur une suggestion
    const handleSuggestionClick = (suggestion, type) => { 
        if (type === 'start') {
            setStartAddress(suggestion.place_name); // Met à jour l'adresse de départ
            setStartCoords(suggestion.center); // Met à jour les coordonnées de départ
            setStartSuggestions([]); // Vide les suggestions de départ
        } else {
            setEndAddress(suggestion.place_name); // Met à jour l'adresse d'arrivée
            setEndCoords(suggestion.center); // Met à jour les coordonnées d'arrivée
            setEndSuggestions([]); // Vide les suggestions d'arrivée
        }
    };

    // Nettoie uniquement les éléments visuels de la carte
    const clearMapElements = () => {
        markers.current.forEach(marker => marker.remove()); // Supprime tous les marqueurs de la carte
        markers.current = []; // Réinitialise le tableau des marqueurs
        if (map.current?.getLayer('route')) { map.current.removeLayer('route'); } // Supprime la couche de l'itinéraire si elle existe
        if (map.current?.getSource('route')) { map.current.removeSource('route'); } // Supprime la source de l'itinéraire si elle existe
    };

    // La fonction "Réinitialiser" nettoie TOUT
    const handleReset = () => {
        clearMapElements(); // Nettoie les éléments de la carte
        setDistance(null); // Réinitialise la distance
        setStartAddress(''); // Réinitialise l'adresse de départ
        setEndAddress(''); // Réinitialise l'adresse d'arrivée
        setStartCoords(null); // Réinitialise les coordonnées de départ
        setEndCoords(null); // Réinitialise les coordonnées d'arrivée
        setStartSuggestions([]); // Réinitialise les suggestions de départ
        setEndSuggestions([]); // Réinitialise les suggestions d'arrivée
    };

    // Calcul de l'itinéraire entre les deux points
    const handleCalculateRoute = async () => { // Fonction pour calculer l'itinéraire
        if (!startCoords || !endCoords) { // Vérifie que les deux points sont définis
            toast.warn("Veuillez sélectionner un point de départ et d'arrivée depuis les suggestions."); // Affiche une notification d'avertissement
            return;
        }
        setIsLoading(true); // Indique que le calcul est en cours
        clearMapElements(); // Nettoie les éléments précédents de la carte
        markers.current.push(new mapboxgl.Marker({ color: '#4caf50' }).setLngLat(startCoords).addTo(map.current)); // Marqueur vert pour le départ
        markers.current.push(new mapboxgl.Marker({ color: '#f44336' }).setLngLat(endCoords).addTo(map.current)); // Marqueur rouge pour l'arrivée
        try {
            const routeResponse = await axios.post(`${API_BASE_URL}/api/route`, { start: startCoords, end: endCoords }); // Appel à l'API backend pour le calcul de l'itinéraire
            const { distance: routeDistance, geometry } = routeResponse.data; // Récupération de la distance et de la géométrie
            setDistance(routeDistance); // Mise à jour de la distance dans l'état
            map.current.addLayer({ 
                id: 'route', type: 'line', source: { type: 'geojson', data: geometry }, // Ajout de la couche de l'itinéraire à la carte
                layout: { 'line-join': 'round', 'line-cap': 'round' }, // Style de la ligne
                paint: { 'line-color': '#3887be', 'line-width': 5, 'line-opacity': 0.75 }, // Style de la ligne
            });
            const bounds = new mapboxgl.LngLatBounds(startCoords, endCoords); // Ajuste les limites de la carte pour inclure les deux points
            map.current.fitBounds(bounds, { padding: { top: 50, bottom: 50, left: 370, right: 50 } }); // avec un padding pour le panneau latéral
        } catch (error) {
            toast.error("Impossible de calculer l'itinéraire."); // Affiche une notification d'erreur
        } finally {
            setIsLoading(false); // Indique que le calcul est terminé
        }
    };

    return ( 
        <Box sx={{ display: 'flex', height: '100vh', width: '100vw' }}>
            <ToastContainer position="top-right" autoClose={5000} hideProgressBar={false} />
            <Paper elevation={4} sx={{ width: 350, p: 2, zIndex: 1, display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography variant="h5" component="h1" sx={{ fontWeight: 'bold' }}>
                        <span style={{ color: '#0F5298' }}>Ite</span>
                        <span style={{ color: '#00D9A3' }}>ra</span>
                    </Typography>
                    <img src={logo} alt="Logo Itera" style={{ height: '32px', width: 'auto' }} />
                </Box>
                <Box sx={{ position: 'relative' }}>
                    <TextField
                        fullWidth
                        label="Point de départ"
                        variant="outlined"
                        value={startAddress}
                        onChange={(e) => { setStartAddress(e.target.value); setStartCoords(null); }}
                        autoComplete="off"
                        
                        onFocus={() => setIsStartFocused(true)}
                        onBlur={() => setIsStartFocused(false)}
                    />
                    
                    {startSuggestions.length > 0 && isStartFocused && (
                        <Paper sx={{ position: 'absolute', width: '100%', zIndex: 1200, mt: 1 }}>
                            <List dense>
                                {startSuggestions.map((s) => (
                                    <ListItemButton key={s.id} onMouseDown={() => handleSuggestionClick(s, 'start')}>
                                        <ListItemIcon sx={{ minWidth: 32 }}><PlaceIcon fontSize="small" color="action" /></ListItemIcon>
                                        <ListItemText primary={s.place_name} />
                                    </ListItemButton>
                                ))}
                            </List>
                        </Paper>
                    )}
                </Box>
                <Box sx={{ position: 'relative' }}>
                    <TextField
                        fullWidth
                        label="Point d'arrivée"
                        variant="outlined"
                        value={endAddress}
                        onChange={(e) => { setEndAddress(e.target.value); setEndCoords(null); }}
                        autoComplete="off"
                        
                        onFocus={() => setIsEndFocused(true)}
                        onBlur={() => setIsEndFocused(false)}
                    />
                    {endSuggestions.length > 0 && isEndFocused && (
                        <Paper sx={{ position: 'absolute', width: '100%', zIndex: 1200, mt: 1 }}>
                            <List dense>
                                {endSuggestions.map((s) => (
                                    <ListItemButton key={s.id} onMouseDown={() => handleSuggestionClick(s, 'end')}>
                                        <ListItemIcon sx={{ minWidth: 32 }}><PlaceIcon fontSize="small" color="action" /></ListItemIcon>
                                        <ListItemText primary={s.place_name} />
                                    </ListItemButton>
                                ))}
                            </List>
                        </Paper>
                    )}
                </Box>
                <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                    <Button variant="contained" onClick={handleCalculateRoute} disabled={isLoading} fullWidth sx={{ position: 'relative' }}>
                        {isLoading ? <CircularProgress size={24} sx={{ color: 'white' }} /> : "Calculer"}
                    </Button>
                    <Button variant="outlined" onClick={handleReset} fullWidth>Réinitialiser</Button>
                </Box>
                {distance && (
                    <Paper variant="outlined" sx={{ p: 2, mt: 'auto', backgroundColor: '#f5f5f5' }}>
                        <Typography variant="h6" component="h2">Résultat :</Typography>
                        <Typography variant="body1">Distance : <strong>{(distance / 1000).toFixed(2)} km</strong></Typography>
                    </Paper>
                )}
            </Paper>
            <Box ref={mapContainer} sx={{ flex: 1, height: '100%' }} />
        </Box>
    );
}

export default App; // Exportation du composant App comme composant par défaut