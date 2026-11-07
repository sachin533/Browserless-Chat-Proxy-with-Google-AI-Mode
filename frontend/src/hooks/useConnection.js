import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchExtensionStatus, fetchHealth } from '../api/client.js';

const POLL_INTERVAL = Number(import.meta.env.VITE_STATUS_POLL_MS) || 5000;

/**
 * Connection states used across the UI.
 * `unknown` means the backend has not answered yet.
 */
export const STATUS = {
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  ERROR: 'error',
  UNKNOWN: 'unknown',
};

const INITIAL_STATE = {
  backend: STATUS.UNKNOWN,
  extension: STATUS.UNKNOWN,
  tab: STATUS.UNKNOWN,
  login: STATUS.UNKNOWN,
  health: null,
  extensionStatus: null,
  lastCheckedAt: null,
  error: null,
};

/**
 * Poll the backend health and the extension status.
 *
 * The status is always derived from the real API responses - nothing is
 * assumed or faked.
 */
export function useConnection({ pollMs = POLL_INTERVAL, baseUrl } = {}) {
  const [state, setState] = useState(INITIAL_STATE);
  const abortRef = useRef(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const health = await fetchHealth({ signal: controller.signal, baseUrl });
      const extensionStatus = await fetchExtensionStatus({
        signal: controller.signal,
        baseUrl,
      });

      if (!mountedRef.current || controller.signal.aborted) return;

      setState({
        backend: STATUS.CONNECTED,
        extension: extensionStatus.connected ? STATUS.CONNECTED : STATUS.DISCONNECTED,
        tab: deriveTabStatus(extensionStatus),
        login: deriveLoginStatus(extensionStatus),
        health,
        extensionStatus,
        lastCheckedAt: Date.now(),
        error: null,
      });
    } catch (error) {
      if (!mountedRef.current || controller.signal.aborted) return;

      setState((previous) => ({
        ...previous,
        backend: error?.isNetworkError ? STATUS.DISCONNECTED : STATUS.ERROR,
        extension: STATUS.DISCONNECTED,
        tab: STATUS.DISCONNECTED,
        login: STATUS.DISCONNECTED,
        lastCheckedAt: Date.now(),
        error: error?.message || 'The backend could not be reached.',
      }));
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();

    const timer = setInterval(refresh, pollMs);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);

    return () => {
      mountedRef.current = false;
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      abortRef.current?.abort();
    };
  }, [refresh, pollMs]);

  // Re-check immediately when the backend URL changes.
  useEffect(() => {
    refresh();
  }, [baseUrl, refresh]);

  return { ...state, refresh, apiBaseUrl: baseUrl };
}

function deriveTabStatus(extensionStatus) {
  if (!extensionStatus) return STATUS.UNKNOWN;
  if (extensionStatus.captcha_detected) return STATUS.ERROR;
  if (extensionStatus.ai_mode_ready) return STATUS.CONNECTED;
  if (extensionStatus.ai_mode_tab_open) return STATUS.ERROR;
  return STATUS.DISCONNECTED;
}

function deriveLoginStatus(extensionStatus) {
  if (!extensionStatus) return STATUS.UNKNOWN;
  if (extensionStatus.captcha_detected) return STATUS.ERROR;
  if (extensionStatus.logged_in) return STATUS.CONNECTED;
  if (extensionStatus.login_required) return STATUS.ERROR;
  return STATUS.UNKNOWN;
}
