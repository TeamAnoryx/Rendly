'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getResolvedApiUrl } from '@/lib/resolvedApiUrl';
import { getStoredAuthToken } from '@/lib/auth-storage';
import { withBasePath } from '@/lib/basePath';

export const INTENTS = ['Light chat', 'Brainstorm', 'Motivation', 'Collaborate', 'Networking'] as const;
export type Intent = (typeof INTENTS)[number];

export type UserMe = {
  id: string;
  email: string | null;
  avatar_url: string | null;
  github_id: string | null;
  github_url: string | null;
  linkedin_id: string | null;
  linkedin_url: string | null;
  username?: string | null;
  selected_intents?: string[] | null;
  bio?: string | null;
};

export type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

function validateUsernameFormat(value: string): boolean {
  const v = value.replace(/^@/, '').trim();
  if (v.length < 3 || v.length > 20) return false;
  return /^[a-zA-Z0-9_]+$/.test(v);
}

export function validatePasswordRequirements(password: string): {
  length: boolean;
  uppercase: boolean;
  special: boolean;
  number: boolean;
  all: boolean;
} {
  const length = password.length >= 8;
  const uppercase = /[A-Z]/.test(password);
  const special = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  const number = /[0-9]/.test(password);
  return { length, uppercase, special, number, all: length && uppercase && special && number };
}

export function useProfileSetup() {
  const [mounted, setMounted] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
  const usernameCheckTsRef = useRef(0);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [selectedIntents, setSelectedIntents] = useState<string[]>([]);
  const [bio, setBio] = useState('');
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  useEffect(() => {
    setMounted(true);
    setToken(getStoredAuthToken());
  }, []);

  const fetchUser = useCallback(async (authToken: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const baseUrl = await getResolvedApiUrl();
      const res = await fetch(`${baseUrl}/api/users/me`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.message || 'Failed to load profile');
      }
      const data = await res.json();
      setUser(data);
      if (data.username) {
        setUsername(data.username.replace(/^@/, ''));
        setUsernameStatus('available');
      }
      if (Array.isArray(data.selected_intents)) setSelectedIntents(data.selected_intents);
      if (typeof data.bio === 'string') setBio(data.bio);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load profile');
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!token) {
      setLoadError('Not signed in');
      setLoading(false);
      return;
    }
    fetchUser(token);
  }, [mounted, token, fetchUser]);

  const checkUsernameAvailability = useCallback(async (value: string) => {
    const normalized = value.replace(/^@/, '').trim().toLowerCase();
    if (!normalized || normalized.length < 3) {
      setUsernameStatus('invalid');
      return;
    }
    if (!validateUsernameFormat(value)) {
      setUsernameStatus('invalid');
      return;
    }
    setUsernameStatus('checking');
    const ts = Date.now();
    usernameCheckTsRef.current = ts;
    try {
      const baseUrl = await getResolvedApiUrl();
      const res = await fetch(`${baseUrl}/api/users/check-username`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ username: normalized }),
      });
      const data = await res.json().catch(() => ({}));
      if (ts !== usernameCheckTsRef.current) return;
      setUsernameStatus(data.available ? 'available' : 'taken');
    } catch {
      if (ts === usernameCheckTsRef.current) setUsernameStatus('idle');
    }
  }, [token]);

  useEffect(() => {
    if (!username.trim()) {
      setUsernameStatus('idle');
      return;
    }
    if (!validateUsernameFormat(username)) {
      setUsernameStatus('invalid');
      return;
    }
    const t = setTimeout(() => {
      checkUsernameAvailability(username);
    }, 500);
    return () => clearTimeout(t);
  }, [username, checkUsernameAvailability]);

  const passwordReqs = useMemo(() => validatePasswordRequirements(password), [password]);

  const toggleIntent = useCallback((intent: string) => {
    setSelectedIntents((prev) => {
      const next = prev.includes(intent) ? prev.filter((i) => i !== intent) : [...prev, intent];
      if (next.length > 5) return prev;
      return next;
    });
  }, []);

  const profileAlreadyComplete = useMemo(
    () =>
      !!(
        user?.username &&
        Array.isArray(user?.selected_intents) &&
        user.selected_intents.length >= 2
      ),
    [user?.username, user?.selected_intents]
  );

  const formValid = useMemo(() => {
    if (profileAlreadyComplete) return true;
    if (!username.trim() || usernameStatus !== 'available') return false;
    if (!passwordReqs.all) return false;
    if (selectedIntents.length < 2 || selectedIntents.length > 5) return false;
    if (!agreeToTerms) return false;
    if (bio.length > 150) return false;
    return true;
  }, [profileAlreadyComplete, username, usernameStatus, passwordReqs.all, selectedIntents.length, agreeToTerms, bio.length]);

  const submit = useCallback(async () => {
    if (!formValid || submitLoading || !token) return;
    if (profileAlreadyComplete) {
      window.location.href = withBasePath('/dashboard');
      return;
    }
    setSubmitError(null);
    setSubmitLoading(true);
    try {
      const baseUrl = await getResolvedApiUrl();
      const res = await fetch(`${baseUrl}/api/auth/profile-setup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          username: (username.startsWith('@') ? username : `@${username}`).trim().toLowerCase(),
          password,
          selectedIntents,
          bio: bio.trim().slice(0, 150) || undefined,
          agreeToTerms: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || 'Failed to save profile');
      }
      if (data.success) {
        setSubmitSuccess(true);
        setTimeout(() => {
          window.location.href = withBasePath('/dashboard');
        }, 1000);
      } else {
        throw new Error(data?.message || 'Failed to save profile');
      }
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to save profile');
    } finally {
      setSubmitLoading(false);
    }
  }, [formValid, submitLoading, token, profileAlreadyComplete, username, password, selectedIntents, bio]);

  const refetchUser = useCallback(() => {
    if (token) fetchUser(token);
  }, [token, fetchUser]);

  return {
    mounted,
    user,
    loading,
    loadError,
    fetchUser: refetchUser,
    username,
    setUsername,
    usernameStatus,
    password,
    setPassword,
    showPassword,
    setShowPassword,
    passwordReqs,
    selectedIntents,
    setSelectedIntents,
    toggleIntent,
    bio,
    setBio,
    agreeToTerms,
    setAgreeToTerms,
    formValid,
    submit,
    submitLoading,
    submitError,
    submitSuccess,
    token,
    profileAlreadyComplete,
  };
}
