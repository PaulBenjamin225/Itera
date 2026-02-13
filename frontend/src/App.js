import React, { useRef, useEffect, useState, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import axios from "axios";
import {
  Box,
  TextField,
  Button,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Typography,
  CircularProgress,
  ListItemIcon,
  ToggleButtonGroup,
  ToggleButton,
  Tooltip,
} from "@mui/material";
import PlaceIcon from "@mui/icons-material/Place";
import MapIcon from "@mui/icons-material/Map";
import SatelliteIcon from "@mui/icons-material/Satellite";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import "mapbox-gl/dist/mapbox-gl.css";
import "./App.css";
import logo from "./assets/Itera_logo.png";

if (!process.env.REACT_APP_MAPBOX_TOKEN) {
  console.error(
    "ERREUR CRITIQUE: La variable d'environnement REACT_APP_MAPBOX_TOKEN est manquante."
  );
}
mapboxgl.accessToken = process.env.REACT_APP_MAPBOX_TOKEN;

const API_BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";
const DEFAULT_PROXIMITY = [-4.0083, 5.3097]; // Abidjan [lon, lat]

const mapStyles = [
  {
    id: "mapbox-streets",
    name: "Rues",
    icon: <MapIcon />,
    style: "mapbox://styles/mapbox/streets-v12",
  },
  {
    id: "mapbox-satellite",
    name: "Satellite",
    icon: <SatelliteIcon />,
    style: "mapbox://styles/mapbox/satellite-streets-v12",
  },
  {
    id: "osm-raster",
    name: "OpenStreetMap",
    icon: <MapIcon />,
    style: {
      version: 8,
      sources: {
        "osm-tiles": {
          type: "raster",
          tiles: [
            "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
            "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
            "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
          ],
          tileSize: 256,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        },
      },
      layers: [{ id: "osm-layer", type: "raster", source: "osm-tiles" }],
    },
  },
];

function useDebounce(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const markers = useRef([]);

  // Abort controllers pour annuler les requêtes suggestions
  const startReqController = useRef(null);
  const endReqController = useRef(null);

  // Pour éviter de programmer 50 redraws quand le style n’est pas prêt
  const redrawScheduled = useRef(false);

  const [isLoading, setIsLoading] = useState(false);

  const [startAddress, setStartAddress] = useState("");
  const [endAddress, setEndAddress] = useState("");
  const [startSuggestions, setStartSuggestions] = useState([]);
  const [endSuggestions, setEndSuggestions] = useState([]);
  const [startCoords, setStartCoords] = useState(null);
  const [endCoords, setEndCoords] = useState(null);

  const [distance, setDistance] = useState(null);

  const [isStartFocused, setIsStartFocused] = useState(false);
  const [isEndFocused, setIsEndFocused] = useState(false);

  const [currentStyle, setCurrentStyle] = useState(mapStyles[0].id);

  // routeFeature (Feature GeoJSON)
  const [routeFeature, setRouteFeature] = useState(null);

  const debouncedStartAddress = useDebounce(startAddress, 300);
  const debouncedEndAddress = useDebounce(endAddress, 300);

  // ==========================
  //  MAP SAFE REDRAW
  // ==========================
  const redrawMapElements = useCallback(() => {
    if (!map.current) return;

    // ✅ FIX: si le style n’est pas chargé, on attend "idle" puis on redessine
    if (!map.current.isStyleLoaded()) {
      if (redrawScheduled.current) return;
      redrawScheduled.current = true;
      map.current.once("idle", () => {
        redrawScheduled.current = false;
        redrawMapElements(); // relance quand prêt
      });
      return;
    }

    // Markers
    markers.current.forEach((m) => m.remove());
    markers.current = [];

    if (startCoords) {
      markers.current.push(
        new mapboxgl.Marker({ color: "#4caf50" })
          .setLngLat(startCoords)
          .addTo(map.current)
      );
    }
    if (endCoords) {
      markers.current.push(
        new mapboxgl.Marker({ color: "#f44336" })
          .setLngLat(endCoords)
          .addTo(map.current)
      );
    }

    // Route
    if (routeFeature) {
      if (map.current.getSource("route")) {
        map.current.getSource("route").setData(routeFeature);
      } else {
        map.current.addSource("route", { type: "geojson", data: routeFeature });
      }

      if (!map.current.getLayer("route")) {
        map.current.addLayer({
          id: "route",
          type: "line",
          source: "route",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": "#3887be",
            "line-width": 5,
            "line-opacity": 0.75,
          },
        });
      }
    }
  }, [startCoords, endCoords, routeFeature]);

  // Redessiner automatiquement après chaque update coords/route
  useEffect(() => {
    redrawMapElements();
  }, [redrawMapElements]);

  // ==========================
  //  INIT MAP ONCE
  // ==========================
  useEffect(() => {
    if (map.current) return;
    if (!mapContainer.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: mapStyles.find((s) => s.id === currentStyle).style,
      center: [-4.0083, 5.35995],
      zoom: 5,
    });

    // Quand on change de style, sources/couches sautent => redraw après style load
    map.current.on("style.load", redrawMapElements);

    const resizeObserver = new ResizeObserver(() => {
      if (map.current) map.current.resize();
    });
    resizeObserver.observe(mapContainer.current);

    return () => {
      try {
        startReqController.current?.abort();
        endReqController.current?.abort();
      } catch {}

      if (map.current) {
        map.current.remove();
        map.current = null;
      }
      resizeObserver.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStyleChange = (event, newStyleId) => {
    if (!newStyleId || newStyleId === currentStyle) return;

    setCurrentStyle(newStyleId);
    const selectedStyle = mapStyles.find((s) => s.id === newStyleId);
    if (map.current && selectedStyle) {
      map.current.setStyle(selectedStyle.style);
    }
  };

  // ==========================
  //  SUGGESTIONS - START
  // ==========================
  useEffect(() => {
    const q = (debouncedStartAddress || "").trim();

    if (startCoords) {
      setStartSuggestions([]);
      return;
    }

    if (q.length < 2 || !isStartFocused) {
      setStartSuggestions([]);
      return;
    }

    if (startReqController.current) startReqController.current.abort();
    startReqController.current = new AbortController();

    const fetchSuggestions = async () => {
      try {
        const response = await axios.post(
          `${API_BASE_URL}/api/suggestions`,
          { query: q, proximity: DEFAULT_PROXIMITY },
          { signal: startReqController.current.signal, timeout: 6000 }
        );
        setStartSuggestions(Array.isArray(response.data) ? response.data : []);
      } catch (err) {
        if (err?.name === "CanceledError" || err?.code === "ERR_CANCELED") return;
        console.error("Suggestions départ indisponibles:", err?.message || err);
        setStartSuggestions([]);
      }
    };

    fetchSuggestions();

    return () => {
      try {
        startReqController.current?.abort();
      } catch {}
    };
  }, [debouncedStartAddress, startCoords, isStartFocused]);

  // ==========================
  //  SUGGESTIONS - END
  // ==========================
  useEffect(() => {
    const q = (debouncedEndAddress || "").trim();

    if (endCoords) {
      setEndSuggestions([]);
      return;
    }

    if (q.length < 2 || !isEndFocused) {
      setEndSuggestions([]);
      return;
    }

    if (endReqController.current) endReqController.current.abort();
    endReqController.current = new AbortController();

    const fetchSuggestions = async () => {
      try {
        const response = await axios.post(
          `${API_BASE_URL}/api/suggestions`,
          { query: q, proximity: DEFAULT_PROXIMITY },
          { signal: endReqController.current.signal, timeout: 6000 }
        );
        setEndSuggestions(Array.isArray(response.data) ? response.data : []);
      } catch (err) {
        if (err?.name === "CanceledError" || err?.code === "ERR_CANCELED") return;
        console.error("Suggestions arrivée indisponibles:", err?.message || err);
        setEndSuggestions([]);
      }
    };

    fetchSuggestions();

    return () => {
      try {
        endReqController.current?.abort();
      } catch {}
    };
  }, [debouncedEndAddress, endCoords, isEndFocused]);

  // ==========================
  //  CLICK SUGGESTION
  // ==========================
  const handleSuggestionClick = (suggestion, type) => {
    if (!suggestion?.center || suggestion.center.length !== 2) return;

    if (type === "start") {
      setStartAddress(suggestion.place_name);
      setStartCoords(suggestion.center);
      setStartSuggestions([]);
    } else {
      setEndAddress(suggestion.place_name);
      setEndCoords(suggestion.center);
      setEndSuggestions([]);
    }
  };

  // ==========================
  //  CLEAR / RESET
  // ==========================
  const clearMapElements = () => {
    markers.current.forEach((m) => m.remove());
    markers.current = [];

    if (map.current?.getSource("route")) {
      if (map.current.getLayer("route")) map.current.removeLayer("route");
      map.current.removeSource("route");
    }
  };

  const handleReset = () => {
    clearMapElements();
    setDistance(null);
    setStartAddress("");
    setEndAddress("");
    setStartCoords(null);
    setEndCoords(null);
    setStartSuggestions([]);
    setEndSuggestions([]);
    setRouteFeature(null);
  };

  // ==========================
  //  CALCULATE ROUTE
  // ==========================
  const handleCalculateRoute = async () => {
    if (!startCoords || !endCoords) {
      toast.warn(
        "Veuillez sélectionner un point de départ et d'arrivée depuis les suggestions."
      );
      return;
    }

    setIsLoading(true);
    clearMapElements();
    setRouteFeature(null);

    try {
      const routeResponse = await axios.post(
        `${API_BASE_URL}/api/route`,
        { start: startCoords, end: endCoords },
        { timeout: 10000 }
      );

      const { distance: routeDistance, geometry } = routeResponse.data;

      setDistance(routeDistance);

      // ✅ Feature GeoJSON
      setRouteFeature({
        type: "Feature",
        properties: {},
        geometry,
      });

      // Fit bounds (OK même si style pas chargé)
      const bounds = new mapboxgl.LngLatBounds(startCoords, endCoords);
      map.current.fitBounds(bounds, {
        padding: { top: 50, bottom: 50, left: 370, right: 50 },
      });

      // ✅ Optionnel: force un redraw après idle (au cas où)
      if (map.current && !map.current.isStyleLoaded()) {
        map.current.once("idle", redrawMapElements);
      }
    } catch (error) {
      console.error("Erreur itinéraire:", error?.message || error);
      toast.error("Impossible de calculer l'itinéraire.");
    } finally {
      setIsLoading(false);
    }
  };

  // ==========================
  //  UI
  // ==========================
  return (
    <Box sx={{ display: "flex", height: "100vh", width: "100vw" }}>
      <ToastContainer position="top-right" autoClose={5000} hideProgressBar={false} />

      <Paper
        elevation={4}
        sx={{
          width: 350,
          p: 2,
          zIndex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 2,
          overflowY: "auto",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant="h5" component="h1" sx={{ fontWeight: "bold" }}>
            <span style={{ color: "#0F5298" }}>Ite</span>
            <span style={{ color: "#00D9A3" }}>ra</span>
          </Typography>
          <img src={logo} alt="Logo Itera" style={{ height: "32px", width: "auto" }} />
        </Box>

        {/* START INPUT */}
        <Box sx={{ position: "relative" }}>
          <TextField
            fullWidth
            label="Point de départ"
            variant="outlined"
            value={startAddress}
            onChange={(e) => {
              setStartAddress(e.target.value);
              setStartCoords(null);
            }}
            autoComplete="off"
            onFocus={() => setIsStartFocused(true)}
            onBlur={() => setIsStartFocused(false)}
          />

          {startSuggestions.length > 0 && isStartFocused && (
            <Paper sx={{ position: "absolute", width: "100%", zIndex: 1200, mt: 1 }}>
              <List dense>
                {startSuggestions.map((s) => (
                  <ListItemButton
                    key={s.id}
                    onMouseDown={() => handleSuggestionClick(s, "start")}
                  >
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      <PlaceIcon fontSize="small" color="action" />
                    </ListItemIcon>
                    <ListItemText primary={s.place_name} />
                  </ListItemButton>
                ))}
              </List>
            </Paper>
          )}
        </Box>

        {/* END INPUT */}
        <Box sx={{ position: "relative" }}>
          <TextField
            fullWidth
            label="Point d'arrivée"
            variant="outlined"
            value={endAddress}
            onChange={(e) => {
              setEndAddress(e.target.value);
              setEndCoords(null);
            }}
            autoComplete="off"
            onFocus={() => setIsEndFocused(true)}
            onBlur={() => setIsEndFocused(false)}
          />

          {endSuggestions.length > 0 && isEndFocused && (
            <Paper sx={{ position: "absolute", width: "100%", zIndex: 1200, mt: 1 }}>
              <List dense>
                {endSuggestions.map((s) => (
                  <ListItemButton key={s.id} onMouseDown={() => handleSuggestionClick(s, "end")}>
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      <PlaceIcon fontSize="small" color="action" />
                    </ListItemIcon>
                    <ListItemText primary={s.place_name} />
                  </ListItemButton>
                ))}
              </List>
            </Paper>
          )}
        </Box>

        <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
          <Button
            variant="contained"
            onClick={handleCalculateRoute}
            disabled={isLoading}
            fullWidth
            sx={{ position: "relative" }}
          >
            {isLoading ? <CircularProgress size={24} sx={{ color: "white" }} /> : "Calculer"}
          </Button>

          <Button variant="outlined" onClick={handleReset} fullWidth>
            Réinitialiser
          </Button>
        </Box>

        {distance != null && (
          <Paper variant="outlined" sx={{ p: 2, mt: "auto", backgroundColor: "#f5f5f5" }}>
            <Typography variant="h6" component="h2">
              Résultat :
            </Typography>
            <Typography variant="body1">
              Distance : <strong>{(distance / 1000).toFixed(2)} km</strong>
            </Typography>
          </Paper>
        )}
      </Paper>

      {/* MAP */}
      <Box sx={{ position: "relative", flex: 1, height: "100%" }}>
        <Box sx={{ position: "absolute", top: 10, right: 10, zIndex: 1 }}>
          <Paper elevation={4}>
            <ToggleButtonGroup
              value={currentStyle}
              exclusive
              onChange={handleStyleChange}
              aria-label="sélecteur de style de carte"
            >
              {mapStyles.map((style) => (
                <Tooltip title={style.name} key={style.id}>
                  <ToggleButton value={style.id} aria-label={style.name}>
                    {style.icon}
                  </ToggleButton>
                </Tooltip>
              ))}
            </ToggleButtonGroup>
          </Paper>
        </Box>

        <Box ref={mapContainer} sx={{ width: "100%", height: "100%" }} />
      </Box>
    </Box>
  );
}

export default App;
