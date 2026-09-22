"use client";

import React, { useState, useEffect, useRef } from "react";
import { format, differenceInMinutes, addMinutes, parse, addDays } from "date-fns";
import { it } from "date-fns/locale";
import { 
  Clock, MapPin, Plus, Navigation2, Check, Car, X, Loader2, Sun, 
  Trash2, CheckCircle2, CheckCheck, Undo2, Calendar, Home, Edit3, 
  Bell, BellOff, ExternalLink, Map, CloudRain, Pencil, Footprints, Bike, 
  Settings, Volume2, Sliders, ShieldAlert, Sparkles, RefreshCw 
} from "lucide-react";
import Image from "next/image";

// --- Types & Schema ---
type EventCategory = "Lavoro" | "Salute" | "Personale" | "Sport";
type EventStatus = "active" | "completed";
type TransportMode = "driving" | "walking" | "cycling";

type MasterEvent = {
  id: string;
  title: string;
  category: EventCategory;
  date: string; // YYYY-MM-DD
  targetTime: string; // HH:mm
  destinationName: string;
  destinationCoords: { lat: number; lon: number };
  bufferMinutes: number;
  checklist: string[];
  status: EventStatus;
  completedAt?: string; // ISO String
  travelTimeMins?: number;
  transportMode?: TransportMode;
};

type LocationSuggestion = {
  name: string;
  secondary: string;
  fullName: string;
  lat: number;
  lon: number;
};

type BaseLocation = {
  coords: { lat: number; lon: number };
  name: string;
};

type SavedPlace = {
  id: string;
  name: string;
  icon: string;
  address: string;
  coords: { lat: number; lon: number };
};

type WeatherData = {
  temp: number;
  code: number;
  label: string;
  icon: string;
  isRainy: boolean;
};

const categoryStyles: Record<EventCategory, string> = {
  Sport: "border-orange-500 text-orange-700 bg-orange-500/10",
  Lavoro: "border-emerald-500 text-emerald-700 bg-emerald-500/10",
  Salute: "border-blue-500 text-blue-700 bg-blue-500/10",
  Personale: "border-amber-500 text-amber-700 bg-amber-500/10",
};

// Default fallback starting location (Quattromiglia / Rende)
const DEFAULT_BASE_LOCATION: BaseLocation = {
  coords: { lat: 39.3621, lon: 16.2251 },
  name: "Quattromiglia, Rende",
};

const DEFAULT_SAVED_PLACES: SavedPlace[] = [
  { id: "home", name: "Casa", icon: "🏠", address: "Quattromiglia, Rende", coords: { lat: 39.3621, lon: 16.2251 } },
  { id: "unical", name: "Unical", icon: "🎓", address: "Università della Calabria, Rende", coords: { lat: 39.3621, lon: 16.2251 } },
  { id: "sport", name: "Sport", icon: "⚽", address: "Centro Sportivo, Rende", coords: { lat: 39.3550, lon: 16.2300 } },
  { id: "work", name: "Lavoro", icon: "💼", address: "Ufficio, Rende", coords: { lat: 39.3600, lon: 16.2200 } },
];

const getWeatherInfo = (code: number, temp: number): WeatherData => {
  const roundedTemp = Math.round(temp);
  let icon = "☀️";
  let label = "Soleggiato";
  let isRainy = false;

  if (code === 0) {
    icon = "☀️";
    label = "Soleggiato";
  } else if ([1, 2, 3].includes(code)) {
    icon = "⛅";
    label = "Nuvoloso";
  } else if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
    icon = "🌧️";
    label = "Pioggia";
    isRainy = true;
  } else if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) {
    icon = "❄️";
    label = "Neve";
  } else if (code >= 95 && code <= 99) {
    icon = "⛈️";
    label = "Temporale";
    isRainy = true;
  }

  return { temp: roundedTemp, code, label, icon, isRainy };
};

// Robust OSRM Profile Route Duration Calculation
const fetchOsrmRouteMins = async (
  startCoords: { lat: number; lon: number },
  destCoords: { lat: number; lon: number },
  mode: TransportMode = "driving"
): Promise<number> => {
  const profile = mode === "walking" ? "foot" : mode === "cycling" ? "bike" : "driving";
  try {
    const url = `https://router.project-osrm.org/route/v1/${profile}/${startCoords.lon},${startCoords.lat};${destCoords.lon},${destCoords.lat}?overview=false`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.code === "Ok" && data.routes && data.routes.length > 0) {
      return Math.max(1, Math.round(data.routes[0].duration / 60));
    }
  } catch (e) {
    console.warn(`OSRM ${profile} route fetch error:`, e);
  }

  // Haversine fallback estimate if OSRM is offline
  const R = 6371;
  const dLat = (destCoords.lat - startCoords.lat) * (Math.PI / 180);
  const dLon = (destCoords.lon - startCoords.lon) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(startCoords.lat * (Math.PI / 180)) *
      Math.cos(destCoords.lat * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distKm = R * c;

  const speedKmh = mode === "walking" ? 4.5 : mode === "cycling" ? 15 : 35;
  return Math.max(2, Math.round((distKm / speedKmh) * 60));
};

