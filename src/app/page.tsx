'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Mail,
  RefreshCw,
  Tag,
  Clock,
  Filter,
  X,
  Plus,
  Copy,
  Check,
  ExternalLink,
  Trash2,
  Sparkles,
  Calendar,
  Search,
  Layers,
  LayoutGrid,
  LogOut,
  ShieldCheck,
} from 'lucide-react';

interface AuthenticatedUser {
  userId: string;
  email: string;
  name?: string | null;
  picture?: string | null;
}

interface EmailAccount {
  id: string;
  email: string;
  provider: string;
  lastScanned: string | null;
  status: string;
  _count?: {
    offers: number;
  };
}

interface Offer {
  id: string;
  emailAccountId: string;
  emailAccount: {
    id: string;
    email: string;
    provider: string;
  };
  merchantName: string;
  merchantDomain: string | null;
  merchantLogo: string | null;
  title: string;
  description: string | null;
  promoCode: string | null;
  category: string;
  discountValue: string | null;
  offerUrl: string | null;
  receivedAt: string;
  expiresAt: string | null;
  isDismissed: boolean;
}

interface ClubbedOffer extends Offer {
  offerIds: string[];
  emailAccounts: Array<{
    id: string;
    email: string;
    provider: string;
  }>;
}

const CATEGORIES = [
  'All',
  'Fashion',
  'Food & Dining',
  'Tech',
  'Travel',
  'Beauty',
  'Home',
  'Entertainment',
  'Other',
];

