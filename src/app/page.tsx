"use client";

import React, { useState, useEffect, useRef } from "react";
import { 
  format, differenceInMinutes, addMinutes, parse, addDays,
  startOfMonth, endOfMonth, eachDayOfInterval, getDay, addMonths, subMonths, isSameDay 
} from "date-fns";
import { it } from "date-fns/locale";
import { 
  Clock, MapPin, Plus, Navigation2, Check, Car, X, Loader2, Sun, 
  Trash2, CheckCircle2, CheckCheck, Undo2, Calendar, Home, Edit3, 
  Bell, BellOff, ExternalLink, Map, CloudRain, Pencil, Footprints, Bike, 
  Settings, Volume2, Sliders, ShieldAlert, Sparkles, Share, PlusSquare, Smartphone,
  User, LogIn, LogOut, ChevronLeft, ChevronRight, Lock, Mail, Zap, Bookmark, RefreshCw
} from "lucide-react";
import Image from "next/image";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { fetchRealtimeRoute } from "@/lib/routing";

// --- Types & Schema ---
type EventCategory = "Lavoro" | "Salute" | "Personale" | "Sport" | "Studio";
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
  origin_type?: 'live' | 'bookmark' | 'custom';
  origin_coords?: { lat: number; lon: number } | null;
  origin_address?: string | null;
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
  icon?: string;
  category?: string;
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
  Studio: "border-indigo-500 text-indigo-700 bg-indigo-500/10",
};

// No hardcoded locations allowed

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

// Robust Real-Time Route Duration Calculation (Mapbox Traffic + Calibrated OSRM Fallback)
const fetchOsrmRouteMins = async (
  startCoords: { lat: number; lon: number },
  destCoords: { lat: number; lon: number },
  mode: TransportMode = "driving",
  token?: string | null
): Promise<number> => {
  const res = await fetchRealtimeRoute(
    startCoords.lat,
    startCoords.lon,
    destCoords.lat,
    destCoords.lon,
    mode,
    token
  );
  return res.durationMinutes;
};

