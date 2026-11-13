"use client";

import { useEffect, useState } from "react";
import { getResolvedApiUrl } from "@/lib/resolvedApiUrl";

type Status = "checking" | "ok" | "error";

export default function BackendStatus() {
  const [status, setStatus] = useState<Status>("checking");
  const [message, setMessage] = useState<string>("");
  const [apiUrl, setApiUrl] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    setStatus("checking");
    setMessage("");

    getResolvedApiUrl()
      .then((url) => {
        if (cancelled) return;
        setApiUrl(url);
        return fetch(`${url}/health`, { method: "GET" });
      })
      .then((res) => {
        if (cancelled || res === undefined) return;
        if (res.ok) {
          setStatus("ok");
          setMessage("Connected");
        } else {
          setStatus("error");
          setMessage(`HTTP ${res.status}`);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus("error");
        const msg = err?.message || "Unreachable";
        setMessage(msg === "Failed to fetch" ? "Cannot reach API (is Docker/backend running?)" : msg);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const dot =
    status === "ok" ? "var(--rd-success)" : status === "error" ? "var(--rd-danger)" : "var(--rd-warning)";

  return (
    <div className="rd-card px-4 py-3" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[0.75rem] font-medium text-[var(--rd-muted)]">Backend API</p>
        <span className="rd-badge">
          <span
            className={`rd-dot ${status === "checking" ? "animate-pulse" : ""}`}
            style={{ background: dot }}
            aria-hidden
          />
          {status === "checking" ? "Checking" : status === "ok" ? "Operational" : "Unreachable"}
        </span>
      </div>
      <p className="mt-1 text-[0.8125rem] text-[var(--rd-text-2)]">
        {status === "checking" && "Checking…"}
        {status === "ok" && message}
        {status === "error" && `Error: ${message}`}
      </p>
      {apiUrl && <p className="rd-mono mt-1 truncate text-[var(--rd-faint)]">{apiUrl}</p>}
    </div>
  );
}