export default function OfferDashboardPage() {
  const [authUser, setAuthUser] = useState<AuthenticatedUser | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [latestScan, setLatestScan] = useState<any>(null);
  const [recentLogs, setRecentLogs] = useState<any[]>([]);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [lastErrorBanner, setLastErrorBanner] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Filters required: Category, Code Only, Email_ID, Expiration, Search
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [codeOnly, setCodeOnly] = useState<boolean>(false);
  const [selectedEmailId, setSelectedEmailId] = useState<string>('all');
  const [expirationFilter, setExpirationFilter] = useState<string>('active');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [groupByMerchant, setGroupByMerchant] = useState<boolean>(false);

  // Connect Account Modal
  const [showAddAccountModal, setShowAddAccountModal] = useState(false);
  const [newDemoEmail, setNewDemoEmail] = useState('');
  const [addingAccount, setAddingAccount] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const fetchAccounts = async () => {
    try {
      const res = await fetch('/api/accounts');
      const data = await res.json();
      if (data.accounts) setAccounts(data.accounts);
      if (data.latestScan) {
        setLatestScan(data.latestScan);
        if (data.latestScan.status === 'failed' && data.latestScan.errorMessage) {
          setLastErrorBanner(data.latestScan.errorMessage);
        }
      }
      if (data.recentLogs) setRecentLogs(data.recentLogs);
    } catch (err) {
      console.error('Failed to fetch accounts', err);
    }
  };

  const fetchOffers = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedCategory !== 'All') params.set('category', selectedCategory);
      if (codeOnly) params.set('codeOnly', 'true');
      if (selectedEmailId !== 'all') params.set('emailAccountId', selectedEmailId);
      if (expirationFilter !== 'all') params.set('expiration', expirationFilter);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());

      const res = await fetch(`/api/offers?${params.toString()}`);
      const data = await res.json();
      if (data.offers) setOffers(data.offers);
    } catch (err) {
      console.error('Failed to fetch offers', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const initAuth = async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          setAuthUser(data.user);
          await fetchAccounts();
        } else {
          setAuthUser(null);
          setLoading(false);
        }
      } catch {
        setAuthUser(null);
        setLoading(false);
      } finally {
        setAuthChecking(false);
      }
    };

    initAuth();

    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const connectedEmail = params.get('connected');
      const oauthError = params.get('error');
      if (connectedEmail) {
        showToast(`Connected ${connectedEmail} and scanned last 30 days!`);
        window.history.replaceState({}, '', '/');
      } else if (oauthError) {
        showToast(`Google OAuth error: ${oauthError}`);
        window.history.replaceState({}, '', '/');
      }
    }
  }, []);

  useEffect(() => {
    if (authUser) {
      fetchOffers();
    }
  }, [authUser, selectedCategory, codeOnly, selectedEmailId, expirationFilter, searchQuery]);

  const handleSignOut = async () => {
    await fetch('/api/auth/me', { method: 'DELETE' });
    setAuthUser(null);
    setAccounts([]);
    setOffers([]);
  };

  const handleManualRefresh = async (forceRescan: boolean = false) => {
    setScanning(true);
    setLastErrorBanner(null);
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: selectedEmailId !== 'all' ? selectedEmailId : undefined,
          forceRescan,
        }),
      });
      const rawText = await res.text();
      let data: any = {};
      try {
        data = JSON.parse(rawText);
      } catch {
        data = { error: `HTTP ${res.status}`, details: rawText.slice(0, 300) };
      }

      if (res.ok) {
        showToast(data.message || 'Scan completed!');
        await Promise.all([fetchAccounts(), fetchOffers()]);
      } else {
        const errMsg = data.details
          ? `${data.error}: ${data.details}`
          : data.error || `HTTP ${res.status} Failed to run scan`;
        setLastErrorBanner(errMsg);
        showToast(errMsg);
        await fetchAccounts();
      }
    } catch (err: any) {
      const errMsg = `Network/Scan Error: ${err?.message || String(err)}`;
      setLastErrorBanner(errMsg);
      showToast(errMsg);
    } finally {
      setScanning(false);
    }
  };

  const handleDismissOffer = async (offerIds: string[]) => {
    const idSet = new Set(offerIds);
    // Optimistically remove all clubbed instances from UI
    setOffers((prev) => prev.filter((o) => !idSet.has(o.id)));
    try {
      const res = await fetch('/api/offers/dismiss-merchant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offerIds }),
      });
      if (res.ok) {
        showToast(
          offerIds.length > 1
            ? `Offer dismissed across ${offerIds.length} emails.`
            : 'Offer dismissed from listing.'
        );
        fetchAccounts();
      }
    } catch (err) {
      console.error('Failed to dismiss offer', err);
      fetchOffers();
    }
  };

  const handleDismissByMerchant = async (merchantName: string) => {
    const normalized = merchantName.trim().toLowerCase();
    setOffers((prev) =>
      prev.filter((o) => o.merchantName.trim().toLowerCase() !== normalized)
    );
    try {
      const res = await fetch('/api/offers/dismiss-merchant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchantName }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showToast(data.message || `Dismissed all offers from ${merchantName}.`);
        fetchAccounts();
      }
    } catch (err) {
      console.error('Failed to dismiss merchant offers', err);
      fetchOffers();
    }
  };

  const handleCopyCode = (id: string, code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleConnectGoogleOAuth = async () => {
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'google_oauth' }),
      });
      const data = await res.json();
      if (data.authUrl) {
        window.location.href = data.authUrl;
      } else {
        showToast(data.error || 'Configure GOOGLE_CLIENT_ID in .env first');
      }
    } catch (err) {
      showToast('Error starting Google OAuth flow.');
    }
  };

  const handleAddDemoAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDemoEmail.trim()) return;
    setAddingAccount(true);
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newDemoEmail.trim(), provider: 'demo' }),
      });
      const data = await res.json();
      if (res.ok) {
        setNewDemoEmail('');
        setShowAddAccountModal(false);
        showToast(`Connected ${data.account.email} & scanned last 30 days!`);
        await Promise.all([fetchAccounts(), fetchOffers()]);
      } else {
        showToast(data.error || 'Failed to connect email account');
      }
    } finally {
      setAddingAccount(false);
    }
  };

  const handleRemoveAccount = async (id: string, email: string) => {
    try {
      await fetch(`/api/accounts?id=${id}`, { method: 'DELETE' });
      if (selectedEmailId === id) setSelectedEmailId('all');
      showToast(`Removed ${email}`);
      await Promise.all([fetchAccounts(), fetchOffers()]);
    } catch (err) {
      showToast('Failed to remove account');
    }
  };

  // Club identical offers across multiple email accounts into a single card
  const clubbedOffers = useMemo<ClubbedOffer[]>(() => {
    const map = new Map<string, ClubbedOffer>();

    for (const offer of offers) {
      const merchantKey = offer.merchantName.trim().toLowerCase();
      // Group by merchant + promoCode (if present) OR merchant + normalized title
      const identityKey = offer.promoCode
        ? `${merchantKey}::code::${offer.promoCode.trim().toUpperCase()}`
        : `${merchantKey}::title::${offer.title
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')}`;

      const existing = map.get(identityKey);
      if (!existing) {
        map.set(identityKey, {
          ...offer,
          offerIds: [offer.id],
          emailAccounts: [offer.emailAccount],
        });
      } else {
        existing.offerIds.push(offer.id);
        if (!existing.emailAccounts.some((e) => e.email === offer.emailAccount.email)) {
          existing.emailAccounts.push(offer.emailAccount);
        }
        // Keep the latest expiration date if one has an expiry and the other doesn't
        if (!existing.expiresAt && offer.expiresAt) {
          existing.expiresAt = offer.expiresAt;
        }
      }
    }

    return Array.from(map.values());
  }, [offers]);

  // Group clubbed offers by merchant
  const offersByMerchant = useMemo(() => {
    const groups: Record<string, ClubbedOffer[]> = {};
    for (const offer of clubbedOffers) {
      const key = offer.merchantName;
      if (!groups[key]) groups[key] = [];
      groups[key].push(offer);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [clubbedOffers]);

  const formatExpiry = (expiresAt: string | null) => {
    if (!expiresAt) return { label: 'No expiration listed', urgent: false };
    const exp = new Date(expiresAt);
    const diffDays = Math.ceil((exp.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return { label: 'Expired', urgent: true };
    if (diffDays === 0) return { label: 'Expires today', urgent: true };
    if (diffDays <= 5) return { label: `Expires in ${diffDays}d`, urgent: true };
    return {
      label: `Expires ${exp.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })}`,
      urgent: false,
    };
  };

  if (authChecking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex items-center gap-3 text-sm font-medium text-slate-600">
          <RefreshCw className="h-5 w-5 animate-spin text-indigo-600" />
          <span>Verifying secure session...</span>
        </div>
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4">
        {toastMessage && (
          <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-xl">
            <Sparkles className="h-4 w-4 text-amber-400" />
            <span>{toastMessage}</span>
          </div>
        )}
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-sm">
            <Tag className="h-6 w-6" />
          </div>
          <h1 className="text-center text-xl font-bold text-slate-900">
            Sign in to InboxOffers
          </h1>
          <p className="mt-2 text-center text-sm text-slate-500">
            Securely connect your email accounts to automatically scan the last 30 days of promotional offers.
          </p>

          <div className="mt-6">
            <a
              href="/api/accounts/google"
              className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
            >
              <Mail className="h-4 w-4" />
              Sign in with Google
            </a>
          </div>

          <div className="mt-6 flex items-start gap-2.5 rounded-xl bg-slate-50 p-3.5 text-xs text-slate-500">
            <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
            <span>
              Protected by HttpOnly HMAC-SHA256 sessions, OAuth 2.0 CSRF state verification, and AES-256-GCM encrypted token storage.
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-xl">
          <Sparkles className="h-4 w-4 text-amber-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
              <Tag className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-slate-900">
                InboxOffers
              </h1>
              <p className="text-xs text-slate-500">
                Automated Nightly 30-Day Multi-Inbox Offer Scanner
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="hidden items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs text-slate-600 sm:flex">
              <Clock className="h-3.5 w-3.5 text-indigo-600" />
              <span>Nightly schedule: 2:00 AM • Last 30 days window</span>
            </div>

            <button
              onClick={() => handleManualRefresh(false)}
              disabled={scanning}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw
                className={`h-4 w-4 text-indigo-600 ${scanning ? 'animate-spin' : ''}`}
              />
              {scanning ? 'Scanning 30 Days...' : 'Manual Refresh'}
            </button>

            <button
              onClick={() => handleManualRefresh(true)}
              disabled={scanning}
              title="Re-parse all non-dismissed offers from the last 30 days using the latest deal extractor"
              className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-2 text-xs font-semibold text-indigo-700 shadow-sm transition hover:bg-indigo-100 disabled:opacity-60"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Deep Re-Scan
            </button>

            <button
              onClick={() => setShowAddAccountModal(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
            >
              <Plus className="h-4 w-4" />
              Connect Email Account
            </button>

            <div className="flex items-center gap-2 border-l border-slate-200 pl-3">
              <span className="hidden text-xs font-medium text-slate-600 md:inline">
                {authUser.email}
              </span>
              <button
                onClick={handleSignOut}
                title="Sign out"
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-sm transition hover:bg-rose-50 hover:text-rose-600"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {/* Live Error Banner if a scan fails */}
        {lastErrorBanner && (
          <div className="mb-6 flex items-start justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 shadow-sm">
            <div>
              <span className="font-bold">Scan Error Diagnostic: </span>
              <span className="font-mono break-all">{lastErrorBanner}</span>
            </div>
            <button
              onClick={() => setLastErrorBanner(null)}
              className="rounded-lg p-1 text-rose-500 hover:bg-rose-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Connected Email Accounts Bar */}
        <section className="mb-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-indigo-600" />
              <h2 className="text-sm font-semibold text-slate-800">
                Connected Email Accounts ({accounts.length})
              </h2>
            </div>
            <div className="flex items-center gap-3">
              {latestScan && (
                <span className="text-xs text-slate-500">
                  Last scan ({latestScan.triggerType} •{' '}
                  <span
                    className={
                      latestScan.status === 'failed'
                        ? 'font-semibold text-rose-600'
                        : 'font-semibold text-emerald-600'
                    }
                  >
                    {latestScan.status}
                  </span>
                  ): {new Date(latestScan.startedAt).toLocaleString()}
                </span>
              )}
              <button
                onClick={() => setShowLogsModal(true)}
                className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                View Scan Logs ({recentLogs.length})
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => setSelectedEmailId('all')}
              className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-medium transition ${
                selectedEmailId === 'all'
                  ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <span>All Inboxes</span>
              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 shadow-sm">
                {accounts.reduce((acc, a) => acc + (a._count?.offers || 0), 0)}
              </span>
            </button>

            {accounts.map((acc) => (
              <div
                key={acc.id}
                className={`group inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-medium transition ${
                  selectedEmailId === acc.id
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <button
                  onClick={() => setSelectedEmailId(acc.id)}
                  className="flex items-center gap-2"
                >
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  <span>{acc.email}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                    {acc._count?.offers ?? 0}
                  </span>
                </button>
                <button
                  onClick={() => handleRemoveAccount(acc.id, acc.email)}
                  title="Disconnect account"
                  className="ml-1 text-slate-400 opacity-0 transition hover:text-rose-600 group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}

            <button
              onClick={() => setShowAddAccountModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 hover:border-indigo-400 hover:text-indigo-600"
            >
              <Plus className="h-3.5 w-3.5" />
              Add another email
            </button>
          </div>
        </section>

        {/* Filter Controls */}
        <section className="mb-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            {/* Search Input */}
            <div className="relative md:col-span-4">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search merchant, offer, or code..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-4 text-sm text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none"
              />
            </div>

            {/* Email Account (email_id) Filter */}
            <div className="md:col-span-3">
              <select
                value={selectedEmailId}
                onChange={(e) => setSelectedEmailId(e.target.value)}
                aria-label="Filter by Email ID"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700 focus:border-indigo-500 focus:bg-white focus:outline-none"
              >
                <option value="all">All Email IDs ({accounts.length})</option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.email}
                  </option>
                ))}
              </select>
            </div>

            {/* Expiration Filter */}
            <div className="md:col-span-3">
              <select
                value={expirationFilter}
                onChange={(e) => setExpirationFilter(e.target.value)}
                aria-label="Filter by Expiration"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700 focus:border-indigo-500 focus:bg-white focus:outline-none"
              >
                <option value="active">Active & Non-Expired</option>
                <option value="expiring_soon">Expiring Soon (≤ 7 days)</option>
                <option value="no_expiry">No Expiration Date</option>
                <option value="all">All (Including Expired)</option>
              </select>
            </div>

            {/* Code Only Toggle */}
            <div className="flex items-center justify-between gap-2 md:col-span-2">
              <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-medium text-slate-700 select-none hover:bg-slate-100 w-full justify-center">
                <input
                  type="checkbox"
                  checked={codeOnly}
                  onChange={(e) => setCodeOnly(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span>Code Only</span>
              </label>
            </div>
          </div>

          {/* Categories Pill Bar + View Toggle */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 inline-flex items-center gap-1 text-xs font-medium text-slate-500">
                <Filter className="h-3.5 w-3.5" />
                Category:
              </span>
              {CATEGORIES.map((category) => (
                <button
                  key={category}
                  onClick={() => setSelectedCategory(category)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    selectedCategory === category
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
              <button
                onClick={() => setGroupByMerchant(true)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  groupByMerchant
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Layers className="h-3.5 w-3.5" />
                By Merchant
              </button>
              <button
                onClick={() => setGroupByMerchant(false)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  !groupByMerchant
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                All Cards
              </button>
            </div>
          </div>
        </section>

        {/* Offers Listing */}
        {loading ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <div
                key={n}
                className="h-64 animate-pulse rounded-2xl border border-slate-200 bg-white p-6"
              />
            ))}
          </div>
        ) : offers.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center shadow-sm">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <Tag className="h-6 w-6" />
            </div>
            <h3 className="text-base font-semibold text-slate-900">
              No matching offers found
            </h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
              Try clearing some filters or click &ldquo;Manual Refresh&rdquo; to scan the
              last 30 days of promotional emails across your connected accounts.
            </p>
          </div>
        ) : groupByMerchant ? (
          <div className="space-y-8">
            {offersByMerchant.map(([merchantName, merchantOffers]) => {
              const sample = merchantOffers[0];
              return (
                <div key={merchantName} className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <MerchantAvatar
                        name={merchantName}
                        logo={sample.merchantLogo}
                        size="sm"
                      />
                      <h2 className="text-base font-bold text-slate-900">
                        {merchantName}
                      </h2>
                      <span className="rounded-full bg-slate-200/80 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                        {merchantOffers.length}{' '}
                        {merchantOffers.length === 1 ? 'offer' : 'offers'}
                      </span>
                    </div>

                    <button
                      onClick={() => handleDismissByMerchant(merchantName)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Dismiss All {merchantName}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {merchantOffers.map((offer) => (
                      <OfferCard
                        key={offer.id}
                        offer={offer}
                        copiedId={copiedId}
                        onCopyCode={handleCopyCode}
                        onDismiss={handleDismissOffer}
                        onDismissMerchant={handleDismissByMerchant}
                        formatExpiry={formatExpiry}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {clubbedOffers.map((offer) => (
              <OfferCard
                key={offer.id}
                offer={offer}
                copiedId={copiedId}
                onCopyCode={handleCopyCode}
                onDismiss={handleDismissOffer}
                onDismissMerchant={handleDismissByMerchant}
                formatExpiry={formatExpiry}
              />
            ))}
          </div>
        )}
      </main>

      {/* Connect Email Account Modal */}
      {showAddAccountModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h3 className="text-base font-bold text-slate-900">
                Connect an Email Account
              </h3>
              <button
                onClick={() => setShowAddAccountModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <p className="text-xs text-slate-500">
                Grant read-only access to scan the last 30 days of promotional emails. You can connect as many Gmail accounts as you like.
              </p>
              <a
                href="/api/accounts/google"
                className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
              >
                <Mail className="h-4 w-4" />
                Connect Gmail with Google OAuth
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Scan Logs & Diagnostics Modal */}
      {showLogsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h3 className="text-base font-bold text-slate-900">
                Recent Scan Logs & Error Diagnostics
              </h3>
              <button
                onClick={() => setShowLogsModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 max-h-96 space-y-3 overflow-y-auto">
              {recentLogs.length === 0 ? (
                <p className="text-xs text-slate-500">No scan logs recorded yet.</p>
              ) : (
                recentLogs.map((log) => (
                  <div
                    key={log.id}
                    className={`rounded-xl border p-3.5 text-xs ${
                      log.status === 'failed'
                        ? 'border-rose-200 bg-rose-50/70 text-rose-900'
                        : 'border-slate-200 bg-slate-50 text-slate-800'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 font-semibold">
                      <span>
                        {log.triggerType.toUpperCase()} —{' '}
                        <span
                          className={
                            log.status === 'failed'
                              ? 'text-rose-600'
                              : 'text-emerald-600'
                          }
                        >
                          {log.status.toUpperCase()}
                        </span>
                      </span>
                      <span className="text-slate-500 font-normal">
                        {new Date(log.startedAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-4 text-[11px] text-slate-600">
                      <span>Accounts scanned: {log.accountsScanned}</span>
                      <span>Emails processed: {log.emailsProcessed}</span>
                      <span>New offers found: {log.offersExtracted}</span>
                    </div>
                    {log.errorMessage && (
                      <pre className="mt-2 whitespace-pre-wrap break-all rounded-lg bg-rose-100/80 p-2.5 font-mono text-[11px] text-rose-900">
                        {log.errorMessage}
                      </pre>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MerchantAvatar({
  name,
  logo,
  size = 'md',
}: {
  name: string;
  logo: string | null;
  size?: 'sm' | 'md';
}) {
  const [imgError, setImgError] = useState(false);
  const dimensions = size === 'sm' ? 'h-8 w-8' : 'h-12 w-12';

  if (!logo || imgError) {
    return (
      <div
        className={`flex ${dimensions} shrink-0 items-center justify-center rounded-xl bg-indigo-100 font-bold text-indigo-700`}
      >
        {name.slice(0, 2).toUpperCase()}
      </div>
    );
  }

  return (
    <div
      className={`flex ${dimensions} shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={logo}
        alt={`${name} logo`}
        onError={() => setImgError(true)}
        className="h-full w-full object-contain"
      />
    </div>
  );
}

function OfferCard({
  offer,
  copiedId,
  onCopyCode,
  onDismiss,
  onDismissMerchant,
  formatExpiry,
}: {
  offer: ClubbedOffer;
  copiedId: string | null;
  onCopyCode: (id: string, code: string) => void;
  onDismiss: (offerIds: string[]) => void;
  onDismissMerchant: (merchantName: string) => void;
  formatExpiry: (exp: string | null) => { label: string; urgent: boolean };
}) {
  const expiry = formatExpiry(offer.expiresAt);

  return (
    <div className="group relative flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      {/* Top Row: Merchant Logo + Name + Dismiss actions */}
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <MerchantAvatar name={offer.merchantName} logo={offer.merchantLogo} />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-900">{offer.merchantName}</h3>
                {offer.discountValue && (
                  <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                    {offer.discountValue}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                  {offer.category}
                </span>
                {offer.emailAccounts.length > 1 && (
                  <span className="inline-block rounded bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                    In {offer.emailAccounts.length} inboxes
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => onDismissMerchant(offer.merchantName)}
              title={`Dismiss all offers from ${offer.merchantName}`}
              className="rounded-lg px-2 py-1 text-[11px] font-medium text-slate-400 opacity-0 transition hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100"
            >
              Dismiss merchant
            </button>
            <button
              onClick={() => onDismiss(offer.offerIds)}
              title="Dismiss this offer from listing"
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Offer Title & Description */}
        <h4 className="mt-4 text-sm font-semibold text-slate-900 leading-snug">
          {offer.title}
        </h4>
        {offer.description && (
          <p className="mt-1 line-clamp-2 text-xs text-slate-500">
            {offer.description}
          </p>
        )}
      </div>

      {/* Bottom Area: Promo Code + Metadata */}
      <div className="mt-5 space-y-3 pt-2">
        {offer.promoCode ? (
          <div className="flex items-center justify-between rounded-xl border border-dashed border-indigo-300 bg-indigo-50/60 px-3.5 py-2">
            <div>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-indigo-500">
                Promo Code
              </span>
              <span className="font-mono text-sm font-bold tracking-wide text-indigo-950">
                {offer.promoCode}
              </span>
            </div>
            <button
              onClick={() => onCopyCode(offer.id, offer.promoCode!)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700"
            >
              {copiedId === offer.id ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </>
              )}
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3.5 py-2 text-xs text-slate-500">
            <span>Auto-applied via offer link (No code needed)</span>
            {offer.offerUrl && (
              <a
                href={offer.offerUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:underline"
              >
                Shop
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        )}

        {/* Footer Meta: Email ID badges + Expiration */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
          <div className="flex flex-wrap items-center gap-1.5">
            {offer.emailAccounts.map((acc) => (
              <span
                key={acc.id}
                className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 max-w-[175px] truncate"
                title={`Received in ${acc.email}`}
              >
                <Mail className="h-2.5 w-2.5 text-slate-400 shrink-0" />
                <span className="truncate">{acc.email}</span>
              </span>
            ))}
          </div>

          <span
            className={`inline-flex items-center gap-1 font-medium ${
              expiry.urgent ? 'text-amber-600' : 'text-slate-500'
            }`}
          >
            <Calendar className="h-3 w-3" />
            {expiry.label}
          </span>
        </div>
      </div>
    </div>
  );
}
