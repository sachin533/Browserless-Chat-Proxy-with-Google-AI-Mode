import { useCallback, useEffect, useState } from 'react';
import {
  MODEL,
  STREAMING_ENABLED,
  getApiKey,
  resolveBaseUrl,
  setApiKey,
} from '../api/client.js';

const STORAGE_KEY = 'gaim.settings';

const DEFAULTS = {
  baseUrl: resolveBaseUrl(import.meta.env.VITE_API_BASE_URL),
  model: import.meta.env.VITE_MODEL || MODEL,
  streaming: STREAMING_ENABLED,
  sidebarCollapsed: false,
};

function load() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULTS };
    return {
      ...DEFAULTS,
      ...parsed,
      baseUrl: parsed.baseUrl || DEFAULTS.baseUrl,
      model: parsed.model || DEFAULTS.model,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function persist(settings) {
  try {
    const { apiKey, ...rest } = settings;
    void apiKey; // the API key never leaves sessionStorage
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
  } catch {
    /* storage may be unavailable - the app still works */
  }
}

/**
 * Runtime application settings.
 *
 * The API key lives in `sessionStorage` only (never `localStorage`, never the
 * bundle).  Everything else is persisted in `localStorage` so the playground
 * keeps its configuration across reloads.
 */
export function useAppSettings() {
  const [settings, setSettings] = useState(load);
  const [apiKey, setApiKeyState] = useState(() => getApiKey());

  useEffect(() => {
    persist(settings);
  }, [settings]);

  const update = useCallback((patch) => {
    setSettings((previous) => ({ ...previous, ...patch }));
  }, []);

  const updateApiKey = useCallback((value) => {
    setApiKey(value);
    setApiKeyState(value);
  }, []);

  return {
    settings,
    update,
    apiKey,
    updateApiKey,
    baseUrl: resolveBaseUrl(settings.baseUrl),
    model: settings.model,
    streaming: settings.streaming,
  };
}