export default function Dashboard() {
  const [isMounted, setIsMounted] = useState(false);
  const [now, setNow] = useState(new Date());

  // Master State
  const [masterEvents, setMasterEvents] = useState<MasterEvent[]>([]);
  const [dateTab, setDateTab] = useState<"oggi" | "domani" | "tutti">("oggi");

  // Geolocation & Base Memory State
  const [locationMode, setLocationMode] = useState<"home" | "gps">("home");
  const [homeLocation, setHomeLocation] = useState<BaseLocation>(DEFAULT_BASE_LOCATION);
  const [currentLoc, setCurrentLoc] = useState<{ lat: number; lon: number } | null>(DEFAULT_BASE_LOCATION.coords);
  const [currentCity, setCurrentCity] = useState<string>(DEFAULT_BASE_LOCATION.name);
  const [isLocating, setIsLocating] = useState(false);

  // Settings & Travel Preferences State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [defaultSafetyBuffer, setDefaultSafetyBuffer] = useState<number>(10);
  const [defaultTransportMode, setDefaultTransportMode] = useState<TransportMode>("driving");
  const [vibrationEnabled, setVibrationEnabled] = useState(true);

  // Bookmarks / Saved Places State
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>(DEFAULT_SAVED_PLACES);
  const [selectedBookmarkId, setSelectedBookmarkId] = useState<string | null>(null);

  // New Bookmark Modal State
  const [isBookmarkModalOpen, setIsBookmarkModalOpen] = useState(false);
  const [newBookmarkName, setNewBookmarkName] = useState("");
  const [newBookmarkIcon, setNewBookmarkIcon] = useState("📍");
  const [newBookmarkAddressQuery, setNewBookmarkAddressQuery] = useState("");
  const [newBookmarkSuggestions, setNewBookmarkSuggestions] = useState<LocationSuggestion[]>([]);
  const [selectedBookmarkCoords, setSelectedBookmarkCoords] = useState<{ lat: number; lon: number; name: string } | null>(null);
  const [isSearchingBookmarkAddress, setIsSearchingBookmarkAddress] = useState(false);

  // Weather State
  const [nextEventWeather, setNextEventWeather] = useState<WeatherData | null>(null);

  // Notification State & Trigger Keys
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [notifiedKeys, setNotifiedKeys] = useState<Set<string>>(new Set());
  const [swRegistration, setSwRegistration] = useState<ServiceWorkerRegistration | null>(null);

  // Location Quick Switcher Modal State
  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false);
  const [isEditingBase, setIsEditingBase] = useState(false);
  const [baseSearchQuery, setBaseSearchQuery] = useState("");
  const [baseSuggestions, setBaseSuggestions] = useState<LocationSuggestion[]>([]);
  const [isSearchingBase, setIsSearchingBase] = useState(false);

  // Maps Chooser Modal State
  const [mapsTargetEvent, setMapsTargetEvent] = useState<MasterEvent | null>(null);

  // History Modal State
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  // Modal Form & Edit State
  const [isFabOpen, setIsFabOpen] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [newEventTitle, setNewEventTitle] = useState("");
  const [newEventDate, setNewEventDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [newEventTime, setNewEventTime] = useState("");
  const [newEventCategory, setNewEventCategory] = useState<EventCategory>("Personale");
  const [newEventBuffer, setNewEventBuffer] = useState(10);
  const [newEventTransportMode, setNewEventTransportMode] = useState<TransportMode>("driving");
  const [newEventChecklist, setNewEventChecklist] = useState<string[]>([]);
  
  // Custom checklist tag input
  const [customItemInput, setCustomItemInput] = useState("");
  const [isAddingCustomItem, setIsAddingCustomItem] = useState(false);

  // Autocomplete State
  const [addressQuery, setAddressQuery] = useState("");
  const [addressSuggestions, setAddressSuggestions] = useState<LocationSuggestion[]>([]);
  const [selectedDest, setSelectedDest] = useState<{ lat: number; lon: number; name: string } | null>(null);
  const [isSearchingAddress, setIsSearchingAddress] = useState(false);

  // Ref for GPS Watch ID
  const watchIdRef = useRef<number | null>(null);

  // Web Audio Synthesizer Chime
  const playDepartureChime = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();

      const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6 chime
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.12);

        gain.gain.setValueAtTime(0.3, ctx.currentTime + idx * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.12 + 0.6);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(ctx.currentTime + idx * 0.12);
        osc.stop(ctx.currentTime + idx * 0.12 + 0.6);
      });
    } catch (e) {
      console.error("Audio chime error:", e);
    }
  };

  // Register Service Worker on mount
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          setSwRegistration(reg);
        })
        .catch((err) => console.warn("SW registration error:", err));
    }
  }, []);

  // Dual Geocode Search (Photon + Nominatim with countrycodes=it)
  const fetchSuggestions = async (query: string): Promise<LocationSuggestion[]> => {
    if (!query || query.trim().length < 2) return [];

    const lat = currentLoc?.lat || 39.3621;
    const lon = currentLoc?.lon || 16.2251;

    // 1. Try Photon API with Proximity Biasing
    try {
      const res = await fetch(
        `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lat=${lat}&lon=${lon}&limit=8&lang=it`
      );
      const data = await res.json();
      if (data.features && data.features.length > 0) {
        return data.features.map((f: any) => {
          const props = f.properties;
          const mainName = props.name || props.street || query;
          const secondary = [
            props.street && props.name !== props.street ? `${props.street} ${props.housenumber || ""}`.trim() : null,
            props.district || props.suburb,
            props.city || props.town || props.village,
            props.state
          ].filter(Boolean).join(", ");

          return {
            name: mainName,
            secondary,
            fullName: secondary ? `${mainName}, ${secondary}` : mainName,
            lat: f.geometry.coordinates[1],
            lon: f.geometry.coordinates[0],
          };
        });
      }
    } catch (e) {
      console.warn("Photon autocomplete failed, trying local fallback", e);
    }

    // 2. Nominatim API with countrycodes=it
    try {
      const viewbox = `${lon - 0.25},${lat - 0.25},${lon + 0.25},${lat + 0.25}`;
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=it&viewbox=${viewbox}&bounded=0&addressdetails=1&limit=8`
      );
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data.map((item: any) => {
          const addr = item.address || {};
          const mainName = addr.amenity || addr.building || addr.road || item.display_name.split(",")[0];
          const secondary = [addr.road, addr.suburb, addr.city || addr.town || addr.village, addr.state].filter(Boolean).join(", ");
          return {
            name: mainName,
            secondary,
            fullName: item.display_name,
            lat: parseFloat(item.lat),
            lon: parseFloat(item.lon),
          };
        });
      }
    } catch (e) {
      console.error("Nominatim search failed", e);
    }

    return [];
  };

  // Reverse Geocode Locality (Photon)
  const reverseGeocodeLocality = async (lat: number, lon: number): Promise<string> => {
    try {
      const res = await fetch(`https://photon.komoot.io/reverse?lon=${lon}&lat=${lat}`);
      const data = await res.json();
      if (data.features && data.features.length > 0) {
        const props = data.features[0].properties;
        const locality = props.district || props.suburb || props.street || props.name || "";
        const city = props.city || props.town || props.village || props.state || "";
        
        if (locality && city && locality.toLowerCase() !== city.toLowerCase()) {
          return `${locality}, ${city}`;
        }
        return locality || city || "Posizione Rilevata";
      }
    } catch (e) {
      console.error("Reverse geocoding failed", e);
    }
    return "Posizione Rilevata";
  };

  // Load state from LocalStorage on mount
  useEffect(() => {
    setIsMounted(true);

    try {
      // Load Master Events
      const storedMaster = localStorage.getItem("ontime_master_events");
      if (storedMaster) {
        setMasterEvents(JSON.parse(storedMaster));
      }

      // Load Home Base Location
      const storedHome = localStorage.getItem("ontime_home_location");
      let activeHome = DEFAULT_BASE_LOCATION;
      if (storedHome) {
        activeHome = JSON.parse(storedHome);
      } else {
        localStorage.setItem("ontime_home_location", JSON.stringify(DEFAULT_BASE_LOCATION));
      }
      setHomeLocation(activeHome);

      // Load Saved Places / Bookmarks
      const storedPlaces = localStorage.getItem("ontime_saved_places") || localStorage.getItem("ontime_bookmarks");
      if (storedPlaces) {
        setSavedPlaces(JSON.parse(storedPlaces));
      } else {
        localStorage.setItem("ontime_saved_places", JSON.stringify(DEFAULT_SAVED_PLACES));
      }

      // Load Travel Preferences
      const storedBuf = localStorage.getItem("ontime_default_buffer");
      if (storedBuf) setDefaultSafetyBuffer(parseInt(storedBuf));

      const storedMode = localStorage.getItem("ontime_default_transport") as TransportMode | null;
      if (storedMode) setDefaultTransportMode(storedMode);

      // Load Location Mode
      const storedLocMode = localStorage.getItem("ontime_location_mode") as "home" | "gps" | null;
      const initialMode = storedLocMode || "home";
      setLocationMode(initialMode);

      if (initialMode === "home") {
        setCurrentLoc(activeHome.coords);
        setCurrentCity(activeHome.name);
      }

      // Check Notifications
      if ("Notification" in window && Notification.permission === "granted") {
        setNotificationsEnabled(true);
      }
    } catch (e) {
      console.error("Failed to read local storage", e);
    }

    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Manage Departure Notification & Chime in Ticker
  useEffect(() => {
    if (!isMounted || masterEvents.length === 0) return;

    masterEvents.forEach((ev) => {
      if (ev.status !== "active") return;
      const startDateTime = new Date(`${ev.date}T${ev.targetTime}:00`);
      const travelMins = ev.travelTimeMins || 10;
      const departureTime = addMinutes(startDateTime, -(travelMins + ev.bufferMinutes));

      const diffMins = differenceInMinutes(departureTime, now);
      const depKey = `${ev.id}_${format(departureTime, "yyyyMMddHHmm")}`;

      if (diffMins === 0 && !notifiedKeys.has(depKey)) {
        setNotifiedKeys((prev) => new Set(prev).add(depKey));
        playDepartureChime();

        const title = "🚗 È ora di uscire!";
        const options = {
          body: `${ev.title} ti aspetta. Tragitto stimato: ${travelMins} min.`,
          icon: "/logo.png",
          badge: "/logo.png",
          vibrate: vibrationEnabled ? [200, 100, 200] : undefined,
          tag: `departure_${ev.id}`,
        };

        if (swRegistration && "showNotification" in swRegistration) {
          swRegistration.showNotification(title, options);
        } else if ("Notification" in window && Notification.permission === "granted") {
          new Notification(title, options);
        }
      }
    });
  }, [now, masterEvents, isMounted, notifiedKeys, swRegistration, vibrationEnabled]);

  // Manage Live GPS Watch & Mode Switch
  useEffect(() => {
    if (!isMounted) return;

    if (locationMode === "home") {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      setCurrentLoc(homeLocation.coords);
      setCurrentCity(homeLocation.name);
      setIsLocating(false);
      return;
    }

    if (locationMode === "gps") {
      setIsLocating(true);

      if (!("geolocation" in navigator)) {
        alert("La geolocalizzazione GPS non è supportata da questo browser.");
        switchToHomeMode(homeLocation);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const acc = pos.coords.accuracy;
          if (acc > 2000) {
            console.warn(`GPS accuracy radius high (${acc}m). Falling back to home base.`);
            switchToHomeMode(homeLocation);
            return;
          }

          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;
          setCurrentLoc({ lat, lon });
          const locality = await reverseGeocodeLocality(lat, lon);
          setCurrentCity(locality);
          setIsLocating(false);
        },
        (err) => {
          console.warn("GPS request failed. Falling back to saved base:", err);
          switchToHomeMode(homeLocation);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );

      watchIdRef.current = navigator.geolocation.watchPosition(
        async (pos) => {
          const acc = pos.coords.accuracy;
          if (acc <= 2000) {
            const lat = pos.coords.latitude;
            const lon = pos.coords.longitude;
            setCurrentLoc({ lat, lon });
            const locality = await reverseGeocodeLocality(lat, lon);
            setCurrentCity(locality);
          }
        },
        (err) => console.warn("Watch position error:", err),
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
      );

      return () => {
        if (watchIdRef.current !== null) {
          navigator.geolocation.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
        }
      };
    }
  }, [locationMode, homeLocation, isMounted]);

  // Save Master Events to localStorage on change
  useEffect(() => {
    if (isMounted) {
      localStorage.setItem("ontime_master_events", JSON.stringify(masterEvents));
    }
  }, [masterEvents, isMounted]);

  // REACTIVE ROUTE RECALCULATION when currentLoc or masterEvents change
  useEffect(() => {
    if (!currentLoc || masterEvents.length === 0 || !isMounted) return;

    const recalculateRoutes = async () => {
      let updated = false;
      const newEvents = await Promise.all(
        masterEvents.map(async (ev) => {
          if (ev.status !== "active" || !ev.destinationCoords?.lat || !ev.destinationCoords?.lon) return ev;
          try {
            const newMins = await fetchOsrmRouteMins(currentLoc, ev.destinationCoords, ev.transportMode || "driving");
            if (newMins !== ev.travelTimeMins) {
              updated = true;
              return { ...ev, travelTimeMins: newMins };
            }
          } catch (e) {
            console.error("Recalculation error", e);
          }
          return ev;
        })
      );

      if (updated) {
        setMasterEvents(newEvents);
      }
    };

    recalculateRoutes();
  }, [currentLoc]);

  // Filter Active vs Completed
  const activeEvents = masterEvents.filter((e) => e.status === "active");
  const completedEvents = masterEvents.filter((e) => e.status === "completed");

  // Date Filtering
  const todayStr = format(now, "yyyy-MM-dd");
  const tomorrowStr = format(addDays(now, 1), "yyyy-MM-dd");

  const filteredActiveEvents = activeEvents.filter((e) => {
    if (dateTab === "oggi") return e.date === todayStr;
    if (dateTab === "domani") return e.date === tomorrowStr;
    return true; // tutti
  });

  // Sort by target datetime
  const getEventDateTime = (ev: MasterEvent) => new Date(`${ev.date}T${ev.targetTime}:00`);

  const sortedEvents = [...filteredActiveEvents].sort(
    (a, b) => getEventDateTime(a).getTime() - getEventDateTime(b).getTime()
  );

  const pastEvents = sortedEvents.filter((e) => getEventDateTime(e) <= now);
  const futureEvents = sortedEvents.filter((e) => getEventDateTime(e) > now);

  const activeEvent = pastEvents.length > 0 ? pastEvents[pastEvents.length - 1] : null;
  const nextEvent = futureEvents.length > 0 ? futureEvents[0] : null;
  const upcomingEvents = futureEvents.slice(1);

  // Fetch Open-Meteo Destination Weather when nextEvent changes
  useEffect(() => {
    if (!nextEvent?.destinationCoords?.lat || !nextEvent?.destinationCoords?.lon) {
      setNextEventWeather(null);
      return;
    }

    const fetchWeather = async () => {
      try {
        const lat = nextEvent.destinationCoords.lat;
        const lon = nextEvent.destinationCoords.lon;
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
        const data = await res.json();
        if (data.current_weather) {
          const info = getWeatherInfo(data.current_weather.weathercode, data.current_weather.temperature);
          setNextEventWeather(info);
        }
      } catch (e) {
        console.error("Open-Meteo weather fetch error:", e);
      }
    };

    fetchWeather();
  }, [nextEvent?.id, nextEvent?.destinationCoords?.lat, nextEvent?.destinationCoords?.lon]);

  // Autocomplete effect for Address (New/Edit Event Modal)
  useEffect(() => {
    if (addressQuery.trim().length < 2 || selectedDest?.name === addressQuery) {
      setAddressSuggestions([]);
      return;
    }

    setIsSearchingAddress(true);
    const timeoutId = setTimeout(async () => {
      const results = await fetchSuggestions(addressQuery);
      setAddressSuggestions(results);
      setIsSearchingAddress(false);
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [addressQuery, selectedDest]);

  // Autocomplete effect for Setting Home Base Location
  useEffect(() => {
    if (baseSearchQuery.trim().length < 2) {
      setBaseSuggestions([]);
      return;
    }

    setIsSearchingBase(true);
    const timeoutId = setTimeout(async () => {
      const results = await fetchSuggestions(baseSearchQuery);
      setBaseSuggestions(results);
      setIsSearchingBase(false);
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [baseSearchQuery]);

  // Autocomplete effect for Creating New Bookmark
  useEffect(() => {
    if (newBookmarkAddressQuery.trim().length < 2 || selectedBookmarkCoords?.name === newBookmarkAddressQuery) {
      setNewBookmarkSuggestions([]);
      return;
    }

    setIsSearchingBookmarkAddress(true);
    const timeoutId = setTimeout(async () => {
      const results = await fetchSuggestions(newBookmarkAddressQuery);
      setNewBookmarkSuggestions(results);
      setIsSearchingBookmarkAddress(false);
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [newBookmarkAddressQuery, selectedBookmarkCoords]);

  if (!isMounted) return null;

  // Helper Mode Switches
  const switchToHomeMode = (base: BaseLocation) => {
    setLocationMode("home");
    localStorage.setItem("ontime_location_mode", "home");
    setCurrentLoc(base.coords);
    setCurrentCity(base.name);
    setIsLocating(false);
  };

  const switchToGpsMode = () => {
    setLocationMode("gps");
    localStorage.setItem("ontime_location_mode", "gps");
  };

  const saveNewHomeBase = (newBase: BaseLocation) => {
    setHomeLocation(newBase);
    localStorage.setItem("ontime_home_location", JSON.stringify(newBase));
    switchToHomeMode(newBase);
    setIsEditingBase(false);
    setBaseSearchQuery("");
    setBaseSuggestions([]);
    setIsLocationModalOpen(false);
  };

  const toggleNotifications = async () => {
    if (!("Notification" in window)) {
      return alert("Le notifiche non sono supportate da questo browser.");
    }

    const perm = await Notification.requestPermission();
    if (perm === "granted") {
      setNotificationsEnabled(true);
      playDepartureChime();

      let reg = swRegistration;
      if (!reg && "serviceWorker" in navigator) {
        try {
          reg = await navigator.serviceWorker.register("/sw.js");
          setSwRegistration(reg);
        } catch (e) {
          console.warn("SW registration error:", e);
        }
      }

      const title = "🔔 Notifiche OnTime attive";
      const options = {
        body: "Ti avviseremo sul blocco schermo quando è ora di uscire!",
        icon: "/logo.png",
        badge: "/logo.png",
        vibrate: vibrationEnabled ? [200, 100, 200] : undefined,
      };

      if (reg && "showNotification" in reg) {
        reg.showNotification(title, options);
      } else {
        new Notification(title, options);
      }
    } else {
      setNotificationsEnabled(false);
      alert("Permesso notifiche negato.");
    }
  };

  // Toggle checklist item status on active events
  const toggleEventChecklistItem = (eventId: string, itemText: string) => {
    setMasterEvents((prev) =>
      prev.map((e) => {
        if (e.id !== eventId) return e;
        const list = e.checklist || [];
        const isChecked = list.some((i) => i === `✓ ${itemText}` || i === itemText);
        
        let newList: string[];
        if (isChecked) {
          newList = list.map((i) => (i.replace(/^✓\s*/, "") === itemText ? itemText : i));
          if (!list.some((i) => i.startsWith("✓ ") && i.endsWith(itemText))) {
            newList = list.map((i) => (i === itemText ? `✓ ${itemText}` : i));
          } else {
            newList = list.map((i) => (i === `✓ ${itemText}` ? itemText.replace(/^✓\s*/, "") : i));
          }
        } else {
          newList = list.map((i) => (i === itemText ? `✓ ${itemText}` : i));
        }

        return { ...e, checklist: newList };
      })
    );
  };

  // Add custom checklist item tag in form
  const handleAddCustomChecklistItem = () => {
    const val = customItemInput.trim();
    if (!val) return;
    if (!newEventChecklist.includes(val)) {
      setNewEventChecklist((prev) => [...prev, val]);
    }
    setCustomItemInput("");
    setIsAddingCustomItem(false);
  };

  // Bookmark Quick Chip Selection
  const handleSelectBookmark = (place: SavedPlace) => {
    if (selectedBookmarkId === place.id) {
      setSelectedBookmarkId(null);
      setAddressQuery("");
      setSelectedDest(null);
    } else {
      setSelectedBookmarkId(place.id);
      setAddressQuery(place.address || place.name);
      setSelectedDest({ lat: place.coords.lat, lon: place.coords.lon, name: place.address || place.name });
      setAddressSuggestions([]);
    }
  };

  // Save new custom Bookmark
  const handleSaveBookmark = async () => {
    if (!newBookmarkName.trim()) return alert("Inserisci un nome per il segnaposto!");
    let coords = selectedBookmarkCoords ? { lat: selectedBookmarkCoords.lat, lon: selectedBookmarkCoords.lon } : null;
    let addr = selectedBookmarkCoords ? selectedBookmarkCoords.name : newBookmarkAddressQuery.trim();

    if (!coords && addr.length > 0) {
      const geo = await fetchSuggestions(addr);
      if (geo.length > 0) {
        coords = { lat: geo[0].lat, lon: geo[0].lon };
        addr = geo[0].fullName;
      }
    }

    if (!coords) return alert("Indirizzo non valido o non trovato.");

    const newPlace: SavedPlace = {
      id: Math.random().toString(),
      name: newBookmarkName.trim(),
      icon: newBookmarkIcon || "📍",
      address: addr,
      coords,
    };

    const updated = [...savedPlaces, newPlace];
    setSavedPlaces(updated);
    localStorage.setItem("ontime_saved_places", JSON.stringify(updated));
    localStorage.setItem("ontime_bookmarks", JSON.stringify(updated));

    setNewBookmarkName("");
    setNewBookmarkIcon("📍");
    setNewBookmarkAddressQuery("");
    setSelectedBookmarkCoords(null);
    setIsBookmarkModalOpen(false);
  };

  // Delete Bookmark
  const deleteBookmark = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (window.confirm("Eliminare questo segnaposto dai preferiti?")) {
      const updated = savedPlaces.filter((p) => p.id !== id);
      setSavedPlaces(updated);
      localStorage.setItem("ontime_saved_places", JSON.stringify(updated));
      localStorage.setItem("ontime_bookmarks", JSON.stringify(updated));
      if (selectedBookmarkId === id) setSelectedBookmarkId(null);
    }
  };

  // Start Editing Event
  const startEditingEvent = (ev: MasterEvent) => {
    setEditingEventId(ev.id);
    setNewEventTitle(ev.title);
    setNewEventCategory(ev.category);
    setNewEventDate(ev.date);
    setNewEventTime(ev.targetTime);
    setAddressQuery(ev.destinationName);
    setSelectedDest({ lat: ev.destinationCoords.lat, lon: ev.destinationCoords.lon, name: ev.destinationName });
    setNewEventBuffer(ev.bufferMinutes);
    setNewEventChecklist(ev.checklist || []);
    setNewEventTransportMode(ev.transportMode || "driving");
    setIsFabOpen(true);
  };

  // Actions
  const deleteEvent = (id: string) => {
    if (window.confirm("Sei sicuro di voler eliminare definitivamente questo evento?")) {
      setMasterEvents((prev) => prev.filter((e) => e.id !== id));
    }
  };

  const completeEvent = (id: string) => {
    setMasterEvents((prev) =>
      prev.map((e) =>
        e.id === id ? { ...e, status: "completed", completedAt: new Date().toISOString() } : e
      )
    );
  };

  const restoreEvent = (id: string) => {
    setMasterEvents((prev) =>
      prev.map((e) => (e.id === id ? { ...e, status: "active", completedAt: undefined } : e))
    );
  };

  const handleSaveEvent = async () => {
    if (!newEventTitle.trim() || !newEventTime || !newEventDate) {
      return alert("Compila titolo, data e orario!");
    }

    setIsSaving(true);

    let destCoords = selectedDest ? { lat: selectedDest.lat, lon: selectedDest.lon } : null;
    let destName = selectedDest ? selectedDest.name : addressQuery.trim();

    // Auto-Geocode typed address if no dropdown item was selected
    if (!destCoords && destName.length > 0) {
      const geoResults = await fetchSuggestions(destName);
      if (geoResults.length > 0) {
        destCoords = { lat: geoResults[0].lat, lon: geoResults[0].lon };
        destName = geoResults[0].fullName;
      } else if (currentLoc) {
        destCoords = { lat: currentLoc.lat, lon: currentLoc.lon };
      }
    }

    if (!destCoords) {
      alert("Seleziona una destinazione valida dalla lista o inserisci un indirizzo riconoscibile.");
      setIsSaving(false);
      return;
    }

    let finalTravelTime = 10;
    if (currentLoc && destCoords) {
      finalTravelTime = await fetchOsrmRouteMins(currentLoc, destCoords, newEventTransportMode);
    }

    if (editingEventId) {
      setMasterEvents((prev) =>
        prev.map((e) =>
          e.id === editingEventId
            ? {
                ...e,
                title: newEventTitle.trim(),
                category: newEventCategory,
                date: newEventDate,
                targetTime: newEventTime,
                destinationName: destName,
                destinationCoords: destCoords,
                bufferMinutes: newEventBuffer,
                checklist: newEventChecklist,
                transportMode: newEventTransportMode,
                travelTimeMins: finalTravelTime,
              }
            : e
        )
      );
    } else {
      const newEv: MasterEvent = {
        id: Math.random().toString(),
        title: newEventTitle.trim(),
        category: newEventCategory,
        date: newEventDate,
        targetTime: newEventTime,
        destinationName: destName,
        destinationCoords: destCoords,
        bufferMinutes: newEventBuffer,
        checklist: newEventChecklist,
        status: "active",
        travelTimeMins: finalTravelTime,
        transportMode: newEventTransportMode,
      };

      setMasterEvents((prev) => [...prev, newEv]);
    }

    setEditingEventId(null);
    setNewEventTitle("");
    setAddressQuery("");
    setSelectedDest(null);
    setSelectedBookmarkId(null);
    setNewEventTime("");
    setNewEventDate(format(new Date(), "yyyy-MM-dd"));
    setNewEventCategory("Personale");
    setNewEventBuffer(defaultSafetyBuffer);
    setNewEventTransportMode(defaultTransportMode);
    setNewEventChecklist([]);
    setCustomItemInput("");
    setIsSaving(false);
    setIsFabOpen(false);
  };

  const toggleFormChecklistItem = (item: string) => {
    if (newEventChecklist.includes(item)) {
      setNewEventChecklist((prev) => prev.filter((i) => i !== item));
    } else {
      setNewEventChecklist((prev) => [...prev, item]);
    }
  };

  const resetAllData = () => {
    if (window.confirm("⚠️ Vuoi davvero cancellare TUTTI i dati dell'app (eventi, segnaposti e impostazioni)? L'azione è irreversibile.")) {
      localStorage.clear();
      setMasterEvents([]);
      setSavedPlaces(DEFAULT_SAVED_PLACES);
      setHomeLocation(DEFAULT_BASE_LOCATION);
      setLocationMode("home");
      setCurrentLoc(DEFAULT_BASE_LOCATION.coords);
      setCurrentCity(DEFAULT_BASE_LOCATION.name);
      setIsSettingsOpen(false);
      alert("Tutti i dati dell'applicazione sono stati cancellati.");
    }
  };

  const renderBadgeInfo = (ev: MasterEvent) => {
    const startDateTime = getEventDateTime(ev);
    const travelMins = ev.travelTimeMins || 10;
    const departureTime = addMinutes(startDateTime, -(travelMins + ev.bufferMinutes));
    const minsToDeparture = differenceInMinutes(departureTime, now);

    let style = "bg-slate-500/10 text-slate-600 border border-slate-500/20";
    let text = `Esci tra ${minsToDeparture} min`;
    let barColor = "bg-slate-300";

    const isLate = now > departureTime;

    if (isLate) {
      const lateMins = differenceInMinutes(now, departureTime);
      style = "bg-red-500/10 text-red-600 border border-red-500/20";
      text = `SEI IN RITARDO DI ${lateMins} MIN`;
      barColor = "bg-red-500 animate-pulse";
    } else if (minsToDeparture < 10) {
      style = "bg-red-500/10 text-red-600 border border-red-500/20";
      barColor = "bg-red-500";
    } else if (minsToDeparture <= 20) {
      style = "bg-amber-500/10 text-amber-600 border border-amber-500/20";
      barColor = "bg-amber-400";
    }

    const windowMins = 60;
    let progress = 0;
    if (isLate) {
      progress = 100;
    } else if (minsToDeparture < windowMins) {
      progress = ((windowMins - minsToDeparture) / windowMins) * 100;
    }

    return { style, text, departureTime, barColor, progress, isLate };
  };

  const CardActionButtons = ({ event }: { event: MasterEvent }) => (
    <div className="flex items-center gap-1.5 shrink-0 ml-2">
      <button
        onClick={() => startEditingEvent(event)}
        className="w-8 h-8 rounded-full flex items-center justify-center bg-gray-100 hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition-colors"
        title="Modifica"
      >
        <Pencil className="w-4 h-4" />
      </button>
      <button
        onClick={() => deleteEvent(event.id)}
        className="w-8 h-8 rounded-full flex items-center justify-center bg-gray-100 hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
        title="Elimina"
      >
        <Trash2 className="w-4 h-4" />
      </button>
      <button
        onClick={() => completeEvent(event.id)}
        className="w-8 h-8 rounded-full flex items-center justify-center bg-gray-100 hover:bg-emerald-50 text-gray-400 hover:text-emerald-600 transition-colors"
        title="Completa"
      >
        <CheckCircle2 className="w-4 h-4" />
      </button>
    </div>
  );

  // Group completed events by date
  const groupedCompleted = completedEvents.reduce((acc, ev) => {
    const key = ev.date;
    if (!acc[key]) acc[key] = [];
    acc[key].push(ev);
    return acc;
  }, {} as Record<string, MasterEvent[]>);

  const defaultQuickTags = ["🔑 Chiavi", "💳 Portafoglio", "🎒 Borsa", "💧 Borraccia"];

  const formatPillCity = (city: string) => {
    if (!city) return "Posizione";
    return city.split(",")[0].trim();
  };

  return (
    <main className="flex flex-col min-h-screen bg-[#F5F5F7] pb-24 relative overflow-x-hidden font-sans">
      <div className="max-w-md mx-auto w-full flex flex-col flex-1">
        {/* HEADER */}
        <header className="flex justify-between items-center px-6 py-5 pb-2">
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="relative w-7 h-7 rounded-[8px] overflow-hidden shadow-sm">
              <Image src="/logo.png" alt="OnTime Logo" fill className="object-cover" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">OnTime</h1>
          </div>

          <div className="flex items-center gap-2">
            {/* SETTINGS GEAR BUTTON */}
            <button
              onClick={() => setIsSettingsOpen(true)}
              title="Impostazioni App"
              className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors flex items-center justify-center shadow-sm"
            >
              <Settings className="w-4 h-4" />
            </button>

            {/* NOTIFICATIONS TOGGLE BELL WITH GREEN DOT INDICATOR */}
            <button
              onClick={toggleNotifications}
              title={notificationsEnabled ? "Notifiche attive" : "Attiva notifiche di partenza"}
              className={`w-8 h-8 rounded-full transition-colors flex items-center justify-center shadow-sm relative ${
                notificationsEnabled
                  ? "bg-slate-900 text-white shadow-md"
                  : "bg-gray-100 hover:bg-gray-200 text-gray-400 hover:text-gray-600"
              }`}
            >
              {notificationsEnabled ? <Bell className="w-4 h-4 fill-white text-white" /> : <BellOff className="w-4 h-4" />}
              {notificationsEnabled && (
                <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 rounded-full ring-2 ring-white" />
              )}
            </button>

            {/* COMPLETED ARCHIVE TRIGGER */}
            <button
              onClick={() => setIsHistoryOpen(true)}
              title="Archivio Impegni Conclusi"
              className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 transition-colors flex items-center justify-center shadow-sm relative"
            >
              <CheckCheck className="w-4 h-4" />
              {completedEvents.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-blue-500 rounded-full ring-2 ring-white" />
              )}
            </button>

            {/* TOP-RIGHT SMART LOCATION PILL (CLEAN TYPOGRAPHY) */}
            <button
              onClick={() => {
                setIsEditingBase(false);
                setIsLocationModalOpen(true);
              }}
              className={`px-3 py-1.5 rounded-full flex items-center gap-1.5 transition-all border shadow-sm ${
                locationMode === "gps"
                  ? "bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
                  : "bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200/80"
              }`}
            >
              {isLocating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600 shrink-0" />
              ) : locationMode === "gps" ? (
                <Navigation2 className="w-3.5 h-3.5 text-blue-600 fill-blue-600 shrink-0" />
              ) : (
                <Home className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              )}
              <span className="text-xs font-semibold uppercase tracking-wider truncate max-w-[120px] sm:max-w-none text-right">
                {formatPillCity(currentCity)}
              </span>
            </button>
          </div>
        </header>

        {/* DATE & TABS BAR */}
        <div className="px-6 mb-4 mt-1 flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <h2 className="text-[11px] font-bold text-slate-400 tracking-widest uppercase">
              {format(now, "EEEE d MMMM", { locale: it })}
            </h2>
          </div>

          {/* DATE SWITCHER TABS */}
          <div className="flex bg-slate-200/60 p-1 rounded-[14px]">
            <button
              onClick={() => setDateTab("oggi")}
              className={`flex-1 py-1.5 text-xs font-bold rounded-[10px] transition-all ${
                dateTab === "oggi" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Oggi
            </button>
            <button
              onClick={() => setDateTab("domani")}
              className={`flex-1 py-1.5 text-xs font-bold rounded-[10px] transition-all ${
                dateTab === "domani" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Domani
            </button>
            <button
              onClick={() => setDateTab("tutti")}
              className={`flex-1 py-1.5 text-xs font-bold rounded-[10px] transition-all ${
                dateTab === "tutti" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Tutti
            </button>
          </div>
        </div>

        <div className="px-5 flex flex-col gap-5 flex-1">
          {/* EMPTY STATE */}
          {sortedEvents.length === 0 && (
            <div className="bg-white rounded-[24px] p-8 shadow-sm border border-slate-100/60 flex flex-col items-center justify-center text-center mt-4">
              <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mb-5">
                <Sun className="w-8 h-8 text-amber-500" strokeWidth={1.5} />
              </div>
              <h2 className="text-[22px] font-semibold text-slate-800 mb-2">Tutto tranquillo</h2>
              <p className="text-[14px] text-slate-500 font-medium max-w-[250px] mx-auto leading-relaxed mb-8">
                {dateTab === "oggi"
                  ? "Nessun impegno in programma per oggi. Goditi il tuo tempo libero o aggiungi un evento."
                  : dateTab === "domani"
                  ? "Nessun impegno in programma per domani."
                  : "Nessun impegno attivo salvato."}
              </p>
              <button
                onClick={() => {
                  setEditingEventId(null);
                  setNewEventBuffer(defaultSafetyBuffer);
                  setNewEventTransportMode(defaultTransportMode);
                  setIsFabOpen(true);
                }}
                className="w-full bg-slate-900 text-white rounded-[16px] py-3.5 flex items-center justify-center gap-2 text-sm font-semibold shadow-sm hover:scale-[1.02] transition-transform"
              >
                <Plus className="w-4 h-4" /> Aggiungi Impegno
              </button>
            </div>
          )}

          {/* FOCUS IN-PROGRESS CARD */}
          {activeEvent && nextEvent !== activeEvent && (
            <div className="bg-white rounded-[24px] p-6 shadow-sm border border-slate-100/60 flex flex-col">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">In Corso</h3>
                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${categoryStyles[activeEvent.category]}`}>
                    {activeEvent.category}
                  </span>
                  <CardActionButtons event={activeEvent} />
                </div>
              </div>
              <h2 className="text-[22px] leading-tight font-semibold text-slate-800 mb-2.5">{activeEvent.title}</h2>
              <div className="flex items-center gap-1.5 text-[13px] text-slate-500 font-medium">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>Iniziato alle {activeEvent.targetTime}</span>
              </div>
            </div>
          )}

          {/* NEXT UP CARD WITH TRANSPORT MODE ICON & WEATHER */}
          {nextEvent && (() => {
            const badgeInfo = renderBadgeInfo(nextEvent);
            const mode = nextEvent.transportMode || "driving";
            return (
              <div className="bg-white rounded-[24px] p-6 shadow-sm border border-slate-100/60 relative">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest leading-none">Prossimo Impegno</h3>
                  <div className="flex items-center gap-2">
                    <span className={`px-3 py-1 rounded-full text-[11px] font-bold tracking-wide leading-none ${badgeInfo.style}`}>
                      {badgeInfo.text}
                    </span>
                    <CardActionButtons event={nextEvent} />
                  </div>
                </div>

                <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden my-3">
                  <div
                    className={`h-full transition-all duration-1000 ease-linear ${badgeInfo.barColor}`}
                    style={{ width: `${badgeInfo.progress}%` }}
                  />
                </div>

                {badgeInfo.isLate && (
                  <p className="text-[11px] font-bold text-red-500 uppercase tracking-widest mt-1 mb-3 animate-pulse">
                    Parti subito per ridurre il ritardo!
                  </p>
                )}

                {/* RAIN / WEATHER WARNING BADGE */}
                {nextEventWeather?.isRainy && (
                  <div className="mb-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded-[14px] flex items-center gap-2 text-xs font-bold text-blue-800 shadow-sm animate-in fade-in">
                    <CloudRain className="w-4 h-4 text-blue-600 shrink-0" />
                    <span>☔ Pioggia a destinazione ({nextEventWeather.temp}°C). Porta l'ombrello!</span>
                  </div>
                )}

                <div className="mb-6">
                  <div className="flex flex-wrap items-center gap-2 mb-2.5">
                    <h2 className="text-[22px] font-semibold text-slate-800 leading-tight pr-10">{nextEvent.title}</h2>
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${categoryStyles[nextEvent.category]}`}>
                      {nextEvent.category}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2 text-[13px] font-medium text-slate-500 mt-3">
                    <span className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-slate-400" />
                      {nextEvent.date === todayStr ? `Oggi alle ${nextEvent.targetTime}` : `${nextEvent.date} alle ${nextEvent.targetTime}`}
                    </span>
                    <span className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
                      <span className="line-clamp-1">{nextEvent.destinationName}</span>
                    </span>
                  </div>
                </div>

                {/* ROUTE & TRANSPORT MODE SUMMARY */}
                <div className="bg-[#F5F5F7] rounded-[16px] p-4 mb-6">
                  <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-slate-600 mb-2">
                    {mode === "walking" ? (
                      <Footprints className="w-4 h-4 text-slate-500 shrink-0" />
                    ) : mode === "cycling" ? (
                      <Bike className="w-4 h-4 text-slate-500 shrink-0" />
                    ) : (
                      <Car className="w-4 h-4 text-slate-500 shrink-0" />
                    )}
                    <span>
                      {mode === "walking" ? "A piedi" : mode === "cycling" ? "In bici" : "In auto"}: ~{nextEvent.travelTimeMins || 10} min
                      {nextEventWeather && (
                        <span className="font-bold text-slate-800 ml-1">
                          • {nextEventWeather.icon} {nextEventWeather.temp}°C
                        </span>
                      )}
                      {" "}• Cuscinetto: +{nextEvent.bufferMinutes} min
                    </span>
                  </div>
                  <div className="text-[13px] font-bold text-slate-800 ml-6">
                    Orario di uscita: {format(badgeInfo.departureTime, "HH:mm")}
                  </div>
                </div>

                {/* INTERACTIVE PRE-DEPARTURE CHECKLIST */}
                {nextEvent.checklist.length > 0 && (
                  <div className="mb-6">
                    <p className="text-[10px] font-bold text-slate-400 mb-2.5 uppercase tracking-widest">Da prendere</p>
                    <div className="flex flex-wrap gap-2">
                      {nextEvent.checklist.map((item) => {
                        const cleanLabel = item.replace(/^✓\s*/, "");
                        const isChecked = item.startsWith("✓ ");
                        return (
                          <button
                            key={cleanLabel}
                            onClick={() => toggleEventChecklistItem(nextEvent.id, cleanLabel)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-xs font-semibold transition-all border ${
                              isChecked
                                ? "bg-emerald-50 text-emerald-700 border-emerald-300 opacity-90 line-through"
                                : "bg-white text-slate-700 border-slate-200 shadow-sm hover:bg-slate-50"
                            }`}
                          >
                            {cleanLabel}
                            {isChecked && <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" strokeWidth={3} />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* MAPS ACTION BUTTON */}
                <button
                  onClick={() => setMapsTargetEvent(nextEvent)}
                  className="w-full bg-[#007AFF] text-white rounded-[16px] py-3.5 flex items-center justify-center gap-2 text-sm font-semibold shadow-sm hover:bg-[#007AFF]/90 active:scale-[0.98] transition-all"
                >
                  <Navigation2 className="w-4 h-4" /> Apri Mappe
                </button>
              </div>
            );
          })()}

          {/* TIMELINE */}
          {upcomingEvents.length > 0 && (
            <div className="mt-3">
              <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest px-1 mb-3">Prossimi Impegni</h3>
              <div className="flex flex-col gap-3">
                {upcomingEvents.map((event) => (
                  <div key={event.id} className="bg-white rounded-[20px] p-4 shadow-sm border border-slate-100/60 flex justify-between items-center">
                    <div className="flex-1 pr-4">
                      <h4 className="font-semibold text-slate-800 text-[15px] line-clamp-1">{event.title}</h4>
                      <div className="flex items-center gap-2 text-xs font-medium text-slate-500 mt-1.5">
                        <Clock className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                        <span>
                          {event.date === todayStr ? `Oggi alle ${event.targetTime}` : `${event.date} alle ${event.targetTime}`}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border hidden sm:block ${categoryStyles[event.category]}`}>
                        {event.category}
                      </span>
                      <CardActionButtons event={event} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* FAB */}
      {masterEvents.length > 0 && (
        <button
          onClick={() => {
            setEditingEventId(null);
            setNewEventTitle("");
            setAddressQuery("");
            setSelectedDest(null);
            setSelectedBookmarkId(null);
            setNewEventTime("");
            setNewEventDate(format(new Date(), "yyyy-MM-dd"));
            setNewEventCategory("Personale");
            setNewEventBuffer(defaultSafetyBuffer);
            setNewEventTransportMode(defaultTransportMode);
            setNewEventChecklist([]);
            setIsFabOpen(true);
          }}
          className="fixed bottom-6 right-6 sm:bottom-8 sm:right-8 w-[52px] h-[52px] bg-slate-900 text-white rounded-full flex items-center justify-center shadow-lg shadow-slate-900/20 hover:scale-105 active:scale-95 transition-all z-40"
        >
          <Plus className="w-6 h-6" />
        </button>
      )}

      {/* SETTINGS MODAL SHEET */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-md p-0 sm:p-4 animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-md rounded-t-[32px] sm:rounded-[32px] p-6 sm:p-8 shadow-2xl animate-in slide-in-from-bottom-full duration-300 max-h-[88vh] overflow-y-auto scrollbar-none [&::-webkit-scrollbar]:hidden relative">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-[22px] font-bold text-slate-900">Impostazioni</h2>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="w-8 h-8 flex items-center justify-center bg-slate-100 rounded-full text-slate-500 hover:bg-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-col gap-6">
              {/* SECTION 1: SEGNAPOSTI / BOOKMARKS */}
              <div className="bg-[#F5F5F7] p-4 rounded-[20px] flex flex-col gap-3">
                <div className="flex justify-between items-center">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">I Miei Segnaposti Preferiti</h3>
                  <button
                    onClick={() => {
                      setIsBookmarkModalOpen(true);
                    }}
                    className="text-xs font-bold text-blue-600 hover:underline flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> Aggiungi
                  </button>
                </div>

                <div className="flex flex-col gap-2">
                  {savedPlaces.map((place) => (
                    <div key={place.id} className="bg-white p-3 rounded-[14px] flex justify-between items-center border border-slate-100 shadow-sm">
                      <div className="flex items-center gap-2.5 min-w-0 pr-2">
                        <span className="text-lg">{place.icon}</span>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-800 truncate">{place.name}</p>
                          <p className="text-[11px] text-slate-400 truncate">{place.address}</p>
                        </div>
                      </div>
                      {savedPlaces.length > 1 && (
                        <button
                          onClick={(e) => deleteBookmark(place.id, e)}
                          className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
                          title="Elimina"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* SECTION 2: PREFERENZE VIAGGIO */}
              <div className="bg-[#F5F5F7] p-4 rounded-[20px] flex flex-col gap-4">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Preferenze Predefinite</h3>

                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-2">Anticipo di sicurezza di default</label>
                  <div className="flex gap-2">
                    {[5, 10, 15, 20].map((mins) => (
                      <button
                        key={mins}
                        onClick={() => {
                          setDefaultSafetyBuffer(mins);
                          localStorage.setItem("ontime_default_buffer", mins.toString());
                        }}
                        className={`flex-1 py-2 rounded-[12px] text-xs font-bold transition-all border ${
                          defaultSafetyBuffer === mins
                            ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                            : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        +{mins} min
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-2">Mezzo di trasporto predefinito</label>
                  <div className="flex bg-white p-1 rounded-[14px] border border-slate-200">
                    <button
                      onClick={() => {
                        setDefaultTransportMode("driving");
                        localStorage.setItem("ontime_default_transport", "driving");
                      }}
                      className={`flex-1 py-2 text-xs font-bold rounded-[10px] flex items-center justify-center gap-1.5 transition-all ${
                        defaultTransportMode === "driving"
                          ? "bg-slate-900 text-white shadow-sm"
                          : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      <Car className="w-3.5 h-3.5" /> Auto
                    </button>
                    <button
                      onClick={() => {
                        setDefaultTransportMode("walking");
                        localStorage.setItem("ontime_default_transport", "walking");
                      }}
                      className={`flex-1 py-2 text-xs font-bold rounded-[10px] flex items-center justify-center gap-1.5 transition-all ${
                        defaultTransportMode === "walking"
                          ? "bg-slate-900 text-white shadow-sm"
                          : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      <Footprints className="w-3.5 h-3.5" /> Piedi
                    </button>
                    <button
                      onClick={() => {
                        setDefaultTransportMode("cycling");
                        localStorage.setItem("ontime_default_transport", "cycling");
                      }}
                      className={`flex-1 py-2 text-xs font-bold rounded-[10px] flex items-center justify-center gap-1.5 transition-all ${
                        defaultTransportMode === "cycling"
                          ? "bg-slate-900 text-white shadow-sm"
                          : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      <Bike className="w-3.5 h-3.5" /> Bici
                    </button>
                  </div>
                </div>
              </div>

              {/* SECTION 3: AUDIO & SUONI */}
              <div className="bg-[#F5F5F7] p-4 rounded-[20px] flex flex-col gap-3">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Suoni & Notifiche</h3>

                <div className="flex justify-between items-center bg-white p-3 rounded-[14px] border border-slate-100">
                  <div className="flex items-center gap-2.5">
                    <Volume2 className="w-4 h-4 text-slate-600" />
                    <div>
                      <p className="text-sm font-bold text-slate-800">Campanello di Partenza</p>
                      <p className="text-[11px] text-slate-400">Suono Web Audio integrato</p>
                    </div>
                  </div>
                  <button
                    onClick={playDepartureChime}
                    className="px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-full text-xs font-bold transition-colors"
                  >
                    🔊 Test Suono
                  </button>
                </div>
              </div>

              {/* SECTION 4: RESET DATI */}
              <div className="pt-2 border-t border-slate-100">
                <button
                  onClick={resetAllData}
                  className="w-full text-xs font-bold text-red-500 py-3 bg-red-50 hover:bg-red-100 rounded-[14px] transition-colors flex items-center justify-center gap-2"
                >
                  <Trash2 className="w-4 h-4" /> Reset Completo e Cancella Dati App
                </button>
              </div>
            </div>

            <div className="h-4 sm:h-0" />
          </div>
        </div>
      )}

      {/* MAPS CHOOSER MODAL SHEET WITH TRANSPORT MODE PARAMS */}
      {mapsTargetEvent && (() => {
        const mode = mapsTargetEvent.transportMode || "driving";
        const gmapMode = mode === "walking" ? "walking" : mode === "cycling" ? "bicycling" : "driving";
        const amapMode = mode === "walking" ? "w" : mode === "cycling" ? "r" : "d";
        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-md p-0 sm:p-4 animate-in fade-in duration-300">
            <div className="bg-white w-full max-w-md rounded-t-[32px] sm:rounded-[32px] p-6 sm:p-8 shadow-2xl animate-in slide-in-from-bottom-full duration-300 relative">
              <button
                onClick={() => setMapsTargetEvent(null)}
                className="absolute top-6 right-6 w-8 h-8 flex items-center justify-center bg-slate-100 rounded-full text-slate-500 hover:bg-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
              <h2 className="text-[22px] font-bold text-slate-900 mb-1">Apri Navigatore</h2>
              <p className="text-[13px] text-slate-500 font-medium mb-6 line-clamp-1">
                Destinazione: {mapsTargetEvent.destinationName}
              </p>

              <div className="flex flex-col gap-3">
                <a
                  href={
                    currentLoc && mapsTargetEvent.destinationCoords
                      ? `https://www.google.com/maps/dir/?api=1&origin=${currentLoc.lat},${currentLoc.lon}&destination=${mapsTargetEvent.destinationCoords.lat},${mapsTargetEvent.destinationCoords.lon}&travelmode=${gmapMode}`
                      : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(mapsTargetEvent.destinationName)}&travelmode=${gmapMode}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setMapsTargetEvent(null)}
                  className="w-full py-4 px-5 bg-blue-600 hover:bg-blue-700 text-white rounded-[20px] font-bold text-sm flex items-center justify-between shadow-sm transition-all"
                >
                  <div className="flex items-center gap-3">
                    <Map className="w-5 h-5" />
                    <span>Google Maps</span>
                  </div>
                  <ExternalLink className="w-4 h-4 opacity-70" />
                </a>

                <a
                  href={
                    mapsTargetEvent.destinationCoords
                      ? `https://maps.apple.com/?daddr=${mapsTargetEvent.destinationCoords.lat},${mapsTargetEvent.destinationCoords.lon}&dirflg=${amapMode}`
                      : `https://maps.apple.com/?q=${encodeURIComponent(mapsTargetEvent.destinationName)}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setMapsTargetEvent(null)}
                  className="w-full py-4 px-5 bg-slate-900 hover:bg-slate-800 text-white rounded-[20px] font-bold text-sm flex items-center justify-between shadow-sm transition-all"
                >
                  <div className="flex items-center gap-3">
                    <Navigation2 className="w-5 h-5" />
                    <span>Apple Maps</span>
                  </div>
                  <ExternalLink className="w-4 h-4 opacity-70" />
                </a>
              </div>

              <div className="h-4 sm:h-0" />
            </div>
          </div>
        );
      })()}

      {/* LOCATION QUICK-SWITCHER MODAL */}
      {isLocationModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-md p-0 sm:p-4 animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-md rounded-t-[32px] sm:rounded-[32px] p-6 sm:p-8 shadow-2xl animate-in slide-in-from-bottom-full sm:zoom-in-95 duration-300 relative">
            <button
              onClick={() => setIsLocationModalOpen(false)}
              className="absolute top-6 right-6 w-8 h-8 flex items-center justify-center bg-slate-100 rounded-full text-slate-500 hover:bg-slate-200"
            >
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-[22px] font-bold text-slate-900 mb-1.5">Posizione di Partenza</h2>
            <p className="text-[13px] text-slate-500 font-medium mb-6">
              Scegli da quale punto calcolare tutti i tragitti.
            </p>

            {!isEditingBase ? (
              <div className="flex flex-col gap-3">
                <button
                  onClick={() => {
                    switchToGpsMode();
                    setIsLocationModalOpen(false);
                  }}
                  className={`w-full p-4 rounded-[20px] border text-left flex items-center justify-between transition-all ${
                    locationMode === "gps"
                      ? "bg-blue-50/70 border-blue-500 ring-2 ring-blue-500/20 shadow-sm"
                      : "bg-slate-50 border-slate-200/80 hover:bg-slate-100"
                  }`}
                >
                  <div className="flex items-center gap-3.5">
                    <div className="w-10 h-10 rounded-full bg-blue-500 text-white flex items-center justify-center shrink-0 shadow-sm">
                      <Navigation2 className="w-5 h-5 fill-white" />
                    </div>
                    <div>
                      <h4 className="text-[15px] font-bold text-slate-900">Usa GPS in tempo reale</h4>
                      <p className="text-xs font-medium text-slate-500 mt-0.5">
                        Rileva la posizione live del dispositivo
                      </p>
                    </div>
                  </div>
                  {locationMode === "gps" && (
                    <div className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center shrink-0">
                      <Check className="w-4 h-4 stroke-[3]" />
                    </div>
                  )}
                </button>

                <button
                  onClick={() => {
                    switchToHomeMode(homeLocation);
                    setIsLocationModalOpen(false);
                  }}
                  className={`w-full p-4 rounded-[20px] border text-left flex items-center justify-between transition-all ${
                    locationMode === "home"
                      ? "bg-slate-900 text-white border-slate-900 shadow-md"
                      : "bg-slate-50 border-slate-200/80 hover:bg-slate-100"
                  }`}
                >
                  <div className="flex items-center gap-3.5 min-w-0 pr-2">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 shadow-sm ${
                      locationMode === "home" ? "bg-slate-800 text-white" : "bg-slate-200 text-slate-700"
                    }`}>
                      <Home className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <h4 className={`text-[15px] font-bold ${locationMode === "home" ? "text-white" : "text-slate-900"}`}>
                        Base Salvata
                      </h4>
                      <p className={`text-xs font-medium truncate mt-0.5 ${locationMode === "home" ? "text-slate-300" : "text-slate-500"}`}>
                        {homeLocation.name}
                      </p>
                    </div>
                  </div>
                  {locationMode === "home" && (
                    <div className="w-6 h-6 rounded-full bg-white text-slate-900 flex items-center justify-center shrink-0">
                      <Check className="w-4 h-4 stroke-[3]" />
                    </div>
                  )}
                </button>

                <button
                  onClick={() => setIsEditingBase(true)}
                  className="w-full mt-2 py-3 px-4 rounded-[16px] bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs flex items-center justify-center gap-2 transition-colors"
                >
                  <Edit3 className="w-4 h-4 text-slate-500" />
                  Cambia indirizzo base predefinito
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-4 animate-in fade-in duration-200">
                <div className="flex justify-between items-center">
                  <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Imposta Nuovo Indirizzo Base</h3>
                  <button
                    onClick={() => setIsEditingBase(false)}
                    className="text-xs font-semibold text-blue-600 hover:underline"
                  >
                    Annulla
                  </button>
                </div>

                <div className="relative">
                  <MapPin className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    autoFocus
                    type="text"
                    value={baseSearchQuery}
                    onChange={(e) => setBaseSearchQuery(e.target.value)}
                    placeholder="Cerca via, locale o città"
                    className="w-full bg-[#F5F5F7] text-slate-900 font-medium rounded-[16px] pl-11 pr-4 py-3 outline-none focus:ring-2 focus:ring-blue-500/30 transition-all placeholder:text-slate-400 text-sm"
                  />
                  {isSearchingBase && <Loader2 className="w-4 h-4 animate-spin text-slate-400 absolute right-4 top-1/2 -translate-y-1/2" />}
                </div>

                {baseSuggestions.length > 0 && (
                  <div className="bg-white rounded-[16px] shadow-lg border border-slate-100 max-h-52 overflow-y-auto scrollbar-none [&::-webkit-scrollbar]:hidden">
                    {baseSuggestions.map((s, i) => (
                      <button
                        key={i}
                        className="w-full text-left px-4 py-3 hover:bg-slate-50 border-b border-slate-50 last:border-0 transition-colors flex items-start gap-2.5"
                        onClick={() => {
                          saveNewHomeBase({
                            coords: { lat: s.lat, lon: s.lon },
                            name: s.name,
                          });
                        }}
                      >
                        <MapPin className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-800 truncate">{s.name}</p>
                          {s.secondary && <p className="text-[12px] text-slate-400 truncate">{s.secondary}</p>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* NEW BOOKMARK CREATION MODAL */}
      {isBookmarkModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-md rounded-[32px] p-6 shadow-2xl animate-in zoom-in-95 duration-300 relative">
            <button
              onClick={() => setIsBookmarkModalOpen(false)}
              className="absolute top-6 right-6 w-8 h-8 flex items-center justify-center bg-slate-100 rounded-full text-slate-500 hover:bg-slate-200"
            >
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-xl font-bold text-slate-900 mb-1">Nuovo Segnaposto Preferito</h2>
            <p className="text-xs text-slate-500 font-medium mb-5">Salva una posizione frequente per selezionarla con un tap.</p>

            <div className="flex flex-col gap-4">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-1.5 block">Nome Segnaposto</label>
                <div className="flex gap-2">
                  <select
                    value={newBookmarkIcon}
                    onChange={(e) => setNewBookmarkIcon(e.target.value)}
                    className="bg-[#F5F5F7] text-lg rounded-[14px] px-3 py-2 outline-none border-0"
                  >
                    {["📍", "🏠", "🎓", "⚽", "💼", "🏋️", "🛒", "☕", "🍕", "🏥"].map((emoji) => (
                      <option key={emoji} value={emoji}>{emoji}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={newBookmarkName}
                    onChange={(e) => setNewBookmarkName(e.target.value)}
                    placeholder="Es. Palestra, Casa di Marco"
                    className="flex-1 bg-[#F5F5F7] text-slate-900 font-medium rounded-[14px] px-4 py-3 outline-none text-sm placeholder:text-slate-400"
                  />
                </div>
              </div>

              <div className="relative">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-1.5 block">Indirizzo o Luogo</label>
                <div className="relative">
                  <MapPin className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={newBookmarkAddressQuery}
                    onChange={(e) => {
                      setNewBookmarkAddressQuery(e.target.value);
                      if (selectedBookmarkCoords && e.target.value !== selectedBookmarkCoords.name) {
                        setSelectedBookmarkCoords(null);
                      }
                    }}
                    placeholder="Es. Via Ministalla, Rende"
                    className="w-full bg-[#F5F5F7] text-slate-900 font-medium rounded-[14px] pl-10 pr-4 py-3 outline-none text-sm placeholder:text-slate-400"
                  />
                  {isSearchingBookmarkAddress && <Loader2 className="w-4 h-4 animate-spin text-slate-400 absolute right-4 top-1/2 -translate-y-1/2" />}
                </div>

                {newBookmarkSuggestions.length > 0 && (
                  <div className="mt-1 bg-white rounded-[16px] shadow-lg border border-slate-100 max-h-48 overflow-y-auto scrollbar-none [&::-webkit-scrollbar]:hidden">
                    {newBookmarkSuggestions.map((s, i) => (
                      <button
                        key={i}
                        className="w-full text-left px-4 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0 transition-colors flex items-start gap-2.5"
                        onClick={() => {
                          setNewBookmarkAddressQuery(s.fullName);
                          setSelectedBookmarkCoords({ lat: s.lat, lon: s.lon, name: s.fullName });
                          setNewBookmarkSuggestions([]);
                        }}
                      >
                        <MapPin className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-slate-900 truncate">{s.name}</p>
                          {s.secondary && <p className="text-[11px] text-slate-400 truncate mt-0.5">{s.secondary}</p>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={handleSaveBookmark}
                className="w-full mt-2 bg-slate-900 text-white rounded-[16px] py-3.5 font-semibold text-sm shadow-sm hover:scale-[1.01] transition-transform"
              >
                Salva nei Preferiti
              </button>
            </div>
          </div>
        </div>
      )}

      {/* COMPLETED ARCHIVE MODAL */}
      {isHistoryOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-slate-900/40 backdrop-blur-md p-0 sm:p-4 animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-md rounded-t-[32px] sm:rounded-[32px] p-6 sm:p-8 shadow-2xl animate-in slide-in-from-bottom-full duration-300 max-h-[85vh] flex flex-col relative">
            <div className="flex justify-between items-center mb-6 shrink-0">
              <h2 className="text-[22px] font-bold text-slate-900">Archivio Impegni Conclusi</h2>
              <button
                onClick={() => setIsHistoryOpen(false)}
                className="w-8 h-8 flex items-center justify-center bg-slate-100 rounded-full text-slate-500 hover:bg-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto min-h-[200px] pr-1 scrollbar-none [&::-webkit-scrollbar]:hidden">
              {completedEvents.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center py-12 opacity-60">
                  <CheckCheck className="w-12 h-12 text-slate-300 mb-4" />
                  <p className="text-sm font-medium text-slate-500">Nessuna attività completata nell'archivio.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-6">
                  {Object.entries(groupedCompleted)
                    .sort(([dateA], [dateB]) => dateB.localeCompare(dateA))
                    .map(([dateKey, items]) => (
                      <div key={dateKey} className="flex flex-col gap-2.5">
                        <div className="flex items-center gap-2 px-1">
                          <Calendar className="w-3.5 h-3.5 text-slate-400" />
                          <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                            {format(new Date(`${dateKey}T00:00:00`), "EEEE d MMMM yyyy", { locale: it })}
                          </h4>
                        </div>
                        {items.map((event) => (
                          <div key={event.id} className="bg-slate-50 rounded-[16px] p-4 border border-slate-100 flex justify-between items-center">
                            <div className="flex-1 pr-3 min-w-0">
                              <h4 className="font-semibold text-slate-500 text-[14px] truncate line-through">{event.title}</h4>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{event.category}</span>
                                <span className="text-[11px] text-slate-300">•</span>
                                <span className="text-[11px] font-medium text-slate-400">
                                  {event.completedAt ? `Concluso alle ${format(new Date(event.completedAt), "HH:mm")}` : "Completato"}
                                </span>
                              </div>
                            </div>
                            <button
                              onClick={() => restoreEvent(event.id)}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-full text-[11px] font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors shrink-0 shadow-sm"
                            >
                              <Undo2 className="w-3.5 h-3.5" /> Ripristina
                            </button>
                          </div>
                        ))}
                      </div>
                    ))}
                </div>
              )}
            </div>

            {completedEvents.length > 0 && (
              <div className="mt-6 pt-4 border-t border-slate-100 shrink-0">
                <button
                  onClick={() => {
                    if (window.confirm("Vuoi davvero svuotare definitivamente l'archivio?")) {
                      setMasterEvents((prev) => prev.filter((e) => e.status !== "completed"));
                    }
                  }}
                  className="w-full text-[13px] font-semibold text-red-500 py-2 hover:bg-red-50 rounded-lg transition-colors"
                >
                  Svuota Archivio Conclusi
                </button>
              </div>
            )}

            <div className="h-4 sm:h-0" />
          </div>
        </div>
      )}

      {/* NEW / EDIT EVENT MODAL SHEET */}
      {isFabOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-slate-900/40 backdrop-blur-md p-0 sm:p-4 animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-md rounded-t-[32px] sm:rounded-[32px] p-5 sm:p-7 shadow-2xl animate-in slide-in-from-bottom-full duration-300 max-h-[88vh] overflow-y-auto scrollbar-none [&::-webkit-scrollbar]:hidden relative">
            <div className="flex justify-between items-center mb-5">
              <h2 className="text-[20px] font-bold text-slate-900">
                {editingEventId ? "Modifica Impegno" : "Nuovo Impegno"}
              </h2>
              <button
                onClick={() => {
                  setIsFabOpen(false);
                  setEditingEventId(null);
                }}
                className="w-8 h-8 flex items-center justify-center bg-slate-100 rounded-full text-slate-500 hover:bg-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-col gap-4">
              {/* Title */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-1.5 block">
                  Titolo Impegno
                </label>
                <input
                  type="text"
                  value={newEventTitle}
                  onChange={(e) => setNewEventTitle(e.target.value)}
                  placeholder="Es. Padel, Dentista, Spesa"
                  className="w-full bg-[#F5F5F7] text-slate-900 font-medium rounded-[14px] px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500/30 transition-all placeholder:text-slate-400 text-sm"
                />
              </div>

              {/* Category */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-1.5 block">
                  Categoria
                </label>
                <div className="flex flex-wrap gap-2">
                  {(["Sport", "Lavoro", "Salute", "Personale"] as EventCategory[]).map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setNewEventCategory(cat)}
                      className={`px-3 py-1.5 rounded-[10px] text-xs font-bold transition-all border ${
                        newEventCategory === cat
                          ? categoryStyles[cat]
                          : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Transport Mode Selector */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-1.5 block">
                  Mezzo di Trasporto
                </label>
                <div className="flex bg-[#F5F5F7] p-1 rounded-[14px]">
                  <button
                    onClick={() => setNewEventTransportMode("driving")}
                    className={`flex-1 py-2 text-xs font-bold rounded-[10px] flex items-center justify-center gap-1.5 transition-all ${
                      newEventTransportMode === "driving"
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    <Car className="w-3.5 h-3.5" /> In Auto
                  </button>
                  <button
                    onClick={() => setNewEventTransportMode("walking")}
                    className={`flex-1 py-2 text-xs font-bold rounded-[10px] flex items-center justify-center gap-1.5 transition-all ${
                      newEventTransportMode === "walking"
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    <Footprints className="w-3.5 h-3.5" /> A Piedi
                  </button>
                  <button
                    onClick={() => setNewEventTransportMode("cycling")}
                    className={`flex-1 py-2 text-xs font-bold rounded-[10px] flex items-center justify-center gap-1.5 transition-all ${
                      newEventTransportMode === "cycling"
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    <Bike className="w-3.5 h-3.5" /> Bici / Moto
                  </button>
                </div>
              </div>

              {/* Address Autocomplete & Saved Bookmarks Bar */}
              <div className="relative">
                <div className="flex justify-between items-center ml-1 mb-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">
                    Destinazione
                  </label>
                  <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">
                    Segnaposti Rapidi
                  </span>
                </div>

                {/* SAVED PLACES / BOOKMARKS CHIPS BAR FROM SETTINGS */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-2 scrollbar-none [&::-webkit-scrollbar]:hidden">
                  {savedPlaces.map((place) => {
                    const isSelected = selectedBookmarkId === place.id;
                    return (
                      <div
                        key={place.id}
                        onClick={() => handleSelectBookmark(place)}
                        className={`px-3 py-1.5 rounded-[12px] text-xs font-semibold flex items-center gap-1.5 cursor-pointer shrink-0 border transition-all ${
                          isSelected
                            ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                            : "bg-[#F5F5F7] text-slate-700 border-slate-200/80 hover:bg-slate-200/60"
                        }`}
                      >
                        <span>{place.icon}</span>
                        <span>{place.name}</span>
                      </div>
                    );
                  })}

                  <button
                    onClick={() => setIsBookmarkModalOpen(true)}
                    className="px-2.5 py-1.5 rounded-[12px] text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200 shrink-0 flex items-center gap-1 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5 text-slate-500" /> Nuovo
                  </button>
                </div>

                <div className="relative">
                  <MapPin className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={addressQuery}
                    onChange={(e) => {
                      setAddressQuery(e.target.value);
                      if (selectedDest && e.target.value !== selectedDest.name) {
                        setSelectedDest(null);
                        setSelectedBookmarkId(null);
                      }
                    }}
                    placeholder="Cerca via, locale o città"
                    className="w-full bg-[#F5F5F7] text-slate-900 font-medium rounded-[14px] pl-10 pr-4 py-3 outline-none focus:ring-2 focus:ring-blue-500/30 transition-all placeholder:text-slate-400 text-sm"
                  />
                  {isSearchingAddress && <Loader2 className="w-4 h-4 animate-spin text-slate-400 absolute right-4 top-1/2 -translate-y-1/2" />}
                </div>

                {/* Suggestions Dropdown (Photon + Nominatim + Manual Fallback) */}
                {addressQuery.trim().length >= 2 && (addressSuggestions.length > 0 || !selectedDest) && (
                  <div className="absolute top-full left-0 right-0 z-[999] bg-white rounded-xl shadow-2xl border border-gray-100 max-h-56 overflow-y-auto scrollbar-none [&::-webkit-scrollbar]:hidden mt-1">
                    {addressSuggestions.map((s, i) => (
                      <button
                        key={i}
                        className="w-full text-left px-4 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0 transition-colors flex items-start gap-2.5"
                        onClick={() => {
                          setAddressQuery(s.fullName);
                          setSelectedDest({ lat: s.lat, lon: s.lon, name: s.fullName });
                          setAddressSuggestions([]);
                        }}
                      >
                        <MapPin className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-slate-900 truncate">{s.name}</p>
                          {s.secondary && <p className="text-[11px] text-slate-400 truncate mt-0.5">{s.secondary}</p>}
                        </div>
                      </button>
                    ))}

                    {/* MANUAL FALLBACK OPTION FOR UNINDEXED STREETS */}
                    <button
                      className="w-full text-left px-4 py-3 bg-slate-50 hover:bg-blue-50 border-t border-slate-100 transition-colors flex items-center gap-2.5 text-blue-600 font-semibold text-xs"
                      onClick={() => {
                        const coords = currentLoc || DEFAULT_BASE_LOCATION.coords;
                        setSelectedDest({ lat: coords.lat, lon: coords.lon, name: addressQuery });
                        setAddressSuggestions([]);
                      }}
                    >
                      <MapPin className="w-4 h-4 text-blue-600 shrink-0" />
                      <span className="truncate">📍 Usa indirizzo digitato: "{addressQuery}"</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Date & Time Picker */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-1.5 block">
                    Data
                  </label>
                  <div className="relative">
                    <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="date"
                      value={newEventDate}
                      onChange={(e) => setNewEventDate(e.target.value)}
                      className="w-full bg-[#F5F5F7] text-slate-900 font-medium text-xs rounded-[14px] pl-9 pr-2 py-3 outline-none focus:ring-2 focus:ring-blue-500/30 transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-1.5 block">
                    Orario Arrivo
                  </label>
                  <div className="relative">
                    <Clock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="time"
                      value={newEventTime}
                      onChange={(e) => setNewEventTime(e.target.value)}
                      className="w-full bg-[#F5F5F7] text-slate-900 font-medium text-xs rounded-[14px] pl-9 pr-2 py-3 outline-none focus:ring-2 focus:ring-blue-500/30 transition-all"
                    />
                  </div>
                </div>
              </div>

              {/* Safety Buffer */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-1.5 block">
                  Anticipo di sicurezza
                </label>
                <div className="flex flex-wrap gap-2">
                  {[5, 10, 15, 20].map((mins) => (
                    <button
                      key={mins}
                      onClick={() => setNewEventBuffer(mins)}
                      className={`px-3 py-1.5 rounded-[10px] text-xs font-semibold transition-all border ${
                        newEventBuffer === mins
                          ? "bg-slate-800 text-white border-slate-800"
                          : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      +{mins} min {mins === 10 && "(cons.)"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Items to Grab with Custom Tags Builder */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-1.5 block">
                  Cose da non dimenticare
                </label>
                <div className="flex flex-wrap gap-2 items-center">
                  {/* Default Quick Options */}
                  {defaultQuickTags.map((item) => (
                    <button
                      key={item}
                      onClick={() => toggleFormChecklistItem(item)}
                      className={`px-3 py-1.5 rounded-[10px] text-xs font-medium transition-colors border ${
                        newEventChecklist.includes(item)
                          ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                          : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      {item}
                    </button>
                  ))}

                  {/* Custom Added Items */}
                  {newEventChecklist
                    .filter((item) => !defaultQuickTags.includes(item))
                    .map((item) => (
                      <span
                        key={item}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-[10px] text-xs font-semibold bg-blue-600 text-white border border-blue-600 shadow-sm"
                      >
                        {item}
                        <button
                          onClick={() => toggleFormChecklistItem(item)}
                          className="hover:opacity-80 ml-1"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}

                  {/* Inline Custom Input or "+ Altro" Trigger */}
                  {isAddingCustomItem ? (
                    <div className="flex items-center gap-1 bg-[#F5F5F7] rounded-[10px] px-2 py-1 border border-slate-300">
                      <input
                        autoFocus
                        type="text"
                        value={customItemInput}
                        onChange={(e) => setCustomItemInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddCustomChecklistItem();
                          }
                        }}
                        placeholder="Aggiungi..."
                        className="bg-transparent text-xs font-medium outline-none text-slate-800 w-24"
                      />
                      <button
                        onClick={handleAddCustomChecklistItem}
                        className="w-5 h-5 bg-blue-600 text-white rounded-full flex items-center justify-center shrink-0"
                      >
                        <Check className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => {
                          setIsAddingCustomItem(false);
                          setCustomItemInput("");
                        }}
                        className="text-slate-400 hover:text-slate-600"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setIsAddingCustomItem(true)}
                      className="px-3 py-1.5 rounded-[10px] text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors flex items-center gap-1 border border-slate-200/80"
                    >
                      <Plus className="w-3.5 h-3.5 text-slate-500" /> Altro
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-6 mb-2">
              <button
                onClick={handleSaveEvent}
                disabled={isSaving}
                className="w-full bg-[#007AFF] text-white rounded-[16px] py-3.5 font-semibold text-sm shadow-sm hover:bg-[#007AFF]/90 active:scale-[0.98] transition-all flex justify-center items-center gap-2"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Calcolo percorso...
                  </>
                ) : editingEventId ? (
                  "Aggiorna Impegno"
                ) : (
                  "Salva Impegno"
                )}
              </button>
            </div>

            <div className="h-4 sm:h-0" />
          </div>
        </div>
      )}
    </main>
  );
}