export default function Dashboard() {
  const [isMounted, setIsMounted] = useState(false);
  const [now, setNow] = useState(new Date());

  // Master State
  const [masterEvents, setMasterEvents] = useState<MasterEvent[]>([]);
  const [dateTab, setDateTab] = useState<"oggi" | "domani" | "tutti">("oggi");

  // Supabase Auth & Cloud Sync State
  const [authUser, setAuthUser] = useState<any>(null);
  const [authChecking, setAuthChecking] = useState<boolean>(true);
  const [isGuestMode, setIsGuestMode] = useState<boolean>(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authLoading, setAuthLoading] = useState(false);
  const [authMessage, setAuthMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  // Mapbox Real-time Traffic Token State
  const [mapboxToken, setMapboxToken] = useState<string>("");

  // Apple Calendar Interactive State (for "Tutti" tab)
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));

  // Lock-screen Notification Tester State
  const [testNotificationCountdown, setTestNotificationCountdown] = useState<number | null>(null);

  // Geolocation & Base Memory State
  const [locationMode, setLocationMode] = useState<"home" | "gps">("home");
  const [homeLocation, setHomeLocation] = useState<BaseLocation | null>(null);
  const [currentLoc, setCurrentLoc] = useState<{ lat: number; lon: number } | null>(null);
  const [currentCity, setCurrentCity] = useState<string>("Rilevamento in corso...");
  const [isLocating, setIsLocating] = useState(false);

  // Settings & Travel Preferences State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [defaultSafetyBuffer, setDefaultSafetyBuffer] = useState<number>(10);
  const [defaultTransportMode, setDefaultTransportMode] = useState<TransportMode>("driving");
  const [vibrationEnabled, setVibrationEnabled] = useState(true);

  // iOS Standalone Installation Modal State
  const [isIosInstallModalOpen, setIsIosInstallModalOpen] = useState(false);

  // Bookmarks / Saved Places State
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [selectedBookmarkId, setSelectedBookmarkId] = useState<string | null>(null);

  // New Bookmark Modal State
  const [isBookmarkModalOpen, setIsBookmarkModalOpen] = useState(false);
  const [newBookmarkName, setNewBookmarkName] = useState("");
  const [newBookmarkIcon, setNewBookmarkIcon] = useState("📍");
  const [newBookmarkAddressQuery, setNewBookmarkAddressQuery] = useState("");
  const [newBookmarkSuggestions, setNewBookmarkSuggestions] = useState<LocationSuggestion[]>([]);
  const [selectedBookmarkCoords, setSelectedBookmarkCoords] = useState<{ lat: number; lon: number; name: string } | null>(null);
  const [isSearchingBookmarkAddress, setIsSearchingBookmarkAddress] = useState(false);
  const [bookmarkSavedFeedback, setBookmarkSavedFeedback] = useState(false);

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

  // "Partenza da" selector state
  const [originType, setOriginType] = useState<"live" | "bookmark" | "custom">("live");
  const [originBookmarkId, setOriginBookmarkId] = useState<string | null>(null);
  const [originCustomQuery, setOriginCustomQuery] = useState("");
  const [originCustomCoords, setOriginCustomCoords] = useState<{lat: number, lon: number} | null>(null);
  const [originCustomAddress, setOriginCustomAddress] = useState<string | null>(null);
  const [isOriginSearchOpen, setIsOriginSearchOpen] = useState(false);
  const [originSuggestions, setOriginSuggestions] = useState<LocationSuggestion[]>([]);
  const [isSearchingOrigin, setIsSearchingOrigin] = useState(false);

  // Header refresh state
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Default Campus State
  type CampusLocation = {
    name: string;
    coords: { lat: number; lon: number };
  };

  const [defaultCampus, setDefaultCampus] = useState<CampusLocation | null>(null);
  const [campusSearchQuery, setCampusSearchQuery] = useState("");
  const [campusSuggestions, setCampusSuggestions] = useState<LocationSuggestion[]>([]);
  const [isSearchingCampus, setIsSearchingCampus] = useState(false);
  const [isEditingCampus, setIsEditingCampus] = useState(false);

  // Routines & Classes State
  type UserRoutine = {
    id: string;
    user_id?: string;
    day_of_week: number; // 0=Dom, 1=Lun, 2=Mar, 3=Mer, 4=Gio, 5=Ven, 6=Sab
    title: string;
    start_time: string;
    end_time: string;
    location_name: string;
    location_coords?: { lat: number; lon: number };
    transport_mode?: TransportMode;
    buffer_minutes?: number;
    checklist?: string[];
  };

  const [isRoutinesModalOpen, setIsRoutinesModalOpen] = useState(false);
  const [userRoutines, setUserRoutines] = useState<UserRoutine[]>([]);
  const [selectedRoutineDay, setSelectedRoutineDay] = useState<number>(() => {
    return new Date().getDay();
  });
  const [newRoutineTitle, setNewRoutineTitle] = useState("");
  const [newRoutineStartTime, setNewRoutineStartTime] = useState("");
  const [newRoutineEndTime, setNewRoutineEndTime] = useState("");
  const [newRoutineLocation, setNewRoutineLocation] = useState("");
  const [isSavingRoutine, setIsSavingRoutine] = useState(false);

  // Study Focus Timer State (Alternating Focus & Break Engine)
  type StudyMode = "study" | "break";

  type ActiveStudyBlock = {
    subject: string;
    studyMinutes: number;
    breakMinutes: number;
    mode: StudyMode;
    secondsLeft: number;
    initialSeconds: number;
    isRunning: boolean;
    isExpandedView?: boolean;
  };

  const [isStudyModalOpen, setIsStudyModalOpen] = useState(false);
  const [studySubject, setStudySubject] = useState("");
  const [selectedStudyDuration, setSelectedStudyDuration] = useState<number>(25);
  const [selectedBreakDuration, setSelectedBreakDuration] = useState<number>(5);
  const [customStudyInput, setCustomStudyInput] = useState<string>("25");
  const [customBreakInput, setCustomBreakInput] = useState<string>("5");
  const [studyPresetMode, setStudyPresetMode] = useState<"25_5" | "50_10" | "custom">("25_5");
  const [activeStudyBlock, setActiveStudyBlock] = useState<ActiveStudyBlock | null>(null);
  const [studyNotice, setStudyNotice] = useState<{ title: string; body: string; icon: string; mode: "study" | "break" } | null>(null);

  const saveStudySessionToSupabase = async (subject: string, minutes: number, completed: boolean) => {
    if (!authUser || !supabase) return;
    try {
      await supabase.from("study_sessions").insert([{
        user_id: authUser.id,
        subject,
        duration_minutes: minutes,
        session_date: format(new Date(), "yyyy-MM-dd"),
        completed
      }]);
    } catch (err) {
      console.error("Error saving study session:", err);
    }
  };

  useEffect(() => {
    if (!activeStudyBlock || !activeStudyBlock.isRunning) return;

    const timer = setInterval(() => {
      setActiveStudyBlock((prev: ActiveStudyBlock | null) => {
        if (!prev) return null;
        if (prev.secondsLeft <= 1) {
          clearInterval(timer);
          playDepartureChime();
          if (typeof navigator !== "undefined" && "vibrate" in navigator) {
            navigator.vibrate([300, 150, 300]);
          }

          if (prev.mode === "study") {
            saveStudySessionToSupabase(prev.subject, prev.studyMinutes, true);
            setStudyNotice({
              title: "Sessione Completata!",
              body: `Ottimo lavoro su "${prev.subject}"! È ora di fare una pausa relax di ${prev.breakMinutes} minuti.`,
              icon: "🎉",
              mode: "break",
            });
            const breakSecs = prev.breakMinutes * 60;
            return {
              ...prev,
              mode: "break",
              secondsLeft: breakSecs,
              initialSeconds: breakSecs,
              isRunning: true,
            };
          } else {
            setStudyNotice({
              title: "Pausa Completata!",
              body: `La tua pausa relax è terminata. Sei pronto per riprendere lo studio su "${prev.subject}"?`,
              icon: "🌿",
              mode: "study",
            });
            const studySecs = prev.studyMinutes * 60;
            return {
              ...prev,
              mode: "study",
              secondsLeft: studySecs,
              initialSeconds: studySecs,
              isRunning: false,
            };
          }
        }
        return { ...prev, secondsLeft: prev.secondsLeft - 1 };
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [activeStudyBlock?.isRunning, activeStudyBlock?.mode]);

  const handleStartStudyBlock = () => {
    const subj = studySubject.trim() || "Studio Generale";
    let studyMins = selectedStudyDuration;
    let breakMins = selectedBreakDuration;

    if (studyPresetMode === "25_5") {
      studyMins = 25;
      breakMins = 5;
    } else if (studyPresetMode === "50_10") {
      studyMins = 50;
      breakMins = 10;
    } else {
      studyMins = Math.max(1, parseInt(customStudyInput) || 25);
      breakMins = Math.max(1, parseInt(customBreakInput) || 5);
    }

    const initialSecs = studyMins * 60;
    setActiveStudyBlock({
      subject: subj,
      studyMinutes: studyMins,
      breakMinutes: breakMins,
      mode: "study",
      secondsLeft: initialSecs,
      initialSeconds: initialSecs,
      isRunning: true,
      isExpandedView: true,
    });
    setIsStudyModalOpen(false);
    setStudySubject("");
  };

  const togglePauseResumeStudy = () => {
    if (!activeStudyBlock) return;
    setActiveStudyBlock((prev: ActiveStudyBlock | null) => prev ? { ...prev, isRunning: !prev.isRunning } : null);
  };

  const handleAdd5MinsToStudy = () => {
    if (!activeStudyBlock) return;
    setActiveStudyBlock((prev: ActiveStudyBlock | null) => prev ? {
      ...prev,
      secondsLeft: prev.secondsLeft + 300,
      initialSeconds: prev.initialSeconds + 300
    } : null);
  };

  const handleEndStudySession = () => {
    if (!activeStudyBlock) return;
    const elapsedMins = Math.max(1, Math.round((activeStudyBlock.initialSeconds - activeStudyBlock.secondsLeft) / 60));
    saveStudySessionToSupabase(activeStudyBlock.subject, elapsedMins, true);
    setActiveStudyBlock(null);
  };

  const formatTimerMinutesSeconds = (totalSecs: number) => {
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleAddRoutine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoutineTitle.trim() || !newRoutineStartTime || !newRoutineEndTime) {
      alert("Compila materia, orario inizio e orario fine!");
      return;
    }

    setIsSavingRoutine(true);
    const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString();
    const newRoutine: UserRoutine = {
      id,
      user_id: authUser?.id,
      day_of_week: selectedRoutineDay,
      title: newRoutineTitle.trim(),
      start_time: newRoutineStartTime,
      end_time: newRoutineEndTime,
      location_name: newRoutineLocation.trim() || "Aula",
      location_coords: currentLoc || { lat: 39.362, lon: 16.225 },
      transport_mode: "driving",
      buffer_minutes: 10,
      checklist: [],
    };

    const updated = [...userRoutines, newRoutine];
    setUserRoutines(updated);
    
    // Spawn if for today
    const todayDay = new Date().getDay();
    if (newRoutine.day_of_week === todayDay) {
      const todayStr = format(new Date(), "yyyy-MM-dd");
      setMasterEvents((prev) => [
        ...prev,
        {
          id: `routine_${newRoutine.id}_${todayStr}`,
          title: newRoutine.title,
          category: "Studio",
          date: todayStr,
          targetTime: newRoutine.start_time,
          destinationName: newRoutine.location_name || (defaultCampus ? defaultCampus.name : "Aula"),
          destinationCoords: newRoutine.location_coords?.lat ? newRoutine.location_coords : (defaultCampus ? defaultCampus.coords : { lat: 0, lon: 0 }),
          bufferMinutes: 10,
          checklist: [],
          status: "active",
          transportMode: "driving",
        },
      ]);
    }

    if (authUser && supabase) {
      try {
        await supabase.from("user_routines").insert([{
          id: newRoutine.id,
          user_id: authUser.id,
          day_of_week: newRoutine.day_of_week,
          title: newRoutine.title,
          start_time: newRoutine.start_time,
          end_time: newRoutine.end_time,
          location_name: newRoutine.location_name,
          location_coords: newRoutine.location_coords,
          transport_mode: newRoutine.transport_mode,
          buffer_minutes: newRoutine.buffer_minutes,
          checklist: newRoutine.checklist,
        }]);
      } catch (err) {
        console.error("Error inserting routine:", err);
      }
    }

    setNewRoutineTitle("");
    setNewRoutineStartTime("");
    setNewRoutineEndTime("");
    setNewRoutineLocation("");
    setIsSavingRoutine(false);
  };

  const handleDeleteRoutine = async (id: string) => {
    setUserRoutines((prev) => prev.filter((r) => r.id !== id));
    if (authUser && supabase) {
      try {
        await supabase.from("user_routines").delete().eq("id", id).eq("user_id", authUser.id);
      } catch (err) {
        console.error("Error deleting routine:", err);
      }
    }
  };

  // Ref for GPS Watch ID
  const watchIdRef = useRef<number | null>(null);

  // Modal Scroll Lock Effect
  const isAnyModalOpen = isFabOpen || isSettingsOpen || isHistoryOpen || isLocationModalOpen || isBookmarkModalOpen || !!mapsTargetEvent || isAuthModalOpen || isIosInstallModalOpen;

  useEffect(() => {
    if (isAnyModalOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isAnyModalOpen]);

  // Web Audio Synthesizer Chime
  const playDepartureChime = () => {
    if (typeof window === "undefined") return;
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

  // Register Service Worker only if notifications were granted
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      typeof Notification !== "undefined" &&
      Notification.permission === "granted"
    ) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          setSwRegistration(reg);
        })
        .catch((err) => console.warn("SW registration error:", err));
    }
  }, []);

  // Helper to extract relevant POI icon based on venue name or categories
  const getPoiIcon = (name: string, category?: string, placeType?: string[]): string => {
    const lower = `${name} ${category || ""}`.toLowerCase();
    if (lower.includes("ristorante") || lower.includes("pizzeria") || lower.includes("trattoria") || lower.includes("sushi") || lower.includes("food") || lower.includes("osteria") || lower.includes("cucina") || lower.includes("tavern")) return "🍽️";
    if (lower.includes("bar") || lower.includes("café") || lower.includes("cafe") || lower.includes("pub") || lower.includes("bistrot") || lower.includes("pasticceria") || lower.includes("gelateria") || lower.includes("cocktail")) return "☕";
    if (lower.includes("padel") || lower.includes("calcetto") || lower.includes("calcio") || lower.includes("palestra") || lower.includes("sport") || lower.includes("tennis") || lower.includes("fitness") || lower.includes("gym") || lower.includes("piscina") || lower.includes("campo") || lower.includes("stadio")) return "⚽";
    if (lower.includes("supermercato") || lower.includes("market") || lower.includes("negozio") || lower.includes("store") || lower.includes("shop") || lower.includes("outlet") || lower.includes("centro commerciale")) return "🛍️";
    if (lower.includes("farmacia") || lower.includes("ospedale") || lower.includes("clinica") || lower.includes("studio medico") || lower.includes("dentista") || lower.includes("dottore") || lower.includes("asl")) return "💊";
    if (lower.includes("unical") || lower.includes("università") || lower.includes("universita") || lower.includes("scuola") || lower.includes("liceo") || lower.includes("campus") || lower.includes("aula") || lower.includes("cubo")) return "🎓";
    if (lower.includes("hotel") || lower.includes("b&b") || lower.includes("residence") || lower.includes("albergo") || lower.includes("agriturismo")) return "🏨";
    if (lower.includes("stazione") || lower.includes("ferrovia") || lower.includes("treno") || lower.includes("aeroporto") || lower.includes("terminal")) return "🚉";
    if (lower.includes("parco") || lower.includes("villa") || lower.includes("giardino")) return "🌳";
    if (placeType?.includes("poi")) return "🏢";
    return "📍";
  };

  // Unified POI & Address Search Engine (Strict Mapbox API)
  const searchPlaces = async (query: string): Promise<LocationSuggestion[]> => {
    if (!query || query.trim().length < 2) return [];

    if (!currentLoc) return [];
    const lat = currentLoc.lat;
    const lon = currentLoc.lon;
    const activeMapboxToken = mapboxToken || process.env.NEXT_PUBLIC_MAPBOX_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || "";

    console.log("OnTime Search Engine: Mapbox Token Present?", Boolean(activeMapboxToken));

    // 1. Primary Engine: Mapbox Geocoding Places API
    if (activeMapboxToken) {
      try {
        const queryMapbox = async (q: string, withTypes: boolean) => {
          const params = new URLSearchParams({
            access_token: activeMapboxToken,
            country: 'it',
            proximity: `${lon},${lat}`,
            fuzzyMatch: 'true',
            language: 'it',
            limit: '8'
          });
          if (withTypes) {
            params.append('types', 'poi,address,neighborhood,place,locality');
          }
          const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?${params.toString()}`;
          const res = await fetch(url);
          if (!res.ok) return [];
          const data = await res.json();
          if (data.features && data.features.length > 0) {
            return data.features.map((f: any) => {
              const mainName = f.text || f.place_name.split(",")[0];
              const cleanFullName = (f.place_name || "").replace(/,\s*(Italia|Italy)$/i, "");
              const parts = cleanFullName.split(",");
              const secondary = parts.length > 1 ? parts.slice(1).join(",").trim() : "";
              const category = f.properties?.category || (f.place_type && f.place_type[0]) || "";
              const icon = getPoiIcon(mainName, category, f.place_type);

              return {
                name: mainName,
                secondary,
                fullName: cleanFullName,
                lat: f.center[1],
                lon: f.center[0],
                icon,
                category,
              };
            });
          }
          return [];
        };

        let results = await queryMapbox(query, true);
        
        // Sub-query fallback if 0 results
        if (results.length === 0) {
          console.log("Mapbox returned 0 results, executing fallback sub-query...");
          let fallbackQuery = query;
          if (currentCity && !query.toLowerCase().includes(currentCity.toLowerCase().split(",")[0])) {
             fallbackQuery = `${query} ${currentCity}`;
          }
          results = await queryMapbox(fallbackQuery, false);
        }

        if (results.length > 0) {
          return results;
        } else {
          console.log("Mapbox commercial POI search returned 0 results, falling through to Nominatim open amenity search...");
        }
      } catch (err) {
        console.warn("Mapbox Places POI search error:", err);
      }
    }

    // 2. Fallback Engine ONLY if Mapbox token is missing
    try {
      let nominatimQuery = query;
      if (currentCity && !query.toLowerCase().includes(currentCity.toLowerCase().split(",")[0])) {
        nominatimQuery = `${query}, ${currentCity.split(",")[0]}`;
      }
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(nominatimQuery)}&countrycodes=it&limit=6&addressdetails=1`
      );
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data.map((item: any) => {
          const addr = item.address || {};
          const mainName = addr.amenity || addr.building || addr.road || item.display_name.split(",")[0];
          const secondary = [addr.road, addr.suburb, addr.city || addr.town || addr.village, addr.state].filter(Boolean).join(", ");
          const icon = getPoiIcon(mainName, addr.amenity);
          return {
            name: mainName,
            secondary,
            fullName: item.display_name,
            lat: parseFloat(item.lat),
            lon: parseFloat(item.lon),
            icon,
          };
        });
      }
    } catch (e) {
      console.error("Nominatim search failed", e);
    }

    return [];
  };

  const fetchSuggestions = async (query: string): Promise<LocationSuggestion[]> => {
    return searchPlaces(query);
  };

  const handleSmartPaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      const regexAt = /@(-?\d+\.\d+),(-?\d+\.\d+)/;
      const regexQ = /[?&]q=(-?\d+\.\d+)[,%](-?\d+\.\d+)/;
      let lat = null, lon = null;
      const matchAt = text.match(regexAt);
      if (matchAt) { lat = parseFloat(matchAt[1]); lon = parseFloat(matchAt[2]); }
      else {
        const matchQ = text.match(regexQ);
        if (matchQ) { lat = parseFloat(matchQ[1]); lon = parseFloat(matchQ[2]); }
      }
      if (lat !== null && lon !== null) {
        setAddressQuery("Posizione da link incollato");
        setSelectedDest({ lat, lon, name: "Posizione da link incollato" });
        setAddressSuggestions([]);
      } else {
        setAddressQuery(text);
        setSelectedDest(null);
        setIsSearchingAddress(true);
        const results = await fetchSuggestions(text);
        setAddressSuggestions(results);
        setIsSearchingAddress(false);
      }
    } catch (e) {
      alert("Permesso per gli appunti negato o impossibile incollare.");
    }
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
      // Master events are loaded purely from Supabase now

      // Load Mapbox Token
      const storedMapbox = localStorage.getItem("ontime_mapbox_token");
      if (storedMapbox) setMapboxToken(storedMapbox);

      // Fast-Initial Campus Cache read
      const cachedCampus = localStorage.getItem("ontime_campus_cached");
      if (cachedCampus) {
        try {
          setDefaultCampus(JSON.parse(cachedCampus));
        } catch (e) {}
      }

      // 1. Force GPS as default on startup
      setLocationMode("gps");

      // Register Service Worker on Boot
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("/sw.js", { scope: '/' })
          .then((reg) => {
            setSwRegistration(reg);
            console.log("SW Registered successfully:", reg);
          })
          .catch((err) => console.error("SW Registration failed:", err));
      }

      // Check Notifications
      if ("Notification" in window && Notification.permission === "granted") {
        setNotificationsEnabled(true);
      }

      // Check URL hash for Supabase auth errors (e.g. expired confirmation links)
      if (typeof window !== "undefined" && window.location.hash.includes("error_description")) {
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const errDesc = hashParams.get("error_description");
        if (errDesc) {
          setAuthMessage({
            type: "error",
            text: errDesc.replace(/\+/g, " "),
          });
        }
      }
    } catch (e) {
      console.error("Failed to read local storage", e);
    }

    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Safety fallback: ensure loading screen resolves within 1.2s
  useEffect(() => {
    const timer = setTimeout(() => {
      setAuthChecking(false);
    }, 1200);
    return () => clearTimeout(timer);
  }, []);

  // Supabase Auth Session Listener
  useEffect(() => {
    if (!isMounted) return;
    if (!isSupabaseConfigured || !supabase) {
      setAuthChecking(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      const user = session?.user ?? null;
      setAuthUser(user);
      if (user && typeof window !== "undefined") {
        const userCached = localStorage.getItem(`ontime_campus_${user.id}`);
        if (userCached) {
          try { setDefaultCampus(JSON.parse(userCached)); } catch (e) {}
        }
      }
      setAuthChecking(false);
    }).catch(() => {
      setAuthChecking(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUser(session?.user ?? null);
      setAuthChecking(false);
    });

    return () => subscription.unsubscribe();
  }, [isMounted]);

  const loadUserEvents = async () => {
    if (!supabase) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setMasterEvents([]);
        return;
      }
      const { data, error } = await supabase
        .from("events")
        .select("*")
        .eq("user_id", user.id)
        .order("target_time", { ascending: true });

      if (error) {
        console.error("Fetch error:", error);
        alert("Errore caricamento impegni: " + error.message);
        return;
      }
      if (data) {
        let synced: MasterEvent[] = data.map((row: any) => ({
          id: row.id,
          title: row.title,
          category: row.category as EventCategory,
          date: row.date || format(new Date(), "yyyy-MM-dd"),
          targetTime: row.target_time,
          destinationName: row.destination_name || "",
          destinationCoords: Array.isArray(row.destination_coords) 
            ? { lat: row.destination_coords[1] || row.destination_coords[0], lon: row.destination_coords[0] } 
            : row.destination_coords,
          origin_type: row.origin_type || 'live',
          origin_coords: Array.isArray(row.origin_coords) 
            ? { lat: row.origin_coords[1] || row.origin_coords[0], lon: row.origin_coords[0] } 
            : row.origin_coords || null,
          origin_address: row.origin_address || null,
          bufferMinutes: row.buffer_minutes ?? 10,
          checklist: Array.isArray(row.checklist) ? row.checklist : [],
          status: row.status as EventStatus,
          completedAt: row.completed_at || undefined,
          travelTimeMins: row.travel_time_mins ?? undefined,
          transportMode: (row.transport_mode as TransportMode) || "driving",
        }));

        // Fetch user routines
        try {
          const { data: routineData } = await supabase.from("user_routines").select("*").eq("user_id", user.id);
          if (routineData) {
            setUserRoutines(routineData);
          }
        } catch (err) {
          console.error("Routines fetch error", err);
        }

        setMasterEvents(synced);
      }
    } catch (e) {
      console.error("loadUserEvents error:", e);
    }
  };

  // Sync Supabase Events & Settings on login, plus Realtime Subscription
  useEffect(() => {
    if (!isMounted || !authUser || !supabase || !isSupabaseConfigured) return;
    const client = supabase;

    const syncSettings = async () => {
      try {
        // Fetch User Settings & Bookmarks
        const { data: settingsRows, error: settingsError } = await client
          .from("user_settings")
          .select("*")
          .eq("user_id", authUser.id)
          .order("updated_at", { ascending: false, nullsFirst: false })
          .limit(1);

        const settingsData = settingsRows && settingsRows.length > 0 ? settingsRows[0] : null;

        if (!settingsError && settingsData) {
          if (settingsData.home_address && settingsData.home_coords) {
            setHomeLocation({ name: settingsData.home_address, coords: settingsData.home_coords });
          }
          if (settingsData.default_campus_name && settingsData.default_campus_coords) {
            const cap = { name: settingsData.default_campus_name, coords: settingsData.default_campus_coords };
            setDefaultCampus(cap);
            if (typeof window !== "undefined") {
              localStorage.setItem(`ontime_default_campus_${authUser.id}`, JSON.stringify(cap));
              localStorage.setItem(`ontime_campus_${authUser.id}`, JSON.stringify(cap));
              localStorage.setItem("ontime_campus_cached", JSON.stringify(cap));
            }
          }
          if (settingsData.default_buffer) setDefaultSafetyBuffer(settingsData.default_buffer);
          if (settingsData.default_transport) setDefaultTransportMode(settingsData.default_transport);
        }

        // Auto-heal fallback: if DB setting doesn't have campus yet, check auth metadata or localStorage
        if (!settingsData?.default_campus_name) {
          let capToUse: CampusLocation | null = null;
          if (authUser?.user_metadata?.default_campus) {
            capToUse = authUser.user_metadata.default_campus;
          }
          if (!capToUse && typeof window !== "undefined") {
            const cached = localStorage.getItem(`ontime_campus_${authUser.id}`) ||
                           localStorage.getItem(`ontime_default_campus_${authUser.id}`) ||
                           localStorage.getItem("ontime_campus_cached") ||
                           localStorage.getItem("ontime_default_campus_global");
            if (cached) {
              try { capToUse = JSON.parse(cached); } catch (e) {}
            }
          }

          if (capToUse?.name && capToUse?.coords) {
            setDefaultCampus(capToUse);
            if (typeof window !== "undefined") {
              localStorage.setItem(`ontime_default_campus_${authUser.id}`, JSON.stringify(capToUse));
              localStorage.setItem(`ontime_campus_${authUser.id}`, JSON.stringify(capToUse));
              localStorage.setItem("ontime_campus_cached", JSON.stringify(capToUse));
            }
            client.from("user_settings").upsert({
              user_id: authUser.id,
              default_campus_name: capToUse.name,
              default_campus_coords: capToUse.coords,
              updated_at: new Date().toISOString()
            }, { onConflict: "user_id" }).then();
          }
        }

        // Fetch User Bookmarks
        const { data: bookmarksData, error: bookmarksError } = await client
          .from("user_bookmarks")
          .select("*")
          .eq("user_id", authUser.id);
          
        if (!bookmarksError && bookmarksData) {
          const loadedBookmarks = bookmarksData.map(b => ({
            id: b.id,
            name: b.label,
            icon: "📍",
            address: b.address,
            coords: b.coords
          }));
          setSavedPlaces(loadedBookmarks);
        }
      } catch (err) {
        console.error("Supabase sync settings error:", err);
      }
    };

    loadUserEvents();
    syncSettings();

    // Supabase Real-Time Subscription
    const channel = client
      .channel(`user-events-${authUser.id}`)
      .on(
        "postgres_changes", 
        { event: "*", schema: "public", table: "events", filter: `user_id=eq.${authUser.id}` }, 
        () => {
          loadUserEvents(); // Re-fetches immediately when changed on PC or phone
        }
      )
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
  }, [authUser, isMounted]);

  // Manage Departure Notification, SW PostMessage & Chime in Ticker
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

        if (vibrationEnabled && typeof navigator !== "undefined" && "vibrate" in navigator) {
          navigator.vibrate([300, 150, 300]);
        }

        const title = `🚗 È ora di uscire! - ${ev.title}`;
        const body = `Tragitto stimato: ${travelMins} min verso ${ev.destinationName}.`;

        const swController = swRegistration?.active || (typeof navigator !== "undefined" && navigator.serviceWorker?.controller);
        if (swController) {
          swController.postMessage({
            type: "NOTIFY_DEPARTURE",
            title,
            body,
            icon: "/logo.png",
          });
        } else if ("Notification" in window && Notification.permission === "granted") {
          new Notification(title, {
            body,
            icon: "/logo.png",
            badge: "/logo.png",
            vibrate: vibrationEnabled ? [200, 100, 200, 100, 200] : undefined,
          } as any);
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
      if (homeLocation) {
        setCurrentLoc(homeLocation.coords);
        setCurrentCity(homeLocation.name);
      } else {
        setCurrentCity("Nessuna Base Salvata");
      }
      setIsLocating(false);
      return;
    }

    if (locationMode === "gps") {
      setIsLocating(true);

      const fallbackToIP = async () => {
        try {
          const res = await fetch('https://ipapi.co/json/');
          const data = await res.json();
          if (data.latitude && data.longitude) {
            setCurrentLoc({ lat: data.latitude, lon: data.longitude });
            setCurrentCity(data.city || "Posizione IP");
          } else {
            setCurrentCity("Posizione Sconosciuta");
          }
        } catch (e) {
          console.error("IP Fallback failed", e);
          setCurrentCity("Posizione Sconosciuta");
        }
        setIsLocating(false);
      };

      if (!("geolocation" in navigator)) {
        alert("La geolocalizzazione GPS non è supportata da questo browser.");
        fallbackToIP();
        return;
      }

      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const acc = pos.coords.accuracy;
          if (acc > 5000) {
            console.warn(`GPS accuracy radius high (${acc}m). Falling back to IP.`);
            fallbackToIP();
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
          console.warn("GPS request failed. Falling back to IP:", err);
          fallbackToIP();
        },
        { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 }
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
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 8000 }
      );

      return () => {
        if (watchIdRef.current !== null) {
          navigator.geolocation.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
        }
      };
    }
  }, [locationMode, homeLocation, isMounted]);

  // LocalStorage caching is removed in favor of Supabase as single source of truth

  // REACTIVE ROUTE RECALCULATION when currentLoc or masterEvents change
  // Only recalculates events where origin_coords is null (= "live GPS" mode)
  useEffect(() => {
    if (!currentLoc || masterEvents.length === 0 || !isMounted) return;

    const recalculateRoutes = async () => {
      let updated = false;
      const newEvents = await Promise.all(
        masterEvents.map(async (ev) => {
          if (ev.status !== "active" || !ev.destinationCoords?.lat || !ev.destinationCoords?.lon) return ev;
          
          // If the event has a fixed origin (e.g. "Casa"), don't override with current GPS
          if ((ev as any).originCoords) return ev;
          
          try {
            const newMins = await fetchOsrmRouteMins(currentLoc, ev.destinationCoords, ev.transportMode || "driving", mapboxToken);
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
  }, [currentLoc, mapboxToken]);

  // Helper to project routines strictly matching day_of_week for any given dateStr (yyyy-MM-dd)
  const getEffectiveEventsForDate = (dateStr: string): MasterEvent[] => {
    const explicitEvents = masterEvents.filter((e) => e.date === dateStr);

    // Calculate day_of_week: 0 = Dom, 1 = Lun, 2 = Mar, 3 = Mer, 4 = Gio, 5 = Ven, 6 = Sab
    const [yr, mo, dy] = dateStr.split("-").map(Number);
    const dateObj = new Date(yr, mo - 1, dy);
    const dayOfWeek = dateObj.getDay();

    const matchingRoutines = userRoutines.filter((r) => Number(r.day_of_week) === dayOfWeek);

    const projectedRoutines: MasterEvent[] = matchingRoutines
      .filter((routine) => {
        const routineId = `routine_${routine.id}_${dateStr}`;
        return !explicitEvents.some(
          (e) => e.id === routineId || e.title.toLowerCase() === routine.title.toLowerCase()
        );
      })
      .map((routine) => ({
        id: `routine_${routine.id}_${dateStr}`,
        title: routine.title,
        category: "Lavoro" as EventCategory,
        date: dateStr,
        targetTime: routine.start_time || "09:00",
        destinationName: routine.location_name || routine.aula || (defaultCampus ? defaultCampus.name : "Università / Scuola"),
        destinationCoords: routine.location_coords?.lat ? routine.location_coords : (defaultCampus ? defaultCampus.coords : { lat: 0, lon: 0 }),
        origin_type: "live" as const,
        origin_coords: null,
        origin_address: null,
        bufferMinutes: 10,
        checklist: Array.isArray(routine.checklist) ? routine.checklist : [],
        status: "active" as EventStatus,
        transportMode: "driving" as TransportMode
      }));

    return [...explicitEvents, ...projectedRoutines];
  };

  // Filter Active vs Completed
  const completedEvents = masterEvents.filter((e) => e.status === "completed");

  // Date Filtering
  const todayStr = format(now, "yyyy-MM-dd");
  const tomorrowStr = format(addDays(now, 1), "yyyy-MM-dd");

  const filteredActiveEvents = (() => {
    if (dateTab === "oggi") {
      return getEffectiveEventsForDate(todayStr).filter((e) => e.status === "active");
    }
    if (dateTab === "domani") {
      return getEffectiveEventsForDate(tomorrowStr).filter((e) => e.status === "active");
    }
    // "tutti": combine active masterEvents + projected routines for today and tomorrow
    const todayEff = getEffectiveEventsForDate(todayStr).filter((e) => e.status === "active");
    const tomorrowEff = getEffectiveEventsForDate(tomorrowStr).filter((e) => e.status === "active");
    const existingIds = new Set([...todayEff, ...tomorrowEff].map(e => e.id));
    const otherActive = masterEvents.filter((e) => e.status === "active" && !existingIds.has(e.id));
    return [...todayEff, ...tomorrowEff, ...otherActive];
  })();

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

  // Autocomplete effect for Setting Campus Location
  useEffect(() => {
    if (campusSearchQuery.trim().length < 2) {
      setCampusSuggestions([]);
      return;
    }

    setIsSearchingCampus(true);
    const timeoutId = setTimeout(async () => {
      const results = await fetchSuggestions(campusSearchQuery);
      setCampusSuggestions(results);
      setIsSearchingCampus(false);
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [campusSearchQuery]);

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

  const syncUserSetting = async (updates: any) => {
    if (authUser && supabase && isSupabaseConfigured) {
      try {
        await supabase.from("user_settings").upsert(
          { user_id: authUser.id, ...updates, updated_at: new Date().toISOString() },
          { onConflict: "user_id" }
        );
      } catch (e) { console.error("Sync settings error", e); }
    }
  };

  const saveCampusSetting = async (newCap: CampusLocation) => {
    setDefaultCampus(newCap);
    
    if (typeof window !== "undefined") {
      localStorage.setItem("ontime_default_campus_global", JSON.stringify(newCap));
      localStorage.setItem("ontime_campus_cached", JSON.stringify(newCap));
      if (authUser?.id) {
        localStorage.setItem(`ontime_default_campus_${authUser.id}`, JSON.stringify(newCap));
        localStorage.setItem(`ontime_campus_${authUser.id}`, JSON.stringify(newCap));
      }
    }

    if (authUser && supabase && isSupabaseConfigured) {
      try {
        const { error } = await supabase.auth.updateUser({
          data: { default_campus: newCap }
        });
        if (error) {
          console.error("Error saving campus metadata:", error);
        }
        syncUserSetting({
          default_campus_name: newCap.name,
          default_campus_coords: newCap.coords,
        });
      } catch (err) {
        console.error("Save campus error:", err);
      }
    }
  };

  const handleManualSaveCampus = async () => {
    const query = campusSearchQuery.trim();
    if (!query) return;
    setIsSearchingCampus(true);
    let coords = { lat: 39.36, lon: 16.22 };
    try {
      const geoResults = await fetchSuggestions(query);
      if (geoResults.length > 0) {
        coords = { lat: geoResults[0].lat, lon: geoResults[0].lon };
        await saveCampusSetting({ name: geoResults[0].name, coords });
      } else if (currentLoc) {
        coords = currentLoc;
        await saveCampusSetting({ name: query, coords });
      } else {
        await saveCampusSetting({ name: query, coords });
      }
    } catch (e) {
      await saveCampusSetting({ name: query, coords });
    }
    setIsSearchingCampus(false);
    setIsEditingCampus(false);
    setCampusSearchQuery("");
    setCampusSuggestions([]);
  };

  const removeCampusSetting = async () => {
    setDefaultCampus(null);
    if (typeof window !== "undefined") {
      if (authUser?.id) {
        localStorage.removeItem(`ontime_default_campus_${authUser.id}`);
        localStorage.removeItem(`ontime_campus_${authUser.id}`);
      }
      localStorage.removeItem("ontime_campus_cached");
    }
    if (authUser && supabase && isSupabaseConfigured) {
      try {
        await supabase.auth.updateUser({
          data: { default_campus: null }
        });
        syncUserSetting({
          default_campus_name: null,
          default_campus_coords: null,
        });
      } catch (err) {
        console.error("Remove campus error:", err);
      }
    }
  };

  const saveNewHomeBase = (newBase: BaseLocation) => {
    setHomeLocation(newBase);
    syncUserSetting({ home_address: newBase.name, home_coords: newBase.coords });
    switchToHomeMode(newBase);
    setIsEditingBase(false);
    setBaseSearchQuery("");
    setBaseSuggestions([]);
    setIsLocationModalOpen(false);
  };

  // Toggle Notifications with iOS Standalone Detection & SW PostMessage
  const toggleNotifications = async () => {
    if (typeof window === "undefined") return;

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;

    // If on iOS and NOT installed to Home Screen as PWA, show Apple Install Guide modal
    if (isIOS && !isStandalone) {
      setIsIosInstallModalOpen(true);
      return;
    }

    if (!("Notification" in window)) {
      return alert("Le notifiche non sono supportate da questo browser.");
    }

    try {
      let reg = swRegistration;
      if (!reg && "serviceWorker" in navigator) {
        reg = await navigator.serviceWorker.register("/sw.js");
        setSwRegistration(reg);
      }

      const perm = await Notification.requestPermission();
      if (perm === "granted") {
        setNotificationsEnabled(true);
        playDepartureChime();

        if (vibrationEnabled && "vibrate" in navigator) {
          navigator.vibrate([200, 100, 200]);
        }

        const swController = reg?.active || navigator.serviceWorker?.controller;
        if (swController) {
          swController.postMessage({
            type: "NOTIFY_DEPARTURE",
            title: "🔔 OnTime Attivo",
            body: "Le notifiche di partenza su blocco schermo sono pronte!",
            icon: "/logo.png",
          });
        } else if (reg && "showNotification" in reg) {
          reg.showNotification("🔔 OnTime Attivo", {
            body: "Le notifiche di partenza su blocco schermo sono pronte!",
            icon: "/logo.png",
            badge: "/logo.png",
          });
        } else {
          new Notification("🔔 OnTime Attivo", {
            body: "Le notifiche di partenza su blocco schermo sono pronte!",
            icon: "/logo.png",
          });
        }
      } else {
        setNotificationsEnabled(false);
        alert("Permesso notifiche negato.");
      }
    } catch (err) {
      console.error("Error setting up notifications:", err);
      alert("Impossibile attivare le notifiche.");
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
      id: "place_" + Date.now(),
      name: newBookmarkName.trim(),
      icon: newBookmarkIcon || "📍",
      address: addr,
      coords,
    };

    const updated = [...savedPlaces, newPlace];
    setSavedPlaces(updated);
    if (authUser && supabase) {
      supabase.from("user_bookmarks").insert([{
        id: newPlace.id,
        user_id: authUser.id,
        label: newPlace.name,
        address: newPlace.address,
        coords: newPlace.coords
      }]).then(({ error }) => {
        if (error) console.error("Error saving bookmark", error);
      });
    }

    setNewBookmarkName("");
    setNewBookmarkIcon("📍");
    setNewBookmarkAddressQuery("");
    setSelectedBookmarkCoords(null);
    setIsBookmarkModalOpen(false);
  };

  const deleteBookmark = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (window.confirm("Eliminare questo segnaposto dai preferiti?")) {
      const updated = savedPlaces.filter((p) => p.id !== id);
      setSavedPlaces(updated);
      if (authUser && supabase) {
        supabase.from("user_bookmarks").delete().eq("id", id).eq("user_id", authUser.id).then();
      }
      if (selectedBookmarkId === id) setSelectedBookmarkId(null);
    }
  };

  // One-Tap Save Selected Destination to Bookmarks / Segnaposti
  const oneTapSaveDestination = () => {
    if (!selectedDest) return;
    const newPlace: SavedPlace = {
      id: crypto.randomUUID(),
      name: selectedDest.name.split(",")[0], // Just the main name
      icon: "📍",
      address: selectedDest.name,
      coords: { lat: selectedDest.lat, lon: selectedDest.lon },
    };
    const updated = [...savedPlaces, newPlace];
    setSavedPlaces(updated);
    if (authUser && supabase) {
      supabase.from("user_bookmarks").insert([{
        id: newPlace.id,
        user_id: authUser.id,
        label: newPlace.name,
        address: newPlace.address,
        coords: newPlace.coords
      }]).then();
    }
    setSelectedBookmarkId(newPlace.id);
    setBookmarkSavedFeedback(true);
    setTimeout(() => setBookmarkSavedFeedback(false), 2500);
  };

  // --- IOS PWA FIX: Safe Resume on App Switch ---
  useEffect(() => {
    const handleResume = (event: any) => {
      if (event.persisted || document.visibilityState === 'visible') {
        window.dispatchEvent(new Event('resize'));
      }
    };
    window.addEventListener('pageshow', handleResume);
    document.addEventListener('visibilitychange', handleResume);
    return () => {
      window.removeEventListener('pageshow', handleResume);
      document.removeEventListener('visibilitychange', handleResume);
    };
  }, []);

  // --- IOS PWA FIX: Draft Auto-Save ---
  useEffect(() => {
    if (!isMounted || editingEventId !== null || !isFabOpen) return;
    const draft = {
      title: newEventTitle,
      date: newEventDate,
      time: newEventTime,
      category: newEventCategory,
      buffer: newEventBuffer,
      transport: newEventTransportMode,
      checklist: newEventChecklist,
      addressQuery,
      selectedDest,
      originType,
      originBookmarkId,
      originCustomCoords,
      originCustomAddress,
      originCustomQuery
    };
    sessionStorage.setItem("ontime_event_draft", JSON.stringify(draft));
  }, [
    isMounted, isFabOpen, editingEventId, newEventTitle, newEventDate, newEventTime,
    newEventCategory, newEventBuffer, newEventTransportMode, newEventChecklist,
    addressQuery, selectedDest, originType, originBookmarkId, originCustomCoords,
    originCustomAddress, originCustomQuery
  ]);

  const resetNewEventForm = (dateFallback?: string) => {
    setNewEventTitle("");
    setAddressQuery("");
    setSelectedDest(null);
    setSelectedBookmarkId(null);
    setNewEventTime("");
    setNewEventDate(dateFallback || format(new Date(), "yyyy-MM-dd"));
    setNewEventCategory("Personale");
    setNewEventBuffer(defaultSafetyBuffer);
    setNewEventTransportMode(defaultTransportMode);
    setNewEventChecklist([]);
    setOriginType("live");
    setOriginBookmarkId(null);
    setOriginCustomCoords(null);
    setOriginCustomAddress(null);
    setOriginCustomQuery("");
  };

  const openNewEventModal = (dateFallback?: string) => {
    setEditingEventId(null);
    const savedDraft = sessionStorage.getItem("ontime_event_draft");
    if (savedDraft) {
      try {
        const draft = JSON.parse(savedDraft);
        setNewEventTitle(draft.title || "");
        setAddressQuery(draft.addressQuery || "");
        setSelectedDest(draft.selectedDest || null);
        setSelectedBookmarkId(null);
        setNewEventTime(draft.time || "");
        setNewEventDate(draft.date || dateFallback || format(new Date(), "yyyy-MM-dd"));
        setNewEventCategory(draft.category || "Personale");
        setNewEventBuffer(draft.buffer || defaultSafetyBuffer);
        setNewEventTransportMode(draft.transport || defaultTransportMode);
        setNewEventChecklist(draft.checklist || []);
        setOriginType(draft.originType || "live");
        setOriginBookmarkId(draft.originBookmarkId || null);
        setOriginCustomCoords(draft.originCustomCoords || null);
        setOriginCustomAddress(draft.originCustomAddress || null);
        setOriginCustomQuery(draft.originCustomQuery || "");
      } catch (e) {
        resetNewEventForm(dateFallback);
      }
    } else {
      resetNewEventForm(dateFallback);
    }
    setIsFabOpen(true);
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
    setOriginBookmarkId(null); // reset to live GPS on edit
    setIsFabOpen(true);
  };

  // Actions with Supabase Cloud Sync
  const deleteEvent = async (id: string) => {
    if (window.confirm("Sei sicuro di voler eliminare definitivamente questo evento?")) {
      setMasterEvents((prev) => prev.filter((e) => e.id !== id));
      if (authUser && supabase && isSupabaseConfigured) {
        try {
          await supabase.from("events").delete().eq("id", id).eq("user_id", authUser.id);
        } catch (e) {
          console.warn("Supabase delete error:", e);
        }
      }
    }
  };

  const completeEvent = async (id: string) => {
    const completedAt = new Date().toISOString();
    let target = masterEvents.find((e) => e.id === id);

    if (!target) {
      const allProjected = [
        ...getEffectiveEventsForDate(todayStr),
        ...getEffectiveEventsForDate(tomorrowStr),
        ...getEffectiveEventsForDate(selectedCalendarDate),
      ];
      target = allProjected.find((e) => e.id === id);
    }

    if (target) {
      const updatedEv = { ...target, status: "completed" as EventStatus, completedAt };
      setMasterEvents((prev) => [...prev.filter((e) => e.id !== id), updatedEv]);

      if (authUser && supabase && isSupabaseConfigured) {
        try {
          await supabase.from("events").upsert(
            [{
              id: updatedEv.id,
              user_id: authUser.id,
              title: updatedEv.title,
              category: updatedEv.category,
              date: updatedEv.date,
              target_time: updatedEv.targetTime,
              destination_name: updatedEv.destinationName,
              destination_coords: updatedEv.destinationCoords,
              origin_type: updatedEv.origin_type || "live",
              origin_coords: updatedEv.origin_coords || null,
              origin_address: updatedEv.origin_address || null,
              buffer_minutes: updatedEv.bufferMinutes,
              checklist: updatedEv.checklist,
              status: "completed",
              completed_at: completedAt,
              transport_mode: updatedEv.transportMode || "driving",
            }],
            { onConflict: "id" }
          );
        } catch (e) {
          console.warn("Supabase complete error:", e);
        }
      }
    }
  };

  const restoreEvent = async (id: string) => {
    setMasterEvents((prev) =>
      prev.map((e) => (e.id === id ? { ...e, status: "active", completedAt: undefined } : e))
    );
    if (authUser && supabase && isSupabaseConfigured) {
      try {
        await supabase
          .from("events")
          .update({ status: "active", completed_at: null })
          .eq("id", id)
          .eq("user_id", authUser.id);
      } catch (e) {
        console.warn("Supabase restore error:", e);
      }
    }
  };

  // Quick Mode Change on Active Card with Instant Recalculation
  const handleQuickModeChange = async (eventId: string, newMode: TransportMode) => {
    const target = masterEvents.find((e) => e.id === eventId);
    if (!target || !currentLoc || !target.destinationCoords) return;

    const newTravelMins = await fetchOsrmRouteMins(
      currentLoc,
      target.destinationCoords,
      newMode,
      mapboxToken
    );

    setMasterEvents((prev) =>
      prev.map((e) =>
        e.id === eventId
          ? { ...e, transportMode: newMode, travelTimeMins: newTravelMins }
          : e
      )
    );

    if (authUser && supabase && isSupabaseConfigured) {
      try {
        await supabase
          .from("events")
          .update({ transport_mode: newMode, travel_time_mins: newTravelMins })
          .eq("id", eventId)
          .eq("user_id", authUser.id);
      } catch (err) {
        console.warn("Supabase mode update error:", err);
      }
    }
  };

  // Lock-screen Notification 5-second Tester via Service Worker
  const triggerLockScreenTest = async () => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      alert("Il tuo browser non supporta i Service Worker per le notifiche in background.");
      return;
    }

    let perm = Notification.permission;
    if (perm !== "granted") {
      perm = await Notification.requestPermission();
      if (perm !== "granted") {
        alert("Permesso per le notifiche negato!");
        return;
      }
      setNotificationsEnabled(true);
    }

    try {
      const reg = await navigator.serviceWorker.ready;
      
      // 1. Instant test notification
      reg.showNotification("🚗 OnTime: Test Ricezione", {
        body: "Se vedi questo messaggio, le notifiche di sistema sono attive!",
        icon: "/logo.png",
        badge: "/logo.png",
        vibrate: [300, 100, 300],
        tag: "ontime-test-instant",
        requireInteraction: true
      } as any);

      // 2. Schedule background test
      if (reg.active) {
        reg.active.postMessage({
          type: 'SCHEDULE_LOCKSCREEN_TEST',
          delay: 5000,
          title: "🚗 OnTime: È ora di uscire!",
          body: "Test blocco schermo riuscito! L'allarme funziona a schermo spento."
        });
        
        // Show visual feedback (we use an alert or a custom toast state here, alert is easier but less pretty, let's use a temporary state if it existed or just alert/toast)
        alert("Notifica inviata. Se premi il tasto di blocco, la seconda notifica arriverà tra 5 secondi!");
      }
    } catch (err) {
      console.error("Lock screen test error:", err);
      alert("Errore nell'avvio del test di notifica.");
    }
  };

  // Supabase Auth Submit (Login / Register)
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !isSupabaseConfigured) {
      setAuthMessage({ type: "error", text: "Supabase non è configurato con le variabili d'ambiente." });
      return;
    }
    if (!authEmail.trim() || !authPassword.trim()) {
      setAuthMessage({ type: "error", text: "Compila email e password." });
      return;
    }

    setAuthLoading(true);
    setAuthMessage(null);

    try {
      if (authMode === "login") {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: authEmail.trim(),
          password: authPassword,
        });
        if (error) throw error;
        setAuthUser(data.user);
        setIsAuthModalOpen(false);
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: authEmail.trim(),
          password: authPassword,
          options: {
            emailRedirectTo: typeof window !== "undefined" ? `${window.location.origin}` : undefined,
          },
        });
        if (error) throw error;
        if (data.session?.user) {
          setAuthUser(data.session.user);
          setIsAuthModalOpen(false);
        } else {
          setAuthMessage({
            type: "success",
            text: "Account registrato! Controlla la tua email di conferma o effettua il login.",
          });
        }
      }
    } catch (err: any) {
      setAuthMessage({ type: "error", text: err.message || "Errore di autenticazione" });
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    if (supabase && isSupabaseConfigured) {
      await supabase.auth.signOut();
    }
    setAuthUser(null);
    setIsGuestMode(false);
    setMasterEvents([]);
    setSavedPlaces([]);
    setHomeLocation(null);
    setDefaultSafetyBuffer(10);
    setDefaultTransportMode("driving");
    setLocationMode("gps");
    
    if (typeof window !== "undefined") {
      localStorage.removeItem("ontime_master_events");
      localStorage.removeItem("ontime_home_location");
      localStorage.removeItem("ontime_saved_places");
      localStorage.removeItem("ontime_bookmarks");
      localStorage.removeItem("ontime_default_buffer");
      localStorage.removeItem("ontime_default_transport");
      localStorage.removeItem("ontime_location_mode");
    }
    setIsAuthModalOpen(false);
    setIsProfileMenuOpen(false);
  };

  const handleSaveEvent = async () => {
    if (!authUser || !supabase) {
      alert("Effettua il login per salvare e sincronizzare i tuoi impegni.");
      return;
    }

    if (!newEventTitle.trim() || !newEventTime || !newEventDate) {
      return alert("Compila titolo, data e orario!");
    }

    setIsSaving(true);

    let destCoords = selectedDest ? { lat: selectedDest.lat, lon: selectedDest.lon } : null;
    let destName = selectedDest ? selectedDest.name : addressQuery.trim();

    // Auto-Geocode typed address or POI venue if no dropdown item was explicitly clicked
    if (!destCoords && destName.length > 0) {
      const geoResults = await fetchSuggestions(destName);
      if (geoResults.length > 0) {
        destCoords = { lat: geoResults[0].lat, lon: geoResults[0].lon };
        destName = geoResults[0].name; // Clean place name
      } else if (currentLoc) {
        destCoords = { lat: currentLoc.lat, lon: currentLoc.lon };
      } else {
        setIsSaving(false);
        return alert("Indirizzo non trovato.");
      }
    }

    if (!destCoords) {
      if (currentLoc) {
        destCoords = currentLoc;
      } else {
        return alert("Devi fornire una posizione GPS attiva o inserire un indirizzo valido.");
      }
    }

    // Determine origin: live, bookmark, or custom
    let originCoordsForDB: {lat: number, lon: number} | null = null;
    let originAddrForDB: string | null = null;
    let originCoordsToUse = currentLoc;

    if (originType === "bookmark" && originBookmarkId) {
      const bkm = savedPlaces.find(p => p.id === originBookmarkId);
      if (bkm) {
        originCoordsForDB = bkm.coords;
        originCoordsToUse = bkm.coords;
      }
    } else if (originType === "custom" && originCustomCoords) {
      originCoordsForDB = originCustomCoords;
      originAddrForDB = originCustomAddress;
      originCoordsToUse = originCustomCoords;
    }

    // Auto-calculate travel time from origin if fixed, otherwise leave null to force recalculation on device
    let finalTravelTime: number | null = null;
    if (originType !== "live" && originCoordsToUse && destCoords) {
      finalTravelTime = await fetchOsrmRouteMins(
        originCoordsToUse,
        destCoords,
        newEventTransportMode,
        mapboxToken
      );
    }

    if (editingEventId) {
      const updatedEventData: Partial<MasterEvent> = {
        title: newEventTitle.trim(),
        category: newEventCategory,
        date: newEventDate,
        targetTime: newEventTime,
        destinationName: destName,
        destinationCoords: destCoords,
        origin_type: originType,
        origin_coords: originCoordsForDB,
        origin_address: originAddrForDB,
        bufferMinutes: newEventBuffer,
        checklist: newEventChecklist,
        transportMode: newEventTransportMode,
        travelTimeMins: finalTravelTime !== null ? finalTravelTime : undefined,
      };

      // 1. Optimistic UI update
      setMasterEvents((prev) =>
        prev.map((e) =>
          e.id === editingEventId
            ? { ...e, ...updatedEventData, travelTimeMins: finalTravelTime !== null ? finalTravelTime : e.travelTimeMins }
            : e
        )
      );

      if (authUser && supabase) {
        try {
          const { error } = await supabase
            .from("events")
            .update({
              title: updatedEventData.title,
              category: updatedEventData.category,
              date: updatedEventData.date,
              target_time: updatedEventData.targetTime,
              destination_name: updatedEventData.destinationName,
              destination_coords: updatedEventData.destinationCoords,
              origin_type: originType,
              origin_coords: originCoordsForDB,
              origin_address: originAddrForDB,
              buffer_minutes: updatedEventData.bufferMinutes,
              checklist: updatedEventData.checklist,
              transport_mode: updatedEventData.transportMode,
              travel_time_mins: updatedEventData.travelTimeMins,
            })
            .eq("id", editingEventId)
            .eq("user_id", authUser.id)
            .select();
            
          if (error) {
            console.error("Supabase update error:", error);
            alert("Errore salvataggio cloud: " + error.message);
          }
        } catch (e: any) {
          console.error("Supabase update error:", e);
          alert("Errore salvataggio cloud: " + e.message);
        }
      }
    } else {
      const newEvData = {
        title: newEventTitle.trim(),
        category: newEventCategory,
        date: newEventDate,
        targetTime: newEventTime,
        destinationName: destName,
        destinationCoords: destCoords,
        origin_type: originType,
        origin_coords: originCoordsForDB,
        origin_address: originAddrForDB,
        bufferMinutes: newEventBuffer,
        checklist: newEventChecklist,
        status: "active" as EventStatus,
        travelTimeMins: finalTravelTime !== null ? finalTravelTime : undefined,
        transportMode: newEventTransportMode,
      };

      const newId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString();
      const newEv: MasterEvent = { id: newId, ...newEvData };

      // 1. Optimistic UI update
      setMasterEvents((prev) => [...prev, newEv]);

      if (authUser && supabase) {
        try {
          const { error } = await supabase.from("events").insert([{
            id: newId,
            user_id: authUser.id,
            title: newEvData.title,
            category: newEvData.category,
            date: newEvData.date,
            target_time: newEvData.targetTime,
            destination_name: newEvData.destinationName,
            destination_coords: newEvData.destinationCoords,
            origin_type: newEvData.origin_type,
            origin_coords: newEvData.origin_coords,
            origin_address: newEvData.origin_address,
            buffer_minutes: newEvData.bufferMinutes,
            checklist: newEvData.checklist,
            status: newEvData.status,
            travel_time_mins: newEvData.travelTimeMins,
            transport_mode: newEvData.transportMode,
          }]).select();
          if (error) {
             console.error("Supabase insert error:", error);
             alert("Errore salvataggio cloud: " + error.message);
          }
        } catch (e: any) {
          console.error("Supabase insert error:", e);
          alert("Errore salvataggio cloud: " + e.message);
        }
      }
    }

    // 3. Auto-select date tab based on the new event's date
    const todayStr = format(now, "yyyy-MM-dd");
    const tomorrowStr = format(addDays(now, 1), "yyyy-MM-dd");
    
    if (newEventDate === todayStr) {
      setDateTab("oggi");
    } else if (newEventDate === tomorrowStr) {
      setDateTab("domani");
    } else {
      setDateTab("tutti");
    }

    resetNewEventForm();
    sessionStorage.removeItem("ontime_event_draft");
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
      setSavedPlaces([]);
      setHomeLocation(null);
      setLocationMode("gps");
      setCurrentLoc(null);
      setCurrentCity("Rilevamento in corso...");
      setIsSettingsOpen(false);
      alert("Tutti i dati dell'applicazione sono stati cancellati.");
    }
  };

  const renderBadgeInfo = (ev: MasterEvent) => {
    const isLive = ev.origin_type === 'live' || !ev.origin_coords;
    const isCalculating = isLive && ev.travelTimeMins === undefined;

    const startDateTime = getEventDateTime(ev);
    const travelMins = ev.travelTimeMins || 10;
    const departureTime = addMinutes(startDateTime, -(travelMins + ev.bufferMinutes));
    const minsToDeparture = differenceInMinutes(departureTime, now);

    let style = "bg-slate-50 text-slate-700 border-slate-200"; // default >30 min
    let text = isCalculating ? "Calcolo percorso..." : `Esci tra ${minsToDeparture} min`;
    let barColor = isCalculating ? "bg-slate-200" : "bg-slate-300";

    const isLate = now > departureTime;

    if (!isCalculating) {
      if (isLate || minsToDeparture <= 0) {
        const lateMins = differenceInMinutes(now, departureTime);
        style = "bg-red-50 text-red-700 border-red-200 animate-pulse";
        text = isLate ? `SEI IN RITARDO DI ${lateMins} MIN` : "Parti subito!";
        barColor = "bg-red-500 animate-pulse";
      } else if (minsToDeparture <= 10) {
        style = "bg-orange-50 text-orange-700 border-orange-200";
        barColor = "bg-orange-500";
      } else if (minsToDeparture <= 30) {
        style = "bg-amber-50 text-amber-700 border-amber-200";
        barColor = "bg-amber-400";
      } else {
        style = "bg-blue-50 text-blue-700 border-blue-200";
        barColor = "bg-blue-400";
      }
    } else {
      // Styling for calculating mode
      style = "bg-slate-200 text-slate-500 animate-pulse border-transparent";
    }

    const windowMins = 60;
    let progress = 0;
    if (isCalculating) {
      progress = 0;
    } else if (isLate) {
      progress = 100;
    } else if (minsToDeparture < windowMins) {
      progress = ((windowMins - minsToDeparture) / windowMins) * 100;
    }

    return { style, text, departureTime, barColor, progress, isLate, isCalculating };
  };

  const delayEvent15m = async (event: MasterEvent) => {
    try {
      const [hours, minutes] = event.targetTime.split(':').map(Number);
      const dateObj = new Date();
      dateObj.setHours(hours, minutes, 0, 0);
      const newDateObj = addMinutes(dateObj, 15);
      const newTime = format(newDateObj, 'HH:mm');
      
      setMasterEvents(prev => prev.map(e => e.id === event.id ? { ...e, targetTime: newTime } : e));
      
      if (supabase) {
        await supabase.from('events').update({ target_time: newTime }).eq('id', event.id);
      }
    } catch (e) {
      console.error("Failed to delay event", e);
    }
  };

  const renderCardActionButtons = (event: MasterEvent) => (
    <div className="flex items-center gap-1.5 shrink-0 ml-2">
      <button
        onClick={() => delayEvent15m(event)}
        className="w-8 h-8 rounded-[10px] flex items-center justify-center bg-gray-50 hover:bg-indigo-50 text-gray-500 hover:text-indigo-600 transition-colors border border-slate-200 shadow-sm font-bold text-[10px]"
        title="Posticipa di 15 min"
      >
        +15m
      </button>
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

  // Loading Gate (Active Session Checking)
  if (!isMounted || authChecking) {
    return (
      <main className="flex flex-col min-h-screen bg-[#F5F5F7] items-center justify-center p-6 font-sans">
        <div className="flex flex-col items-center max-w-sm text-center">
          <div className="relative w-20 h-20 rounded-3xl overflow-hidden shadow-xl mb-5 ring-4 ring-white/60 animate-pulse">
            <Image src="/logo.png" alt="OnTime" fill className="object-cover" priority />
          </div>
          <div className="flex items-center gap-2 mb-2">
            <Navigation2 className="w-5 h-5 text-blue-600 fill-blue-600 animate-spin" />
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">OnTime</h1>
          </div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Caricamento account...</p>
        </div>
      </main>
    );
  }

  // Apple Authentication Gate (Locked App until user signs in/up or chooses local mode)
  if (!authUser && !isGuestMode) {
    return (
      <main className="flex flex-col min-h-screen bg-[#F5F5F7] items-center justify-center p-6 relative overflow-hidden font-sans">
        {/* Ambient Glow Orbs */}
        <div className="absolute -top-32 -left-32 w-96 h-96 bg-blue-200/40 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-indigo-200/30 rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-sm w-full bg-white/80 backdrop-blur-xl border border-white/60 shadow-[0_20px_50px_rgba(0,0,0,0.06)] rounded-[32px] p-7 sm:p-8 flex flex-col relative z-10 animate-in fade-in zoom-in-95 duration-300">
          {/* Logo & Header */}
          <div className="flex flex-col items-center text-center mb-6">
            <div className="relative w-16 h-16 rounded-[22px] overflow-hidden shadow-lg mb-3 ring-4 ring-white/80">
              <Image src="/logo.png" alt="OnTime Logo" fill className="object-cover" priority />
            </div>
            <div className="flex items-center gap-1.5 mb-1">
              <Navigation2 className="w-4 h-4 text-blue-600 fill-blue-600" />
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">OnTime</h1>
            </div>
            <p className="text-xs font-medium text-slate-500">
              Organizza la tua giornata senza ansia.
            </p>
          </div>

          {/* Segmented Control [Accedi] [Crea Account] */}
          <div className="flex bg-slate-100/90 p-1 rounded-2xl mb-5 border border-slate-200/50">
            <button
              type="button"
              onClick={() => {
                setAuthMode("login");
                setAuthMessage(null);
              }}
              className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all duration-200 ${
                authMode === "login"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Accedi
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode("signup");
                setAuthMessage(null);
              }}
              className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all duration-200 ${
                authMode === "signup"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Crea Account
            </button>
          </div>

          {/* Error / Success Feedback */}
          {authMessage && (
            <div
              className={`p-3.5 rounded-2xl text-xs font-medium mb-4 flex items-start gap-2.5 animate-in fade-in-50 ${
                authMessage.type === "error"
                  ? "bg-red-50 text-red-600 border border-red-200/60"
                  : "bg-emerald-50 text-emerald-700 border border-emerald-200/60"
              }`}
            >
              <span className="text-sm shrink-0">{authMessage.type === "error" ? "⚠️" : "✅"}</span>
              <span className="leading-snug">{authMessage.text}</span>
            </div>
          )}

          {!isSupabaseConfigured && (
            <div className="p-3 bg-amber-50 border border-amber-200/80 rounded-2xl mb-4 text-[11px] text-amber-800 font-medium leading-relaxed">
              💡 <strong>Configurazione Cloud</strong>: Per sincronizzare online tra iPhone e PC, aggiungi le chiavi Supabase su Vercel. Nel frattempo puoi usare l'app liberamente in locale!
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleAuthSubmit} className="space-y-3.5">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1 px-1">
                Indirizzo Email
              </label>
              <div className="relative flex items-center">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
                <input
                  type="email"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="nome@esempio.it"
                  required
                  className="w-full bg-slate-50 hover:bg-slate-100/80 focus:bg-white text-slate-800 border border-slate-200/80 focus:border-blue-500 pl-10 pr-3 py-2.5 rounded-2xl text-sm font-medium outline-none transition-all"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1 px-1">
                Password
              </label>
              <div className="relative flex items-center">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
                <input
                  type="password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="Minimo 6 caratteri"
                  required
                  minLength={6}
                  className="w-full bg-slate-50 hover:bg-slate-100/80 focus:bg-white text-slate-800 border border-slate-200/80 focus:border-blue-500 pl-10 pr-3 py-2.5 rounded-2xl text-sm font-medium outline-none transition-all"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={authLoading}
              className="w-full mt-2 py-3 px-4 bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white font-semibold text-sm rounded-2xl shadow-md shadow-blue-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {authLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : authMode === "login" ? (
                <>
                  <LogIn className="w-4 h-4" />
                  <span>Accedi ad OnTime</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Crea il tuo Account</span>
                </>
              )}
            </button>

            {/* Continua in Locale / Ospite */}
            <button
              type="button"
              onClick={() => setIsGuestMode(true)}
              className="w-full mt-2 py-2.5 px-4 bg-slate-100 hover:bg-slate-200 active:scale-[0.98] text-slate-700 font-semibold text-xs rounded-2xl transition-all flex items-center justify-center gap-1.5"
            >
              <span>Continua in Locale (Senza Account)</span>
            </button>
          </form>

          {/* Subtext info */}
          <div className="mt-5 pt-4 border-t border-slate-100 text-center">
            <p className="text-[11px] text-slate-400 leading-relaxed">
              I tuoi impegni, tragitti e segnaposti sincronizzati ovunque con crittografia cloud.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-col min-h-screen h-auto bg-[#F5F5F7] pb-24 relative overflow-y-auto overscroll-y-contain font-sans">
      <div className="max-w-md mx-auto w-full flex flex-col flex-1">
        {/* HEADER - DECLUTTERED APPLE STYLE */}
        <header 
          className="w-full max-w-full px-4 py-3 flex items-center justify-between gap-2 overflow-x-hidden bg-[#F5F5F7] sticky top-0 z-50 border-b border-slate-200/40"
          style={{ paddingTop: 'max(env(safe-area-inset-top), 12px)' }}
        >
          {/* Left Side: Logo + App Title + Refresh Button */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="relative w-8 h-8 rounded-[10px] overflow-hidden shadow-sm shrink-0">
              <Image src="/logo.png" alt="OnTime Logo" fill className="object-cover" />
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <h1 className="text-xl font-bold tracking-tight text-slate-900 hidden sm:block">OnTime</h1>
              <Navigation2 className="w-3.5 h-3.5 text-blue-600 fill-blue-600 hidden sm:block" />
            </div>
            {authUser && (
              <button
                onClick={async () => {
                  setIsRefreshing(true);
                  if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(20);
                  await loadUserEvents();
                  setTimeout(() => setIsRefreshing(false), 700);
                }}
                className="w-8 h-8 bg-white rounded-full shadow-sm shadow-slate-200/50 flex items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-slate-50 border border-slate-200 transition-colors shrink-0"
                title="Sincronizza Cloud"
              >
                <RefreshCw className={`w-3.5 h-3.5 transform transition-transform duration-700 ${isRefreshing ? 'rotate-180' : ''}`} />
              </button>
            )}
          </div>

          {/* Right Side: Location Pill + Schedule Button + Profile Avatar */}
          <div className="flex items-center gap-2 shrink-0 max-w-full">
            {/* Location Pill */}
            <button
              onClick={() => {
                setIsEditingBase(false);
                setIsLocationModalOpen(true);
              }}
              className={`px-3 py-1.5 rounded-full flex items-center gap-1.5 transition-all border shadow-sm min-w-0 max-w-[140px] truncate ${
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
              <span className="text-xs font-semibold uppercase tracking-wider truncate">
                {formatPillCity(currentCity)}
              </span>
            </button>

            {/* Weekly Schedule Button (Icon-Only Desktop & Mobile) */}
            <button
              onClick={() => setIsRoutinesModalOpen(true)}
              aria-label="Orario settimanale"
              title="Orario settimanale"
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center bg-white/80 border border-gray-200/80 shadow-sm hover:bg-gray-50 active:scale-95 transition-all shrink-0"
            >
              <Calendar className="w-4 h-4 text-slate-700 shrink-0" />
            </button>

            {/* Profile Avatar Button */}
            <button
              onClick={() => {
                if (!authUser) {
                  setIsGuestMode(false);
                } else {
                  setIsProfileMenuOpen(true);
                }
              }}
              title={authUser ? `Profilo: ${authUser.email}` : "Accedi o Sincronizza Account"}
              className={`w-8 h-8 rounded-full font-bold text-xs flex items-center justify-center shadow-md relative hover:scale-105 active:scale-95 transition-all shrink-0 ${
                authUser ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-slate-800 text-white"
              }`}
            >
              {authUser ? (
                <span>{(authUser.email?.[0] || "U").toUpperCase()}</span>
              ) : (
                <User className="w-4 h-4" />
              )}
              {authUser && (
                <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 rounded-full ring-2 ring-white" />
              )}
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

        {dateTab === "tutti" ? (
          <div className="px-5 flex flex-col gap-5 flex-1">
            {/* PERSISTENT STICKY MINI-PLAYER & FULL FOCUS CARD */}
            {activeStudyBlock && (
              activeStudyBlock.isExpandedView ? (
                <div className={`rounded-[24px] p-6 shadow-xl relative overflow-hidden transition-all duration-300 ${
                  activeStudyBlock.mode === "break"
                    ? "bg-gradient-to-br from-emerald-900 via-slate-900 to-emerald-950 text-white border border-emerald-500/30"
                    : "bg-gradient-to-br from-indigo-900 via-slate-900 to-indigo-950 text-white border border-indigo-500/30"
                }`}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full animate-ping ${activeStudyBlock.mode === "break" ? "bg-emerald-400" : "bg-indigo-400"}`} />
                      <span className="text-[11px] font-bold uppercase tracking-widest text-slate-300">
                        {activeStudyBlock.mode === "break" ? "🌿 Pausa Relax" : "📖 Focus Studio"}
                      </span>
                    </div>
                    <button
                      onClick={() => setActiveStudyBlock((prev: ActiveStudyBlock | null) => prev ? { ...prev, isExpandedView: false } : null)}
                      className="text-xs font-semibold px-2.5 py-1 bg-white/10 hover:bg-white/20 rounded-full border border-white/10 transition-colors"
                    >
                      <span>Riduci ↙</span>
                    </button>
                  </div>

                  <div className="flex flex-col items-center justify-center my-3">
                    <h2 className="text-5xl font-black tracking-tight font-mono text-white drop-shadow-md">
                      {formatTimerMinutesSeconds(activeStudyBlock.secondsLeft)}
                    </h2>
                    <p className="text-xs font-medium text-slate-300 mt-1">
                      {activeStudyBlock.mode === "break"
                        ? (activeStudyBlock.isRunning ? "Pausa in corso... Rilassati!" : "Pausa in Sospeso")
                        : (activeStudyBlock.isRunning ? "Concentrazione in corso..." : "In Pausa")}
                    </p>
                  </div>

                  {(() => {
                    const totalSec = activeStudyBlock.initialSeconds || 1500;
                    const elapsed = totalSec - activeStudyBlock.secondsLeft;
                    const pct = Math.min(100, Math.max(0, (elapsed / totalSec) * 100));
                    return (
                      <div className="w-full bg-slate-950/80 rounded-full h-2 mb-5 overflow-hidden border border-white/10">
                        <div 
                          className={`h-full transition-all duration-1000 ease-linear rounded-full ${
                            activeStudyBlock.mode === "break"
                              ? "bg-gradient-to-r from-emerald-500 to-teal-300"
                              : "bg-gradient-to-r from-indigo-500 to-emerald-400"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    );
                  })()}

                  <div className="flex items-center justify-center gap-2.5">
                    <button
                      onClick={togglePauseResumeStudy}
                      className="px-4 py-2 bg-white/10 hover:bg-white/20 active:scale-95 rounded-xl text-xs font-bold text-white transition-all border border-white/10 flex items-center gap-1.5"
                    >
                      {activeStudyBlock.isRunning ? "⏸ Pausa" : "▶️ Riprendi"}
                    </button>

                    <button
                      onClick={handleAdd5MinsToStudy}
                      className="px-3 py-2 bg-white/10 hover:bg-white/20 active:scale-95 rounded-xl text-xs font-bold text-white transition-all border border-white/10"
                    >
                      +5m
                    </button>

                    <button
                      onClick={handleEndStudySession}
                      className="px-4 py-2 bg-red-500/20 hover:bg-red-500/40 text-red-200 active:scale-95 rounded-xl text-xs font-bold transition-all border border-red-500/30 flex items-center gap-1"
                    >
                      ⏹ Termina
                    </button>
                  </div>
                </div>
              ) : (
                /* SLEEK STICKY MINI-PLAYER BANNER */
                <div
                  onClick={() => setActiveStudyBlock((prev: ActiveStudyBlock | null) => prev ? { ...prev, isExpandedView: true } : null)}
                  className={`rounded-2xl p-3.5 shadow-md border flex items-center justify-between cursor-pointer transition-all duration-300 hover:scale-[1.01] ${
                    activeStudyBlock.mode === "break"
                      ? "bg-emerald-900 text-white border-emerald-700/60"
                      : "bg-slate-900 text-white border-slate-800"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 pr-2">
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 animate-ping ${activeStudyBlock.mode === "break" ? "bg-emerald-400" : "bg-indigo-400"}`} />
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-sm text-white">
                          {formatTimerMinutesSeconds(activeStudyBlock.secondsLeft)}
                        </span>
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.2 rounded-md ${
                          activeStudyBlock.mode === "break" ? "bg-emerald-800 text-emerald-200" : "bg-indigo-800 text-indigo-200"
                        }`}>
                          {activeStudyBlock.mode === "break" ? "Pausa Relax" : "Studio"}
                        </span>
                      </div>
                      <span className="text-xs text-slate-300 font-medium truncate">
                        {activeStudyBlock.subject}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={togglePauseResumeStudy}
                      className="px-2.5 py-1.5 bg-white/10 hover:bg-white/20 rounded-xl text-xs font-bold text-white transition-colors"
                    >
                      {activeStudyBlock.isRunning ? "⏸" : "▶️"}
                    </button>
                    <button
                      onClick={handleEndStudySession}
                      className="px-2.5 py-1.5 bg-red-500/20 hover:bg-red-500/40 rounded-xl text-xs font-bold text-red-200 transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )
            )}
            {/* APPLE CALENDAR CARD */}
            <div className="bg-white rounded-[24px] p-5 shadow-sm border border-slate-100/60">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900 capitalize">
                    {format(calendarMonth, "MMMM yyyy", { locale: it })}
                  </h3>
                  <p className="text-[11px] text-slate-400 font-medium">Tocca un giorno per vedere gli impegni</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setCalendarMonth((prev) => subMonths(prev, 1))}
                    className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors"
                    title="Mese precedente"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => {
                      const today = new Date();
                      setCalendarMonth(today);
                      setSelectedCalendarDate(format(today, "yyyy-MM-dd"));
                    }}
                    className="px-3 py-1 text-xs font-bold rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                  >
                    Oggi
                  </button>
                  <button
                    onClick={() => setCalendarMonth((prev) => addMonths(prev, 1))}
                    className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors"
                    title="Mese successivo"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-7 gap-1 text-center mb-2">
                {["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"].map((d) => (
                  <span key={d} className="text-[11px] font-bold text-slate-400 uppercase tracking-wider py-1">
                    {d}
                  </span>
                ))}
              </div>

              {(() => {
                const monthStart = startOfMonth(calendarMonth);
                const monthEnd = endOfMonth(calendarMonth);
                const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });
                let startDay = getDay(monthStart) - 1;
                if (startDay === -1) startDay = 6;
                const blanks = Array.from({ length: startDay });

                return (
                  <div className="grid grid-cols-7 gap-1">
                    {blanks.map((_, i) => (
                      <div key={`blank-${i}`} className="h-11" />
                    ))}
                    {daysInMonth.map((day) => {
                      const dayStr = format(day, "yyyy-MM-dd");
                      const isSelected = selectedCalendarDate === dayStr;
                      const isToday = dayStr === todayStr;
                      const dayEvents = getEffectiveEventsForDate(dayStr).filter((e) => e.status === "active");

                      return (
                        <button
                          key={dayStr}
                          onClick={() => setSelectedCalendarDate(dayStr)}
                          className={`h-11 rounded-[12px] flex flex-col items-center justify-center relative transition-all ${
                            isSelected
                              ? "bg-slate-900 text-white font-bold shadow-sm"
                              : isToday
                              ? "bg-blue-50 text-blue-600 font-bold border border-blue-200"
                              : "hover:bg-slate-100 text-slate-700 font-medium"
                          }`}
                        >
                          <span className="text-xs leading-none">{format(day, "d")}</span>
                          {dayEvents.length > 0 && (
                            <div className="flex items-center gap-0.5 mt-1">
                              {dayEvents.slice(0, 3).map((ev, idx) => {
                                const dotColor =
                                  ev.category === "Sport"
                                    ? "bg-orange-500"
                                    : ev.category === "Lavoro"
                                    ? "bg-emerald-500"
                                    : ev.category === "Salute"
                                    ? "bg-blue-500"
                                    : "bg-amber-500";
                                return (
                                  <span
                                    key={idx}
                                    className={`w-1.5 h-1.5 rounded-full ${isSelected ? "bg-white" : dotColor}`}
                                  />
                                );
                              })}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            {/* SELECTED DATE EVENTS LIST */}
            <div className="flex flex-col gap-3">
              <div className="flex justify-between items-center px-1">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  {selectedCalendarDate === todayStr
                    ? "Impegni di Oggi"
                    : `Impegni del ${format(parse(selectedCalendarDate, "yyyy-MM-dd", new Date()), "d MMMM yyyy", { locale: it })}`}
                </h3>
                <button
                  onClick={() => {
                    openNewEventModal(selectedCalendarDate);
                  }}
                  className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Aggiungi
                </button>
              </div>

              {(() => {
                const selectedDayEvents = getEffectiveEventsForDate(selectedCalendarDate)
                  .sort((a, b) => a.targetTime.localeCompare(b.targetTime));

                if (selectedDayEvents.length === 0) {
                  return (
                    <div className="bg-white rounded-[20px] p-6 text-center border border-slate-100/60 shadow-sm">
                      <p className="text-xs font-medium text-slate-400">Nessun impegno in programma per questa data.</p>
                      <button
                        onClick={() => {
                          openNewEventModal(selectedCalendarDate);
                        }}
                        className="mt-3 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-full inline-flex items-center gap-1.5 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" /> Pianifica impegno
                      </button>
                    </div>
                  );
                }

                return (
                  <div className="flex flex-col gap-3">
                    {selectedDayEvents.map((event) => (
                      <div
                        key={event.id}
                        className={`bg-white rounded-[20px] p-4 shadow-sm border border-slate-100/60 flex justify-between items-center ${
                          event.status === "completed" ? "opacity-60 bg-slate-50" : ""
                        }`}
                      >
                        <div className="flex-1 pr-3">
                          <div className="flex items-center gap-2">
                            <h4 className={`font-semibold text-[15px] line-clamp-1 ${event.status === "completed" ? "line-through text-slate-500" : "text-slate-800"}`}>
                              {event.title}
                            </h4>
                            <span className={`px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider border ${categoryStyles[event.category]}`}>
                              {event.category}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-3 text-xs font-medium text-slate-500 mt-1.5">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5 text-slate-400" />
                              {event.targetTime}
                            </span>
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3.5 h-3.5 text-slate-400" />
                              <span className="line-clamp-1 max-w-[150px]">{event.destinationName}</span>
                            </span>
                          </div>
                        </div>
                        {renderCardActionButtons(event)}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        ) : (
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
              <div className="w-full flex gap-3">
                <button
                  onClick={() => setIsStudyModalOpen(true)}
                  className="flex-1 bg-indigo-50 text-indigo-600 rounded-[16px] py-3.5 flex items-center justify-center gap-2 text-sm font-semibold shadow-sm hover:scale-[1.02] transition-transform"
                >
                  📖 Studio
                </button>
                <button
                  onClick={() => {
                    openNewEventModal(selectedCalendarDate);
                  }}
                  className="flex-[2] bg-slate-900 text-white rounded-[16px] py-3.5 flex items-center justify-center gap-2 text-sm font-semibold shadow-sm hover:scale-[1.02] transition-transform"
                >
                  <Plus className="w-4 h-4" /> Aggiungi Impegno
                </button>
              </div>
            </div>
          )}

          {/* FOCUS IN-PROGRESS CARD */}
          {activeEvent && nextEvent !== activeEvent && (() => {
            return (
              <div className="bg-white rounded-[24px] p-6 shadow-sm border border-slate-100/60 relative mb-6">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest leading-none">In Corso</h3>
                  <div className="flex items-center gap-2">
                    <span className="px-3 py-1 rounded-full text-[11px] font-bold tracking-wide leading-none bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                      🟢 In Corso
                    </span>
                    {renderCardActionButtons(activeEvent)}
                  </div>
                </div>

                <p className="text-[11px] font-bold text-emerald-600 uppercase tracking-widest mt-1 mb-3">
                  Sei arrivato a destinazione? Tocca la spunta per completare
                </p>

                <div className="mb-6">
                  <div className="flex flex-wrap items-center gap-2 mb-2.5">
                    <h2 className="text-[22px] font-semibold text-slate-800 leading-tight pr-10">{activeEvent.title}</h2>
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${categoryStyles[activeEvent.category]}`}>
                      {activeEvent.category}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2 text-[13px] font-medium text-slate-500 mt-3">
                    <span className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-slate-400" />
                      Iniziato alle {activeEvent.targetTime}
                    </span>
                    <span className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
                      <span className="line-clamp-1">{activeEvent.destinationName}</span>
                    </span>
                  </div>
                </div>

                {/* ROUTE & TRAVEL INFO BOX GRACEFUL STATE */}
                <div className="bg-[#F5F5F7] rounded-[16px] p-4 mb-6 text-center text-[12px] font-medium text-slate-600 shadow-inner">
                  🚗 Evento in corso &bull; Apri il navigatore se sei ancora per strada
                </div>

                {/* INTERACTIVE PRE-DEPARTURE CHECKLIST */}
                {activeEvent.checklist.length > 0 && (
                  <div className="mb-6">
                    <p className="text-[10px] font-bold text-slate-400 mb-2.5 uppercase tracking-widest">Da prendere</p>
                    <div className="flex flex-wrap gap-2">
                      {activeEvent.checklist.map((item) => {
                        const cleanLabel = item.replace(/^✓\s*/, "");
                        const isChecked = item.startsWith("✓ ");
                        return (
                          <button
                            key={cleanLabel}
                            onClick={() => toggleEventChecklistItem(activeEvent.id, cleanLabel)}
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

                {/* MAPS & COMPLETE ACTION BUTTONS */}
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={() => setMapsTargetEvent(activeEvent)}
                    className="flex-1 bg-[#007AFF] text-white rounded-[16px] py-3.5 flex items-center justify-center gap-2 text-sm font-semibold shadow-sm hover:bg-[#007AFF]/90 active:scale-[0.98] transition-all"
                  >
                    <Navigation2 className="w-4 h-4" /> Apri Mappe
                  </button>
                  
                  <button
                    onClick={() => completeEvent(activeEvent.id)}
                    className="flex-1 bg-emerald-500 text-white rounded-[16px] py-3.5 flex items-center justify-center gap-2 text-sm font-semibold shadow-sm hover:bg-emerald-600 active:scale-[0.98] transition-all"
                  >
                    <CheckCircle2 className="w-5 h-5" /> Completato
                  </button>
                </div>
              </div>
            );
          })()}

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
                    {renderCardActionButtons(nextEvent)}
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

                {/* ROUTE & TRANSPORT MODE SUMMARY WITH INSTANT MODE SWITCHER */}
                <div className="bg-[#F5F5F7] rounded-[16px] p-4 mb-6">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                    {/* Instant Transport Mode Switcher */}
                    <div className="flex items-center gap-1 bg-white p-1 rounded-[12px] border border-slate-200/80 shadow-xs">
                      <button
                        onClick={() => handleQuickModeChange(nextEvent.id, "driving")}
                        title="Viaggio in auto"
                        className={`px-2.5 py-1 rounded-[8px] text-xs font-semibold flex items-center gap-1 transition-all ${
                          mode === "driving"
                            ? "bg-slate-900 text-white shadow-xs"
                            : "text-slate-500 hover:text-slate-900"
                        }`}
                      >
                        <Car className="w-3.5 h-3.5" /> Auto
                      </button>
                      <button
                        onClick={() => handleQuickModeChange(nextEvent.id, "walking")}
                        title="A piedi"
                        className={`px-2.5 py-1 rounded-[8px] text-xs font-semibold flex items-center gap-1 transition-all ${
                          mode === "walking"
                            ? "bg-slate-900 text-white shadow-xs"
                            : "text-slate-500 hover:text-slate-900"
                        }`}
                      >
                        <Footprints className="w-3.5 h-3.5" /> Piedi
                      </button>
                      <button
                        onClick={() => handleQuickModeChange(nextEvent.id, "cycling")}
                        title="In bicicletta"
                        className={`px-2.5 py-1 rounded-[8px] text-xs font-semibold flex items-center gap-1 transition-all ${
                          mode === "cycling"
                            ? "bg-slate-900 text-white shadow-xs"
                            : "text-slate-500 hover:text-slate-900"
                        }`}
                      >
                        <Bike className="w-3.5 h-3.5" /> Bici
                      </button>
                    </div>

                    {nextEventWeather && (
                      <div className="text-xs font-bold text-slate-700 flex items-center gap-1 bg-white px-2.5 py-1 rounded-[12px] border border-slate-200/80 shadow-xs">
                        <span>{nextEventWeather.icon}</span>
                        <span>{nextEventWeather.temp}°C</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-[13px] font-medium text-slate-600">
                    <span className="flex items-center gap-1">
                      Tragitto: 
                      {badgeInfo.isCalculating ? (
                        <div className="w-10 h-4 bg-slate-200 rounded animate-pulse inline-block" />
                      ) : (
                        <span className="font-bold text-slate-800">~{nextEvent.travelTimeMins || 10} min</span>
                      )}
                      (Cuscinetto: +{nextEvent.bufferMinutes} min)
                    </span>
                    <span className="font-bold text-slate-900">
                      Uscita: {badgeInfo.isCalculating ? "--:--" : format(badgeInfo.departureTime, "HH:mm")}
                    </span>
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
                  <div key={event.id} className="bg-white rounded-full px-4 py-2.5 shadow-sm border border-slate-100/60 flex justify-between items-center overflow-hidden">
                    <div className="flex items-center gap-3 truncate">
                      <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md shrink-0">
                        {event.targetTime}
                      </span>
                      <span className="font-semibold text-slate-800 text-[13px] truncate">{event.title}</span>
                      <span className="text-[11px] text-slate-400 truncate hidden sm:inline-block">&bull; {event.destinationName}</span>
                    </div>
                    {renderCardActionButtons(event)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      </div>

      {/* FAB */}
      {masterEvents.length > 0 && (
        <div className="fixed bottom-6 right-6 sm:bottom-8 sm:right-8 flex flex-col items-end gap-3 z-40">
          {activeStudyBlock ? (
            <button
              onClick={() => setIsStudyModalOpen(true)}
              className={`px-4 py-3 rounded-2xl shadow-xl border flex items-center gap-3 transition-all hover:scale-105 active:scale-95 ${
                activeStudyBlock.mode === "break"
                  ? "bg-emerald-900 text-white border-emerald-500/40"
                  : "bg-slate-900 text-white border-indigo-500/40"
              }`}
            >
              <span className={`w-2.5 h-2.5 rounded-full animate-ping shrink-0 ${activeStudyBlock.mode === "break" ? "bg-emerald-400" : "bg-indigo-400"}`} />
              <div className="flex flex-col items-start min-w-0 pr-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono font-bold text-xs text-white">
                    {formatTimerMinutesSeconds(activeStudyBlock.secondsLeft)}
                  </span>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-slate-300">
                    {activeStudyBlock.mode === "break" ? "Pausa" : "Studio"}
                  </span>
                </div>
                <span className="text-[11px] font-semibold text-slate-300 truncate max-w-[110px]">
                  {activeStudyBlock.subject}
                </span>
              </div>
              <span className="text-xs bg-white/10 px-2 py-1 rounded-lg text-white font-semibold shrink-0">Apri ↗</span>
            </button>
          ) : (
            <button
              onClick={() => setIsStudyModalOpen(true)}
              className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full shadow-lg font-bold text-sm flex items-center gap-2 transition-all"
            >
              📖 Sessione Studio
            </button>
          )}
          <button
            onClick={() => {
              openNewEventModal();
            }}
            className="w-[52px] h-[52px] bg-slate-900 text-white rounded-full flex items-center justify-center shadow-lg shadow-slate-900/20 hover:scale-105 active:scale-95 transition-all"
          >
            <Plus className="w-6 h-6" />
          </button>
        </div>
      )}

      {/* iOS SAFARI PWA INSTALL GUIDE MODAL */}
      {isIosInstallModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-md rounded-[32px] p-6 shadow-2xl animate-in zoom-in-95 duration-300 relative">
            <button
              onClick={() => setIsIosInstallModalOpen(false)}
              className="absolute top-6 right-6 w-8 h-8 flex items-center justify-center bg-slate-100 rounded-full text-slate-500 hover:bg-slate-200"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center mb-4">
              <Smartphone className="w-7 h-7 text-blue-600" />
            </div>

            <h2 className="text-[20px] font-bold text-slate-900 mb-2">Installa OnTime per le Notifiche</h2>
            <p className="text-[13px] text-slate-500 font-medium leading-relaxed mb-6">
              Su iPhone (iOS), le notifiche su blocco schermo funzionano solo dopo aver aggiunto l'app alla schermata Home.
            </p>

            <div className="flex flex-col gap-3 bg-[#F5F5F7] p-4 rounded-[20px] mb-6 border border-slate-100">
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-600 text-white font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                  1
                </div>
                <p className="text-xs font-semibold text-slate-700">
                  Tocca l'icona <span className="font-bold text-blue-600">Condividi</span> in basso su Safari <span className="text-base">⎋</span>.
                </p>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-600 text-white font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                  2
                </div>
                <p className="text-xs font-semibold text-slate-700">
                  Scorri e seleziona <span className="font-bold text-slate-900">"Aggiungi alla schermata Home"</span> ➕.
                </p>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-600 text-white font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                  3
                </div>
                <p className="text-xs font-semibold text-slate-700">
                  Apri OnTime dalla Home del telefono e tocca di nuovo la campanella per attivarle!
                </p>
              </div>
            </div>

            <button
              onClick={() => setIsIosInstallModalOpen(false)}
              className="w-full bg-slate-900 text-white rounded-[16px] py-3.5 font-semibold text-sm shadow-sm hover:scale-[1.01] transition-transform"
            >
              Ho capito
            </button>
          </div>
        </div>
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

              {/* SECTION CAMPUS: SEDE PREDEFINITA STUDIO / SCUOLA */}
              <div className="bg-[#F5F5F7] p-4 rounded-[20px] flex flex-col gap-3">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className="text-base">🎓</span>
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Sede Predefinita (Università / Scuola)</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    {defaultCampus && !isEditingCampus && (
                      <button
                        type="button"
                        onClick={removeCampusSetting}
                        className="text-xs font-bold text-red-500 hover:underline"
                      >
                        Rimuovi
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setIsEditingCampus(!isEditingCampus)}
                      className="text-xs font-bold text-blue-600 hover:underline"
                    >
                      {isEditingCampus ? "Chiudi" : defaultCampus ? "Modifica" : "Imposta"}
                    </button>
                  </div>
                </div>

                <p className={`text-[11px] ${defaultCampus ? "font-bold text-slate-900" : "font-medium text-slate-500"}`}>
                  {defaultCampus ? `🎓 ${defaultCampus.name}` : "Nessuna sede configurata. Impostala qui per calcolare automaticamente il tragitto GPS verso le tue lezioni."}
                </p>

                {isEditingCampus && (
                  <div className="mt-1 relative">
                    <input
                      type="text"
                      placeholder="Cerca il tuo campus o università..."
                      value={campusSearchQuery}
                      onChange={(e) => setCampusSearchQuery(e.target.value)}
                      className="w-full bg-white text-slate-800 border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium outline-none focus:ring-2 focus:ring-blue-500/30"
                    />
                    {isSearchingCampus && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600 absolute right-3 top-2.5" />}

                    {campusSuggestions.length > 0 && (
                      <div className="bg-white rounded-xl shadow-lg border border-slate-200 mt-1 max-h-40 overflow-y-auto z-[90] relative">
                        {campusSuggestions.map((s, idx) => (
                          <button
                            key={idx}
                            type="button"
                            className="w-full text-left px-3 py-2 hover:bg-blue-50 text-xs flex items-center gap-2 border-b border-slate-100 last:border-0"
                            onClick={() => {
                              const newCap = { name: s.name, coords: { lat: s.lat, lon: s.lon } };
                              setDefaultCampus(newCap);
                              setIsEditingCampus(false);
                              setCampusSearchQuery("");
                              setCampusSuggestions([]);
                              syncUserSetting({
                                default_campus_name: newCap.name,
                                default_campus_coords: newCap.coords,
                              });
                            }}
                          >
                            <span>{s.icon || "🎓"}</span>
                            <div className="min-w-0">
                              <p className="font-bold text-slate-900 truncate">{s.name}</p>
                              <p className="text-[10px] text-slate-400 truncate">{s.secondary}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
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
                          syncUserSetting({ default_buffer: mins });
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
                        syncUserSetting({ default_transport: "driving" });
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
                        syncUserSetting({ default_transport: "walking" });
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
                        syncUserSetting({ default_transport: "cycling" });
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

              {/* SECTION: MAPBOX TRAFFICO IN TEMPO REALE */}
              <div className="bg-[#F5F5F7] p-4 rounded-[20px] flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-blue-600" />
                    <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Traffico Mapbox</h3>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${mapboxToken ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>
                    {mapboxToken ? "Attivo" : "Fallback OSRM"}
                  </span>
                </div>
                <p className="text-[12px] text-slate-500 leading-snug">
                  Inserisci il token Mapbox Directions per calcolare i tempi con traffico in tempo reale.
                </p>
                <input
                  type="password"
                  value={mapboxToken}
                  onChange={(e) => {
                    setMapboxToken(e.target.value);
                    localStorage.setItem("ontime_mapbox_token", e.target.value);
                  }}
                  placeholder="pk.eyJ1..."
                  className="w-full bg-white text-xs px-3 py-2.5 rounded-[12px] border border-slate-200 focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>

              {/* SECTION: TEST NOTIFICA SU BLOCCO SCHERMO */}
              <div className="bg-[#F5F5F7] p-4 rounded-[20px] flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-slate-700" />
                  <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Test Blocco Schermo</h3>
                </div>
                <p className="text-[12px] text-slate-500 leading-snug">
                  Premi il pulsante, poi blocca subito lo schermo con il tasto laterale del telefono per verificare suoni e vibrazione.
                </p>
                <button
                  onClick={triggerLockScreenTest}
                  disabled={testNotificationCountdown !== null}
                  className="w-full py-3 bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-400 rounded-[14px] text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-sm"
                >
                  {testNotificationCountdown !== null
                    ? `⏳ Blocca ora lo schermo! (${testNotificationCountdown}s)`
                    : "🧪 Testa Notifica Blocco Schermo (tra 5 sec)"}
                </button>
                {testNotificationCountdown !== null && (
                  <div className="p-3 bg-blue-50 rounded-[12px] border border-blue-200 text-center animate-pulse">
                    <p className="text-xs font-bold text-blue-800">
                      Premi subito il tasto laterale per bloccare lo schermo!
                    </p>
                    <p className="text-[11px] text-blue-600 mt-0.5">
                      Notifica e suono partiranno tra {testNotificationCountdown} secondi.
                    </p>
                  </div>
                )}
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
        const amapMode = mode === "walking" ? "w" : mode === "cycling" ? "c" : "d";

        const hasCustomOrigin = mapsTargetEvent.origin_type !== 'live' && !!mapsTargetEvent.origin_coords;
        const oLat = hasCustomOrigin && mapsTargetEvent.origin_coords ? mapsTargetEvent.origin_coords.lat : null;
        const oLon = hasCustomOrigin && mapsTargetEvent.origin_coords ? mapsTargetEvent.origin_coords.lon : null;

        let dLat = mapsTargetEvent.destinationCoords?.lat;
        let dLon = mapsTargetEvent.destinationCoords?.lon;
        
        // Failsafe array detection
        if (Array.isArray(mapsTargetEvent.destinationCoords)) {
           dLat = mapsTargetEvent.destinationCoords[1];
           dLon = mapsTargetEvent.destinationCoords[0];
        }

        const dName = encodeURIComponent(mapsTargetEvent.destinationName);

        // Google Maps URL
        let gmapsUrl = `https://www.google.com/maps/dir/?api=1&travelmode=${gmapMode}`;
        if (dLat !== undefined && dLon !== undefined) {
          gmapsUrl += `&destination=${dLat},${dLon}`;
        } else {
          gmapsUrl += `&destination=${dName}`;
        }
        if (hasCustomOrigin && oLat !== undefined && oLon !== undefined) {
          gmapsUrl += `&origin=${oLat},${oLon}`;
        }

        // Apple Maps URL
        let amapsUrl = `https://maps.apple.com/?dirflg=${amapMode}`;
        if (dLat !== undefined && dLon !== undefined) {
          amapsUrl += `&daddr=${dLat},${dLon}`;
        } else {
          amapsUrl += `&daddr=${dName}`;
        }
        if (hasCustomOrigin && oLat !== undefined && oLon !== undefined) {
          amapsUrl += `&saddr=${oLat},${oLon}`;
        }

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
                  href={gmapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setMapsTargetEvent(null)}
                  className="w-full py-4 px-5 bg-blue-600 hover:bg-blue-700 text-white rounded-[20px] font-bold text-sm flex items-center justify-between shadow-sm transition-all block"
                >
                  <div className="flex items-center gap-3">
                    <Map className="w-5 h-5" />
                    <span>Google Maps</span>
                  </div>
                  <ExternalLink className="w-4 h-4 opacity-70" />
                </a>

                <a
                  href={amapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setMapsTargetEvent(null)}
                  className="w-full py-4 px-5 bg-slate-900 hover:bg-slate-800 text-white rounded-[20px] font-bold text-sm flex items-center justify-between shadow-sm transition-all block"
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
                    if (homeLocation) switchToHomeMode(homeLocation);
                    setIsLocationModalOpen(false);
                  }}
                  disabled={!homeLocation}
                  className={`w-full p-4 rounded-[20px] border text-left flex items-center justify-between transition-all ${
                    !homeLocation ? "opacity-50 cursor-not-allowed border-slate-200 bg-slate-50" :
                    locationMode === "home"
                      ? "bg-slate-900 border-slate-900 shadow-md shadow-slate-900/20"
                      : "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                      locationMode === "home" ? "bg-slate-800 text-white" : "bg-blue-50 text-blue-600"
                    }`}>
                      <Home className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <h4 className={`text-sm font-bold truncate ${locationMode === "home" ? "text-white" : "text-slate-900"}`}>
                        Base Salvata
                      </h4>
                      <p className={`text-xs font-medium truncate mt-0.5 ${locationMode === "home" ? "text-slate-300" : "text-slate-500"}`}>
                        {homeLocation ? homeLocation.name : "Nessuna Base configurata"}
                      </p>
                    </div>
                  </div>
                  {locationMode === "home" && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />}
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
                          setNewBookmarkAddressQuery(s.name);
                          setSelectedBookmarkCoords({ lat: s.lat, lon: s.lon, name: s.name });
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
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4 touch-none overscroll-none animate-in fade-in duration-300">
          <div 
            className="w-full max-w-lg bg-white rounded-t-[28px] sm:rounded-[24px] max-h-[85dvh] flex flex-col shadow-2xl touch-auto overscroll-contain overflow-hidden animate-in slide-in-from-bottom-full duration-300"
          >
            {/* HEADER */}
            <div className="shrink-0 p-4 border-b border-gray-100 flex justify-between items-center bg-white">
              <h2 className="text-[20px] font-bold text-slate-900 ml-2">
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
            
            {/* BODY */}
            <div className="flex-1 overflow-y-auto overscroll-y-contain px-5 py-3 space-y-4 touch-pan-y overflow-x-hidden w-full max-w-full">
              <div className="flex flex-col gap-4">
              {/* Title */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-1.5 block">
                  Titolo Impegno
                </label>
                <input
                  type="text"
                  value={newEventTitle}
                  onChange={(e) => {
                    const val = e.target.value;
                    setNewEventTitle(val);
                    const lower = val.toLowerCase();
                    const studyKeywords = ["studio", "lezione", "esame", "università", "universita", "unical", "ripasso", "corso", "scuola", "tesi", "fisica", "analisi", "mate"];
                    if (studyKeywords.some((k) => lower.includes(k))) {
                      setNewEventCategory("Studio");
                    }
                  }}
                  placeholder="Es. Padel, Lezione Fisica, Spesa"
                  className="w-full bg-[#F5F5F7] text-slate-900 font-medium rounded-[14px] px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500/30 transition-all placeholder:text-slate-400 text-sm"
                />
              </div>

              {/* Category */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-1.5 block">
                  Categoria
                </label>
                <div className="flex flex-wrap gap-2">
                  {(["Sport", "Lavoro", "Salute", "Studio", "Personale"] as EventCategory[]).map((cat) => (
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

              {/* PARTENZA DA */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-1.5 block">
                  Partenza Da
                </label>
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none [&::-webkit-scrollbar]:hidden">
                  {/* Live GPS chip */}
                  <button
                    type="button"
                    onClick={() => { setOriginType("live"); setOriginBookmarkId(null); setIsOriginSearchOpen(false); }}
                    className={`px-3 py-1.5 rounded-[12px] text-xs font-semibold flex items-center gap-1.5 shrink-0 border transition-all ${
                      originType === "live"
                        ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                        : "bg-[#F5F5F7] text-slate-700 border-slate-200/80 hover:bg-slate-200/60"
                    }`}
                  >
                    <span>📍</span>
                    <span>Posizione Attuale</span>
                  </button>

                  {/* Bookmark chips */}
                  {savedPlaces.map((place) => (
                    <button
                      key={place.id}
                      type="button"
                      onClick={() => { setOriginType("bookmark"); setOriginBookmarkId(place.id); setIsOriginSearchOpen(false); }}
                      className={`px-3 py-1.5 rounded-[12px] text-xs font-semibold flex items-center gap-1.5 shrink-0 border transition-all ${
                        originType === "bookmark" && originBookmarkId === place.id
                          ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                          : "bg-[#F5F5F7] text-slate-700 border-slate-200/80 hover:bg-slate-200/60"
                      }`}
                    >
                      <span>{place.icon}</span>
                      <span>{place.name}</span>
                    </button>
                  ))}
                  
                  {/* Custom Address chip */}
                  <button
                    type="button"
                    onClick={() => { 
                      setOriginType("custom"); 
                      setOriginBookmarkId(null); 
                      setIsOriginSearchOpen(true);
                    }}
                    className={`px-3 py-1.5 rounded-[12px] text-xs font-semibold flex items-center gap-1.5 shrink-0 border transition-all ${
                      originType === "custom"
                        ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                        : "bg-[#F5F5F7] text-slate-700 border-slate-200/80 hover:bg-slate-200/60"
                    }`}
                  >
                    <span>✏️</span>
                    <span>Altro Indirizzo</span>
                  </button>
                </div>
                
                {/* Custom Address Input (only visible when Altro Indirizzo is selected) */}
                {originType === "custom" && isOriginSearchOpen && (
                  <div className="mt-2 relative">
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <MapPin className="w-4 h-4 text-slate-400" />
                      </div>
                      <input
                        type="text"
                        placeholder="Cerca via, locale o città..."
                        value={originCustomQuery}
                        onChange={async (e) => {
                          const val = e.target.value;
                          setOriginCustomQuery(val);
                          setOriginCustomCoords(null);
                          setOriginCustomAddress(null);
                          if (val.length > 2) {
                            setIsSearchingOrigin(true);
                            const results = await searchPlaces(val);
                            setOriginSuggestions(results);
                            setIsSearchingOrigin(false);
                          } else {
                            setOriginSuggestions([]);
                          }
                        }}
                        className="w-full pl-9 pr-10 py-3 bg-[#F5F5F7] text-slate-900 border-0 rounded-[14px] text-sm focus:ring-2 focus:ring-blue-600 outline-none"
                      />
                      {isSearchingOrigin && (
                        <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                          <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
                        </div>
                      )}
                    </div>
                    {/* Suggestions dropdown */}
                    {originSuggestions.length > 0 && !originCustomCoords && (
                      <div className="absolute z-[60] top-full left-0 right-0 mt-1 bg-white rounded-[14px] shadow-lg border border-slate-100 max-h-48 overflow-y-auto">
                        {originSuggestions.map((sug, i) => (
                          <div
                            key={i}
                            onClick={() => {
                              setOriginCustomCoords({ lat: sug.lat, lon: sug.lon });
                              setOriginCustomAddress(sug.name);
                              setOriginCustomQuery(sug.name);
                              setOriginSuggestions([]);
                            }}
                            className="px-4 py-3 flex items-start gap-3 hover:bg-slate-50 cursor-pointer border-b border-slate-50 last:border-0"
                          >
                            <span className="text-xl shrink-0 leading-none">{sug.icon || "📍"}</span>
                            <div className="flex flex-col min-w-0">
                              <span className="text-sm font-bold text-slate-900 truncate">{sug.name}</span>
                              {sug.secondary && <span className="text-[11px] text-slate-500 truncate mt-0.5">{sug.secondary}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {originType === "bookmark" && (
                  <p className="text-[10px] text-slate-400 mt-1 ml-1">
                    Il tempo di viaggio sarà calcolato da questa posizione fissa.
                  </p>
                )}
                {originType === "custom" && originCustomCoords && (
                  <p className="text-[10px] text-green-600 mt-1 ml-1">
                    Posizione impostata con successo.
                  </p>
                )}
                {originType === "live" && (
                  <p className="text-[10px] text-slate-400 mt-1 ml-1">
                    Il tempo di viaggio sarà aggiornato in tempo reale dal GPS del tuo dispositivo.
                  </p>
                )}
              </div>

              {/* Address Autocomplete & Saved Bookmarks Bar */}
              <div className="relative">
                <div className="flex justify-between items-center ml-1 mb-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">
                    Destinazione
                  </label>
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={handleSmartPaste} className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-[6px] border border-indigo-100 flex items-center gap-1 hover:bg-indigo-100 transition-colors">
                      📋 Incolla Link
                    </button>
                    <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">
                      Segnaposti Rapidi
                    </span>
                  </div>
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
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (addressSuggestions.length > 0) {
                          const top = addressSuggestions[0];
                          setAddressQuery(top.fullName);
                          setSelectedDest({ lat: top.lat, lon: top.lon, name: top.fullName });
                          setAddressSuggestions([]);
                        }
                      }
                    }}
                    onChange={(e) => {
                      setAddressQuery(e.target.value);
                      if (selectedDest && e.target.value !== selectedDest.name) {
                        setSelectedDest(null);
                        setSelectedBookmarkId(null);
                      }
                    }}
                    placeholder="Cerca locale, palestra, ristorante o via"
                    className="w-full bg-[#F5F5F7] text-slate-900 font-medium rounded-[14px] pl-10 pr-4 py-3 outline-none focus:ring-2 focus:ring-blue-500/30 transition-all placeholder:text-slate-400 text-sm"
                  />
                  {isSearchingAddress && <Loader2 className="w-4 h-4 animate-spin text-slate-400 absolute right-4 top-1/2 -translate-y-1/2" />}
                </div>

                {/* ONE-TAP SAVE TO BOOKMARKS / SEGNAPOSTI */}
                {selectedDest && (
                  <div className="mt-2 flex items-center gap-2">
                    {(() => {
                      const isSaved = savedPlaces.some(
                        (p) =>
                          p.name.toLowerCase() === selectedDest.name.split(",")[0].toLowerCase() ||
                          (Math.abs(p.coords.lat - selectedDest.lat) < 0.0005 &&
                            Math.abs(p.coords.lon - selectedDest.lon) < 0.0005)
                      );
                      if (isSaved) {
                        return (
                          <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200/80 flex items-center gap-1.5">
                            <Check className="w-3 h-3 text-emerald-600" /> Salvato nei tuoi Segnaposti
                          </span>
                        );
                      }
                      return (
                        <button
                          type="button"
                          onClick={oneTapSaveDestination}
                          className="px-3 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-colors border border-amber-200 shadow-xs"
                        >
                          <Bookmark className="w-3.5 h-3.5 text-amber-600 fill-amber-500" />
                          <span>
                            {bookmarkSavedFeedback
                              ? "Aggiunto ai Segnaposti! ✓"
                              : `Salva "${selectedDest.name.split(",")[0]}" tra i Segnaposti`}
                          </span>
                        </button>
                      );
                    })()}
                  </div>
                )}

                {/* Suggestions Dropdown (Mapbox Places POI + Photon + Google Maps Bridge) */}
                {addressQuery.trim().length >= 2 && (addressSuggestions.length > 0 || !selectedDest) && (
                  <div className="absolute top-full left-0 right-0 z-[999] bg-white rounded-xl shadow-2xl border border-gray-100 max-h-64 overflow-y-auto scrollbar-none [&::-webkit-scrollbar]:hidden mt-1">
                    {addressSuggestions.map((s, i) => (
                      <button
                        key={i}
                        className="w-full text-left px-4 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0 transition-colors flex items-start gap-3"
                        onClick={() => {
                          setAddressQuery(s.name);
                          setSelectedDest({ lat: s.lat, lon: s.lon, name: s.name });
                          setAddressSuggestions([]);
                        }}
                      >
                        <span className="text-base shrink-0 mt-0.5">{s.icon || "📍"}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-xs font-bold text-slate-900 truncate">{s.name}</p>
                            {s.category && (
                              <span className="text-[9px] font-semibold text-slate-400 capitalize px-1.5 py-0.2 bg-slate-100 rounded shrink-0">
                                {s.category}
                              </span>
                            )}
                          </div>
                          {s.secondary && <p className="text-[11px] text-slate-400 truncate mt-0.5">{s.secondary}</p>}
                        </div>
                      </button>
                    ))}

                    {/* INSTANT GOOGLE MAPS QUERY BRIDGE */}
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressQuery)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full text-left px-4 py-2.5 bg-blue-50/60 hover:bg-blue-100/60 border-t border-slate-100 transition-colors flex items-center justify-between text-xs text-blue-700 block"
                    >
                      <span className="flex items-center gap-2 font-medium truncate pr-2">
                        <ExternalLink className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                        <span className="truncate">
                          Cerca <strong>"{addressQuery}"</strong> su Google Maps
                        </span>
                      </span>
                      <span className="text-[10px] text-blue-600 font-bold uppercase tracking-wider shrink-0">
                        Verifica ↗
                      </span>
                    </a>

                    {/* MANUAL FALLBACK OPTION - Usa questo nome */}
                    <button
                      type="button"
                      className="w-full text-left px-4 py-2.5 bg-slate-50 hover:bg-slate-100 border-t border-slate-100 transition-colors flex items-center gap-2 text-slate-600 font-semibold text-xs"
                      onClick={async () => {
                        if (currentCity && currentLoc) {
                          const geo = await fetchSuggestions(currentCity);
                          if (geo.length > 0) {
                            setSelectedDest({ lat: geo[0].lat, lon: geo[0].lon, name: addressQuery.trim() });
                          } else {
                            setSelectedDest({ lat: currentLoc.lat, lon: currentLoc.lon, name: addressQuery.trim() });
                          }
                        } else if (currentLoc) {
                          setSelectedDest({ lat: currentLoc.lat, lon: currentLoc.lon, name: addressQuery.trim() });
                        } else {
                          alert("Posizione non disponibile per il salvataggio manuale");
                        }
                        setAddressSuggestions([]);
                      }}
                    >
                      <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <span className="truncate">Usa questo nome: "{addressQuery}"</span>
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
                        <Check className="w-3.5 h-3.5" />
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
            </div>
            
            {/* FOOTER */}
            <div className="shrink-0 p-4 border-t border-gray-100 bg-white">
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

      {/* APPLE PROFILE & QUICK CONTROLS MODAL SHEET */}
      {isProfileMenuOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-md p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-md rounded-t-[32px] sm:rounded-[32px] p-6 sm:p-7 shadow-2xl animate-in slide-in-from-bottom-full duration-300 relative">
            {/* Close Button */}
            <button
              onClick={() => setIsProfileMenuOpen(false)}
              className="absolute top-5 right-5 w-8 h-8 flex items-center justify-center bg-slate-100 rounded-full text-slate-500 hover:bg-slate-200 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            {/* User Profile Card Header */}
            <div className="flex items-center gap-3.5 pb-5 border-b border-slate-100">
              <div className="w-12 h-12 bg-blue-600 text-white rounded-2xl flex items-center justify-center text-lg font-bold shadow-md shadow-blue-500/20 shrink-0">
                {(authUser?.email?.[0] || "U").toUpperCase()}
              </div>
              <div className="flex-1 min-w-0 pr-8">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Account Connesso</p>
                <h3 className="text-sm font-bold text-slate-900 truncate">{authUser?.email}</h3>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shrink-0" />
                  <span className="text-[11px] font-semibold text-emerald-600">Sincronizzazione Cloud Attiva</span>
                </div>
              </div>
            </div>

            {/* Menu Items List */}
            <div className="py-4 space-y-2">
              {/* Impostazioni & Segnaposti */}
              <button
                onClick={() => {
                  setIsProfileMenuOpen(false);
                  setIsSettingsOpen(true);
                }}
                className="w-full flex items-center justify-between p-3.5 rounded-2xl hover:bg-slate-50 transition-colors text-left group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 group-hover:bg-blue-50 text-slate-600 group-hover:text-blue-600 flex items-center justify-center transition-colors shrink-0">
                    <Settings className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-800">Impostazioni & Segnaposti</h4>
                    <p className="text-[11px] text-slate-400">Basi frequenti, tempo di sicurezza e preferenze</p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors shrink-0" />
              </button>

              {/* Archivio Impegni Conclusi */}
              <button
                onClick={() => {
                  setIsProfileMenuOpen(false);
                  setIsHistoryOpen(true);
                }}
                className="w-full flex items-center justify-between p-3.5 rounded-2xl hover:bg-slate-50 transition-colors text-left group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 group-hover:bg-emerald-50 text-slate-600 group-hover:text-emerald-600 flex items-center justify-center transition-colors shrink-0">
                    <CheckCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-800">Archivio Impegni Conclusi</h4>
                    <p className="text-[11px] text-slate-400">Visualizza o ripristina gli eventi passati</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {completedEvents.length > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold">
                      {completedEvents.length}
                    </span>
                  )}
                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
                </div>
              </button>

              {/* Gestione Notifiche */}
              <button
                onClick={toggleNotifications}
                className="w-full flex items-center justify-between p-3.5 rounded-2xl hover:bg-slate-50 transition-colors text-left group"
              >
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors shrink-0 ${
                    notificationsEnabled ? "bg-amber-50 text-amber-600" : "bg-slate-100 text-slate-400"
                  }`}>
                    {notificationsEnabled ? <Bell className="w-5 h-5" /> : <BellOff className="w-5 h-5" />}
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-800">Notifiche di Partenza</h4>
                    <p className="text-[11px] text-slate-400">
                      {notificationsEnabled ? "Avvisi sonori e suoni attivi" : "Tocca per abilitare gli avvisi"}
                    </p>
                  </div>
                </div>
                <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full shrink-0 ${
                  notificationsEnabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                }`}>
                  {notificationsEnabled ? "Attive" : "Disattivate"}
                </span>
              </button>
            </div>

            {/* Danger Logout Action */}
            <div className="pt-3 border-t border-slate-100">
              <button
                onClick={handleLogout}
                className="w-full py-3.5 px-4 bg-red-50 hover:bg-red-100 active:scale-[0.98] text-red-600 rounded-2xl font-bold text-xs flex items-center justify-center gap-2 transition-all"
              >
                <LogOut className="w-4 h-4" />
                <span>Disconnetti Account</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REAL WEEKLY SCHEDULE MODAL */}
      {isRoutinesModalOpen && (
        <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-md p-0 sm:p-4 animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-md rounded-t-[32px] sm:rounded-[32px] p-6 sm:p-7 shadow-2xl relative max-h-[90vh] flex flex-col">
            <button
              onClick={() => setIsRoutinesModalOpen(false)}
              className="absolute top-5 right-5 w-8 h-8 flex items-center justify-center bg-slate-100 rounded-full text-slate-500 hover:bg-slate-200 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2 mb-1">
              <Calendar className="w-5 h-5 text-blue-600" />
              <h2 className="text-xl font-bold text-slate-900">Orario Settimanale / Lezioni</h2>
            </div>
            <p className="text-xs text-slate-500 font-medium mb-3">
              Imposta le lezioni ricorrenti per ciascun giorno della settimana.
            </p>

            {/* Sede Predefinita Campus Card */}
            <div className="bg-blue-50/80 border border-blue-200/80 rounded-2xl p-3 mb-4 shrink-0">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-base shrink-0">🎓</span>
                  <div className="min-w-0">
                    <h4 className="text-xs font-bold text-slate-800">Sede Predefinita (Università / Scuola)</h4>
                    <p className={`text-[11px] truncate ${defaultCampus ? "font-bold text-slate-900" : "font-medium text-slate-500"}`}>
                      {defaultCampus ? defaultCampus.name : "Nessuna sede configurata"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {defaultCampus && !isEditingCampus && (
                    <button
                      type="button"
                      onClick={removeCampusSetting}
                      className="px-2.5 py-1 text-xs font-bold bg-red-50 text-red-600 border border-red-200 rounded-xl hover:bg-red-100 transition-colors"
                    >
                      Rimuovi
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsEditingCampus(!isEditingCampus)}
                    className="px-2.5 py-1 text-xs font-bold bg-white border border-blue-200 text-blue-600 rounded-xl hover:bg-blue-50 transition-colors shadow-xs"
                  >
                    {isEditingCampus ? "Chiudi" : defaultCampus ? "Modifica" : "Imposta"}
                  </button>
                </div>
              </div>

              {isEditingCampus && (
                <div className="mt-3 pt-2.5 border-t border-blue-200/60 relative">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Cerca o inserisci indirizzo/sede..."
                      value={campusSearchQuery}
                      onChange={(e) => setCampusSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleManualSaveCampus();
                        }
                      }}
                      className="flex-1 bg-white text-slate-800 border border-blue-200 rounded-xl px-3 py-2 text-xs font-medium outline-none focus:ring-2 focus:ring-blue-500/30"
                    />
                    <button
                      type="button"
                      onClick={handleManualSaveCampus}
                      className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl transition-all shrink-0 shadow-xs"
                    >
                      Salva
                    </button>
                  </div>
                  {isSearchingCampus && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600 absolute right-14 top-5 pointer-events-none" />}

                  {campusSuggestions.length > 0 && (
                    <div className="bg-white rounded-xl shadow-lg border border-slate-200 mt-1 max-h-40 overflow-y-auto z-[90] relative">
                      {campusSuggestions.map((s, idx) => (
                        <button
                          key={idx}
                          type="button"
                          className="w-full text-left px-3 py-2 hover:bg-blue-50 text-xs flex items-center gap-2 border-b border-slate-100 last:border-0"
                          onClick={() => {
                            const newCap = { name: s.name, coords: { lat: s.lat, lon: s.lon } };
                            saveCampusSetting(newCap);
                            setIsEditingCampus(false);
                            setCampusSearchQuery("");
                            setCampusSuggestions([]);
                          }}
                        >
                          <span>{s.icon || "🎓"}</span>
                          <div className="min-w-0">
                            <p className="font-bold text-slate-900 truncate">{s.name}</p>
                            <p className="text-[10px] text-slate-400 truncate">{s.secondary}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Segmented Day Selector */}
            <div className="flex bg-slate-100 p-1 rounded-2xl mb-4 border border-slate-200/60 overflow-x-auto scrollbar-none shrink-0">
              {[
                { label: "Lun", value: 1 },
                { label: "Mar", value: 2 },
                { label: "Mer", value: 3 },
                { label: "Gio", value: 4 },
                { label: "Ven", value: 5 },
                { label: "Sab", value: 6 },
                { label: "Dom", value: 0 },
              ].map((day) => (
                <button
                  key={day.value}
                  type="button"
                  onClick={() => setSelectedRoutineDay(day.value)}
                  className={`flex-1 py-1.5 px-2 text-xs font-bold rounded-xl transition-all whitespace-nowrap ${
                    selectedRoutineDay === day.value
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {day.label}
                </button>
              ))}
            </div>

            {/* List of Routines for Selected Day */}
            <div className="flex-1 overflow-y-auto space-y-2 mb-4 pr-1 min-h-[100px]">
              {userRoutines.filter((r) => r.day_of_week === selectedRoutineDay).length === 0 ? (
                <div className="text-center py-6 px-4 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                  <p className="text-xs font-medium text-slate-400">Nessuna lezione in programma per questo giorno.</p>
                </div>
              ) : (
                userRoutines
                  .filter((r) => r.day_of_week === selectedRoutineDay)
                  .map((routine) => (
                    <div
                      key={routine.id}
                      className="bg-slate-50 rounded-2xl p-3.5 border border-slate-200/80 flex items-center justify-between"
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        <h4 className="font-bold text-slate-900 text-sm truncate">{routine.title}</h4>
                        <div className="flex items-center gap-3 text-xs text-slate-500 font-medium mt-1">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            {routine.start_time} - {routine.end_time}
                          </span>
                          <span className="flex items-center gap-1 truncate">
                            <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span className="truncate">{routine.location_name}</span>
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteRoutine(routine.id)}
                        className="w-8 h-8 rounded-full bg-red-50 hover:bg-red-100 text-red-500 flex items-center justify-center transition-colors shrink-0"
                        title="Elimina lezione"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))
              )}
            </div>

            {/* Form to Add New Routine */}
            <form onSubmit={handleAddRoutine} className="pt-3 border-t border-slate-100 space-y-2.5 shrink-0">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">+ Aggiungi Lezione</h3>
              
              <div>
                <input
                  type="text"
                  placeholder="Materia / Corso (es. Fisica 1)"
                  value={newRoutineTitle}
                  onChange={(e) => setNewRoutineTitle(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium text-slate-800 outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 w-full">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-gray-500 uppercase">Orario Inizio</label>
                  <input
                    type="time"
                    value={newRoutineStartTime}
                    onChange={(e) => setNewRoutineStartTime(e.target.value)}
                    className="w-full h-11 px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-gray-500 uppercase">Orario Fine</label>
                  <input
                    type="time"
                    value={newRoutineEndTime}
                    onChange={(e) => setNewRoutineEndTime(e.target.value)}
                    className="w-full h-11 px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>

              <div>
                <input
                  type="text"
                  placeholder="Aula / Edificio (es. Aula Magna)"
                  value={newRoutineLocation}
                  onChange={(e) => setNewRoutineLocation(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium text-slate-800 outline-none focus:border-blue-500"
                />
              </div>

              <button
                type="submit"
                disabled={isSavingRoutine}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-98 text-white font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-sm"
              >
                {isSavingRoutine ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salva Lezione"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* IN-APP STUDY / BREAK COMPLETION MODAL */}
      {studyNotice && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-sm rounded-[32px] p-6 shadow-2xl text-center relative animate-in zoom-in-95 duration-300">
            <div className="w-16 h-16 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center text-3xl mx-auto mb-4">
              {studyNotice.icon}
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-2">{studyNotice.title}</h3>
            <p className="text-xs text-slate-600 font-medium leading-relaxed mb-6 px-2">
              {studyNotice.body}
            </p>
            <button
              onClick={() => setStudyNotice(null)}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white rounded-2xl py-3.5 font-bold text-sm shadow-md transition-transform active:scale-95"
            >
              {studyNotice.mode === "break" ? "Inizia Pausa Relax" : "Riprendi Studio"}
            </button>
          </div>
        </div>
      )}

      {/* REAL STUDY SESSION MODAL (SUPPORTING SETUP & ACTIVE FOCUS TIMER) */}
      {isStudyModalOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <div className={`w-full max-w-sm rounded-[32px] p-6 shadow-2xl relative transition-all duration-300 ${
            activeStudyBlock
              ? activeStudyBlock.mode === "break"
                ? "bg-gradient-to-br from-emerald-900 via-slate-900 to-emerald-950 text-white border border-emerald-500/30"
                : "bg-gradient-to-br from-indigo-900 via-slate-900 to-indigo-950 text-white border border-indigo-500/30"
              : "bg-white text-slate-900"
          }`}>
            <button
              onClick={() => setIsStudyModalOpen(false)}
              className={`absolute top-5 right-5 w-8 h-8 flex items-center justify-center rounded-full transition-colors ${
                activeStudyBlock ? "bg-white/10 hover:bg-white/20 text-white" : "bg-slate-100 hover:bg-slate-200 text-slate-500"
              }`}
            >
              <X className="w-4 h-4" />
            </button>

            {activeStudyBlock ? (
              /* LIVE ACTIVE TIMER VIEW INSIDE MODAL */
              <div className="flex flex-col items-center">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`w-2.5 h-2.5 rounded-full animate-ping ${activeStudyBlock.mode === "break" ? "bg-emerald-400" : "bg-indigo-400"}`} />
                  <span className="text-xs font-bold uppercase tracking-widest text-slate-300">
                    {activeStudyBlock.mode === "break" ? "🌿 Pausa Relax" : "📖 Focus Studio Attivo"}
                  </span>
                </div>

                <h3 className="text-lg font-bold text-white text-center mb-4 truncate max-w-[240px]">
                  {activeStudyBlock.subject}
                </h3>

                {/* Big Live Countdown MM:SS */}
                <div className="my-2 text-center">
                  <h2 className="text-6xl font-black tracking-tight font-mono text-white drop-shadow-lg">
                    {formatTimerMinutesSeconds(activeStudyBlock.secondsLeft)}
                  </h2>
                  <p className="text-xs font-medium text-slate-300 mt-2">
                    {activeStudyBlock.mode === "break"
                      ? (activeStudyBlock.isRunning ? "Pausa in corso... Rilassati!" : "Pausa in Sospeso")
                      : (activeStudyBlock.isRunning ? "Concentrazione in corso..." : "In Pausa")}
                  </p>
                </div>

                {/* Progress Bar */}
                {(() => {
                  const totalSec = activeStudyBlock.initialSeconds || 1500;
                  const elapsed = totalSec - activeStudyBlock.secondsLeft;
                  const pct = Math.min(100, Math.max(0, (elapsed / totalSec) * 100));
                  return (
                    <div className="w-full bg-slate-950/80 rounded-full h-2.5 my-5 overflow-hidden border border-white/10">
                      <div 
                        className={`h-full transition-all duration-1000 ease-linear rounded-full ${
                          activeStudyBlock.mode === "break"
                            ? "bg-gradient-to-r from-emerald-500 to-teal-300"
                            : "bg-gradient-to-r from-indigo-500 to-emerald-400"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  );
                })()}

                {/* Control Action Buttons */}
                <div className="flex items-center justify-center gap-3 w-full mt-2">
                  <button
                    onClick={togglePauseResumeStudy}
                    className="flex-1 py-3 bg-white/10 hover:bg-white/20 active:scale-95 rounded-2xl text-xs font-bold text-white transition-all border border-white/10 flex items-center justify-center gap-1.5"
                  >
                    {activeStudyBlock.isRunning ? "⏸ Pausa" : "▶️ Riprendi"}
                  </button>

                  <button
                    onClick={handleAdd5MinsToStudy}
                    className="px-4 py-3 bg-white/10 hover:bg-white/20 active:scale-95 rounded-2xl text-xs font-bold text-white transition-all border border-white/10"
                  >
                    +5m
                  </button>

                  <button
                    onClick={() => {
                      handleEndStudySession();
                      setIsStudyModalOpen(false);
                    }}
                    className="flex-1 py-3 bg-red-500/20 hover:bg-red-500/40 text-red-200 active:scale-95 rounded-2xl text-xs font-bold transition-all border border-red-500/30 flex items-center justify-center gap-1"
                  >
                    ⏹ Termina
                  </button>
                </div>
              </div>
            ) : (
              /* SETUP FORM (WHEN NO SESSION IS ACTIVE) */
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xl">📖</span>
                  <h2 className="text-xl font-bold text-slate-900">Sessione Studio</h2>
                </div>
                <p className="text-xs text-slate-500 font-medium mb-5">
                  Imposta la materia e la durata della tua sessione di focus.
                </p>

                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1 px-1">
                      Materia / Argomento
                    </label>
                    <input
                      type="text"
                      placeholder="es. Fisica, Analisi 1, Tesi..."
                      value={studySubject}
                      onChange={(e) => setStudySubject(e.target.value)}
                      className="w-full bg-slate-50 hover:bg-slate-100/80 focus:bg-white text-slate-800 border border-slate-200 focus:border-indigo-500 px-3.5 py-2.5 rounded-2xl text-sm font-medium outline-none transition-all"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5 px-1">
                      Intervalli Studio / Pausa
                    </label>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <button
                        type="button"
                        onClick={() => setStudyPresetMode("25_5")}
                        className={`py-2.5 px-3 rounded-2xl text-xs font-bold border transition-all text-center ${
                          studyPresetMode === "25_5"
                            ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                            : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                        }`}
                      >
                        ⚡ 25m / 5m Pausa
                      </button>

                      <button
                        type="button"
                        onClick={() => setStudyPresetMode("50_10")}
                        className={`py-2.5 px-3 rounded-2xl text-xs font-bold border transition-all text-center ${
                          studyPresetMode === "50_10"
                            ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                            : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                        }`}
                      >
                        🔥 50m / 10m Pausa
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => setStudyPresetMode("custom")}
                      className={`w-full py-2 px-3 rounded-2xl text-xs font-bold border transition-all text-center mb-2 ${
                        studyPresetMode === "custom"
                          ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                          : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                      }`}
                    >
                      ⚙️ Personalizzato
                    </button>

                    {studyPresetMode === "custom" && (
                      <div className="grid grid-cols-2 gap-2 p-3 bg-indigo-50/60 border border-indigo-100 rounded-2xl animate-in fade-in">
                        <div>
                          <label className="text-[10px] font-bold text-indigo-700 block mb-1">Studio (min)</label>
                          <input
                            type="number"
                            min="1"
                            max="240"
                            value={customStudyInput}
                            onChange={(e) => setCustomStudyInput(e.target.value)}
                            className="w-full bg-white border border-indigo-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/30"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-emerald-700 block mb-1">Pausa (min)</label>
                          <input
                            type="number"
                            min="1"
                            max="60"
                            value={customBreakInput}
                            onChange={(e) => setCustomBreakInput(e.target.value)}
                            className="w-full bg-white border border-emerald-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500/30"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleStartStudyBlock}
                    className="w-full mt-2 py-3 px-4 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white font-bold text-sm rounded-2xl shadow-md shadow-indigo-500/20 transition-all flex items-center justify-center gap-2"
                  >
                    <span>Avvia Timer Focus</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
