import { useCallback, useEffect, useRef, useState } from "react";
import { APIRequestError } from "../../lib/api";
import { journalAPI } from "./api";

/** Admin idle time is renewed only by foreground interaction, never by a polling timer. */
export function useJournalAdminSession() {
  const [expired, setExpiredState] = useState(false);
  const [checking, setChecking] = useState(true);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadline = useRef(0);
  const lastInteractionCheck = useRef(0);
  const requestGeneration = useRef(0);
  const alive = useRef(true);
  const setExpired = useCallback((value: boolean) => {
    if (value) {
      requestGeneration.current++;
      deadline.current = 0;
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
    }
    setExpiredState(value);
  }, []);
  const refreshSession = useCallback(async () => {
    const generation = ++requestGeneration.current;
    const started = performance.now();
    try {
      const session = await journalAPI.adminSession();
      if (!alive.current || generation !== requestGeneration.current)
        return false;
      const remaining =
        Date.parse(session.expires_at) -
        Date.parse(session.server_time) -
        (performance.now() - started);
      if (!Number.isFinite(remaining) || remaining <= 0) {
        setExpiredState(true);
        setChecking(false);
        return false;
      }
      deadline.current = Date.now() + remaining;
      lastInteractionCheck.current = Date.now();
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
      expiryTimer.current = setTimeout(() => {
        if (alive.current) {
          setExpiredState(true);
          setChecking(false);
        }
      }, remaining);
      setExpiredState(false);
      setChecking(document.visibilityState === "hidden");
      return true;
    } catch (error) {
      if (!alive.current || generation !== requestGeneration.current)
        return false;
      if (
        (error instanceof APIRequestError &&
          [401, 403].includes(error.status)) ||
        deadline.current <= Date.now()
      )
        setExpiredState(true);
      // A disconnected editor can keep an already verified, unexpired draft in memory.
      setChecking(false);
      return false;
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    queueMicrotask(() => {
      if (alive.current) void refreshSession();
    });
    const visibility = () => {
      setChecking(true);
      if (document.visibilityState === "visible") void refreshSession();
    };
    const interaction = () => {
      if (
        document.visibilityState !== "visible" ||
        Date.now() - lastInteractionCheck.current < 60_000
      )
        return;
      lastInteractionCheck.current = Date.now();
      void refreshSession();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pointerdown", interaction);
    window.addEventListener("keydown", interaction);
    return () => {
      alive.current = false;
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pointerdown", interaction);
      window.removeEventListener("keydown", interaction);
    };
  }, [refreshSession]);
  return { expired, setExpired, checking, refreshSession };
}
