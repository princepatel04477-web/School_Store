export type AvailabilityStatus = 'IN_STOCK' | 'OUT_OF_STOCK' | 'RESTOCKING';

export interface BranchAvailability {
  schoolId?: string;
  schoolName?: string;
  state?: string;
  cityName?: string;
  branchId?: string;
  branchName?: string;
  status: AvailabilityStatus;
  restockEta?: string; // ISO date string
  customNotice?: string;
  allowPreorder?: boolean;
  updatedAt?: string;
}

const STORAGE_KEY = 'schoolstore_branch_availability';

// Default availability rules: KV in Surat is IN_STOCK; KV in Punjab and J&K have 24h restock timers by default
const DEFAULT_RULES: BranchAvailability[] = [
  {
    schoolName: 'Kendriya Vidyalaya',
    state: 'Punjab',
    cityName: 'Amritsar',
    status: 'RESTOCKING',
    restockEta: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    customNotice: 'Stock will be available in 24 hours. Pre-order now to secure delivery!',
    allowPreorder: true,
  },
  {
    schoolName: 'Kendriya Vidyalaya',
    state: 'Jammu and Kashmir',
    cityName: 'Jammu',
    status: 'RESTOCKING',
    restockEta: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    customNotice: 'Fresh stock arriving in 24 hours. Pre-order now to reserve your size!',
    allowPreorder: true,
  },
  {
    schoolName: 'Kendriya Vidyalaya',
    state: 'Gujarat',
    cityName: 'Surat',
    status: 'IN_STOCK',
    allowPreorder: true,
  },
];

export function getStoredAvailability(): BranchAvailability[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_RULES));
      return DEFAULT_RULES;
    }
    return JSON.parse(raw);
  } catch {
    return DEFAULT_RULES;
  }
}

export function saveBranchAvailability(rule: BranchAvailability): void {
  try {
    const current = getStoredAvailability();
    const filtered = current.filter(
      (r) =>
        !(
          (rule.branchId && r.branchId === rule.branchId) ||
          (rule.cityName && rule.schoolName && r.cityName?.toLowerCase() === rule.cityName?.toLowerCase() && r.schoolName?.toLowerCase() === rule.schoolName?.toLowerCase()) ||
          (rule.state && rule.schoolName && !rule.cityName && r.state?.toLowerCase() === rule.state?.toLowerCase() && r.schoolName?.toLowerCase() === rule.schoolName?.toLowerCase())
        )
    );
    filtered.push({ ...rule, updatedAt: new Date().toISOString() });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    window.dispatchEvent(new CustomEvent('schoolstore:availability-changed', { detail: rule }));
  } catch {
    // ignore
  }
}

export function checkAvailability(params: {
  schoolName?: string;
  cityName?: string;
  state?: string;
  branchId?: string;
}): BranchAvailability {
  const rules = getStoredAvailability();
  const sName = (params.schoolName || '').toLowerCase();
  const cName = (params.cityName || '').toLowerCase();
  const stName = (params.state || '').toLowerCase();

  // 1. Exact branch match
  if (params.branchId) {
    const match = rules.find((r) => r.branchId === params.branchId);
    if (match) return match;
  }

  // 2. City + School match
  if (cName && sName) {
    const match = rules.find(
      (r) =>
        r.cityName &&
        r.cityName.toLowerCase() === cName &&
        r.schoolName &&
        sName.includes(r.schoolName.toLowerCase())
    );
    if (match) return match;
  }

  // 3. State + School match
  if (stName && sName) {
    const match = rules.find(
      (r) =>
        r.state &&
        r.state.toLowerCase() === stName &&
        r.schoolName &&
        sName.includes(r.schoolName.toLowerCase())
    );
    if (match) return match;
  }

  // 4. Default: In Stock
  return {
    status: 'IN_STOCK',
    allowPreorder: true,
  };
}

export function getRemainingTime(etaIso?: string): {
  totalMs: number;
  hours: number;
  minutes: number;
  seconds: number;
  isExpired: boolean;
  formatted: string;
} {
  if (!etaIso) {
    return { totalMs: 0, hours: 0, minutes: 0, seconds: 0, isExpired: true, formatted: '00:00:00' };
  }
  const diff = new Date(etaIso).getTime() - Date.now();
  if (diff <= 0) {
    return { totalMs: 0, hours: 0, minutes: 0, seconds: 0, isExpired: true, formatted: '00:00:00' };
  }
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');

  return {
    totalMs: diff,
    hours,
    minutes,
    seconds,
    isExpired: false,
    formatted: `${pad(hours)}h : ${pad(minutes)}m : ${pad(seconds)}s`,
  };
}
