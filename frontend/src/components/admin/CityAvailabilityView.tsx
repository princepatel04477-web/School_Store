import { useState, useMemo, useEffect } from 'react';
import {
  type BranchAvailability,
  type AvailabilityStatus,
  getStoredAvailability,
  saveBranchAvailability,
  getRemainingTime,
} from '../../data/availability';
import { getPortalSchools, PORTAL_EVENT } from '../../data/portalStore';
import { Clock, Check, Plus, AlertCircle } from '../ui/icons';

interface CityRow {
  schoolName: string;
  state: string;
  cityName: string;
}

const DEFAULT_CITIES: CityRow[] = [
  { schoolName: 'Kendriya Vidyalaya', state: 'Gujarat', cityName: 'Surat' },
  { schoolName: 'Kendriya Vidyalaya', state: 'Gujarat', cityName: 'Ahmedabad' },
  { schoolName: 'Kendriya Vidyalaya', state: 'Punjab', cityName: 'Amritsar' },
  { schoolName: 'Kendriya Vidyalaya', state: 'Punjab', cityName: 'Ludhiana' },
  { schoolName: 'Kendriya Vidyalaya', state: 'Jammu and Kashmir', cityName: 'Jammu' },
  { schoolName: 'Kendriya Vidyalaya', state: 'Jammu and Kashmir', cityName: 'Srinagar' },
  { schoolName: 'Kendriya Vidyalaya', state: 'Delhi', cityName: 'Delhi Cantt' },
  { schoolName: 'Kendriya Vidyalaya', state: 'Haryana', cityName: 'Gurugram' },
  { schoolName: 'Kendriya Vidyalaya', state: 'Rajasthan', cityName: 'Jaipur' },
  { schoolName: 'Delhi Public School Surat', state: 'Gujarat', cityName: 'Surat' },
  { schoolName: 'Fountainhead School Surat', state: 'Gujarat', cityName: 'Surat' },
  { schoolName: 'Udgam School for Children', state: 'Gujarat', cityName: 'Ahmedabad' },
];

export function CityAvailabilityView() {
  const [rules, setRules] = useState<BranchAvailability[]>(getStoredAvailability);
  const [portalSchools, setPortalSchools] = useState(getPortalSchools);
  const [selectedSchool, setSelectedSchool] = useState<string>('Kendriya Vidyalaya');
  const [selectedState, setSelectedState] = useState<string>('ALL');
  const [editingTarget, setEditingTarget] = useState<CityRow | null>(null);
  const [modalStatus, setModalStatus] = useState<AvailabilityStatus>('RESTOCKING');
  const [hoursOffset, setHoursOffset] = useState<number>(24);
  const [customNotice, setCustomNotice] = useState<string>('Stock will be available in 24 hours. Pre-order now to secure delivery!');
  const [allowPreorder, setAllowPreorder] = useState<boolean>(true);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => {
      setRules(getStoredAvailability());
      setPortalSchools(getPortalSchools());
    };
    window.addEventListener(PORTAL_EVENT, refresh);
    return () => window.removeEventListener(PORTAL_EVENT, refresh);
  }, []);

  const allCities: CityRow[] = useMemo(() => {
    const customRows: CityRow[] = portalSchools.map((s) => ({
      schoolName: s.name,
      state: s.state || 'Gujarat',
      cityName: s.city,
    }));
    const combined = [...DEFAULT_CITIES];
    for (const c of customRows) {
      if (!combined.some((row) => row.schoolName === c.schoolName && row.cityName === c.cityName)) {
        combined.push(c);
      }
    }
    return combined;
  }, [portalSchools]);

  const schools = useMemo(() => Array.from(new Set(allCities.map((c) => c.schoolName))), [allCities]);
  const states = useMemo(() => Array.from(new Set(allCities.filter((c) => c.schoolName === selectedSchool).map((c) => c.state))), [allCities, selectedSchool]);

  const filteredCities = useMemo(() => {
    return allCities.filter(
      (c) => c.schoolName === selectedSchool && (selectedState === 'ALL' || c.state === selectedState)
    );
  }, [allCities, selectedSchool, selectedState]);

  const getRuleForCity = (cityName: string, state: string) => {
    return rules.find(
      (r) =>
        r.schoolName?.toLowerCase() === selectedSchool.toLowerCase() &&
        (r.cityName?.toLowerCase() === cityName.toLowerCase() || (r.state?.toLowerCase() === state.toLowerCase() && !r.cityName))
    );
  };

  const openConfigModal = (city: CityRow) => {
    setEditingTarget(city);
    const existing = getRuleForCity(city.cityName, city.state);
    if (existing) {
      setModalStatus(existing.status);
      setCustomNotice(existing.customNotice || 'Stock will be available in 24 hours. Pre-order now to secure delivery!');
      setAllowPreorder(existing.allowPreorder ?? true);
    } else {
      setModalStatus('RESTOCKING');
      setCustomNotice('Stock will be available in 24 hours. Pre-order now to secure delivery!');
      setAllowPreorder(true);
    }
    setHoursOffset(24);
  };

  const handleSaveRule = () => {
    if (!editingTarget) return;
    const etaDate = new Date(Date.now() + hoursOffset * 60 * 60 * 1000).toISOString();
    const newRule: BranchAvailability = {
      schoolName: editingTarget.schoolName,
      state: editingTarget.state,
      cityName: editingTarget.cityName,
      status: modalStatus,
      restockEta: modalStatus === 'RESTOCKING' ? etaDate : undefined,
      customNotice: modalStatus === 'RESTOCKING' ? customNotice : undefined,
      allowPreorder,
    };
    saveBranchAvailability(newRule);
    setRules(getStoredAvailability());
    setEditingTarget(null);
    setSuccessMsg(`Updated availability for ${editingTarget.cityName} (${editingTarget.state}). Changes synced live to mobile app and website.`);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  const setQuickStatus = (city: CityRow, status: AvailabilityStatus) => {
    const etaDate = status === 'RESTOCKING' ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : undefined;
    const newRule: BranchAvailability = {
      schoolName: city.schoolName,
      state: city.state,
      cityName: city.cityName,
      status,
      restockEta: etaDate,
      customNotice: status === 'RESTOCKING' ? 'Stock will be available in 24 hours. Pre-order now to secure delivery!' : undefined,
      allowPreorder: true,
    };
    saveBranchAvailability(newRule);
    setRules(getStoredAvailability());
    setSuccessMsg(`Set ${city.cityName} to ${status.replace('_', ' ')}. Reflected in mobile app & website.`);
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  const handleBulkState = (targetState: string, status: AvailabilityStatus) => {
    const etaDate = status === 'RESTOCKING' ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : undefined;
    DEFAULT_CITIES.filter((c) => c.schoolName === selectedSchool && c.state === targetState).forEach((c) => {
      saveBranchAvailability({
        schoolName: c.schoolName,
        state: c.state,
        cityName: c.cityName,
        status,
        restockEta: etaDate,
        customNotice: status === 'RESTOCKING' ? 'Stock will be available in 24 hours. Pre-order now!' : undefined,
        allowPreorder: true,
      });
    });
    setRules(getStoredAvailability());
    setSuccessMsg(`Applied ${status.replace('_', ' ')} across all ${targetState} branches for ${selectedSchool}.`);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  return (
    <div className="panel-view">
      <div className="page-head" style={{ marginBottom: '24px' }}>
        <div>
          <div className="eyebrow" style={{ color: 'var(--brand, #0e5b38)', fontWeight: 700, letterSpacing: '0.06em' }}>
            CROSS-PLATFORM INVENTORY CONTROL
          </div>
          <h1 style={{ fontSize: '24px', margin: '4px 0 8px', color: '#1a202c' }}>
            City Stock & 24-Hour Restock Timer Manager
          </h1>
          <p className="muted" style={{ fontSize: '14px', color: '#64748b', maxWidth: '800px' }}>
            Configure whether uniforms are <strong>In Stock</strong>, <strong>Out of Stock</strong>, or showing a live <strong>Restock Countdown Timer</strong> (e.g. 24 Hours) for parents in specific cities. Updates apply instantly to both the mobile application and website storefront from this one portal.
          </p>
        </div>
      </div>

      {successMsg && (
        <div style={{ background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0', padding: '12px 18px', borderRadius: '8px', marginBottom: '20px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Check width={18} height={18} />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Filter Bar */}
      <div style={{ display: 'flex', gap: '16px', background: '#ffffff', padding: '16px', borderRadius: '10px', border: '1px solid #e2e8f0', marginBottom: '24px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
            SELECT SCHOOL CHAIN
          </label>
          <select
            value={selectedSchool}
            onChange={(e) => {
              setSelectedSchool(e.target.value);
              setSelectedState('ALL');
            }}
            style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px', fontWeight: 600, minWidth: '220px' }}
          >
            {schools.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
            FILTER BY STATE
          </label>
          <select
            value={selectedState}
            onChange={(e) => setSelectedState(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px', minWidth: '180px' }}
          >
            <option value="ALL">All States ({states.length})</option>
            {states.map((st) => (
              <option key={st} value={st}>{st}</option>
            ))}
          </select>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', marginRight: '4px' }}>QUICK PRESETS:</span>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '6px 12px', fontSize: '12px', border: '1px solid #e2e8f0', background: '#f8fafc', borderRadius: '6px', cursor: 'pointer' }}
            onClick={() => handleBulkState('Punjab', 'RESTOCKING')}
          >
            Set All Punjab to 24h Timer
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '6px 12px', fontSize: '12px', border: '1px solid #e2e8f0', background: '#f8fafc', borderRadius: '6px', cursor: 'pointer' }}
            onClick={() => handleBulkState('Jammu and Kashmir', 'RESTOCKING')}
          >
            Set All J&K to 24h Timer
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ padding: '6px 12px', fontSize: '12px', background: 'var(--brand, #0e5b38)', color: '#ffffff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
            onClick={() => handleBulkState('Gujarat', 'IN_STOCK')}
          >
            Set All Gujarat In Stock
          </button>
        </div>
      </div>

      {/* Cities Table */}
      <div style={{ background: '#ffffff', borderRadius: '10px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: '12px', letterSpacing: '0.04em' }}>
              <th style={{ padding: '12px 18px' }}>STATE</th>
              <th style={{ padding: '12px 18px' }}>CITY / CAMPUS</th>
              <th style={{ padding: '12px 18px' }}>CURRENT AVAILABILITY</th>
              <th style={{ padding: '12px 18px' }}>CUSTOMER NOTICE / COUNTDOWN</th>
              <th style={{ padding: '12px 18px', textAlign: 'right' }}>QUICK ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {filteredCities.map((city) => {
              const rule = getRuleForCity(city.cityName, city.state);
              const status = rule?.status ?? 'IN_STOCK';
              const remaining = getRemainingTime(rule?.restockEta);

              return (
                <tr key={`${city.state}-${city.cityName}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '14px 18px', fontWeight: 600, color: '#1e293b' }}>
                    {city.state}
                  </td>
                  <td style={{ padding: '14px 18px', color: '#334155' }}>
                    <strong>{city.cityName}</strong>
                  </td>
                  <td style={{ padding: '14px 18px' }}>
                    {status === 'IN_STOCK' ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#ecfdf5', color: '#065f46', padding: '4px 10px', borderRadius: '9999px', fontSize: '12px', fontWeight: 700 }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }} />
                        IN STOCK
                      </span>
                    ) : status === 'RESTOCKING' ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#fffbeb', color: '#b45309', padding: '4px 10px', borderRadius: '9999px', fontSize: '12px', fontWeight: 700 }}>
                        <Clock width={14} height={14} style={{ color: '#d97706' }} />
                        24H RESTOCK TIMER
                      </span>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#fef2f2', color: '#991b1b', padding: '4px 10px', borderRadius: '9999px', fontSize: '12px', fontWeight: 700 }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#ef4444' }} />
                        OUT OF STOCK
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '14px 18px', fontSize: '13px', color: '#475569' }}>
                    {status === 'RESTOCKING' ? (
                      <div>
                        <div style={{ fontWeight: 700, color: '#b45309', fontFamily: 'monospace' }}>
                          ⏱️ {remaining.formatted} left
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>
                          {rule?.customNotice || 'Stock available in 24 hours'}
                        </div>
                      </div>
                    ) : status === 'OUT_OF_STOCK' ? (
                      <span style={{ color: '#991b1b' }}>Ordering disabled for this city</span>
                    ) : (
                      <span style={{ color: '#059669' }}>Parents can order immediately</span>
                    )}
                  </td>
                  <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '6px' }}>
                      <button
                        type="button"
                        onClick={() => setQuickStatus(city, 'IN_STOCK')}
                        style={{
                          padding: '4px 8px',
                          fontSize: '11px',
                          borderRadius: '4px',
                          border: status === 'IN_STOCK' ? '2px solid #10b981' : '1px solid #cbd5e1',
                          background: status === 'IN_STOCK' ? '#ecfdf5' : '#ffffff',
                          color: '#065f46',
                          cursor: 'pointer',
                          fontWeight: 600,
                        }}
                      >
                        In Stock
                      </button>
                      <button
                        type="button"
                        onClick={() => openConfigModal(city)}
                        style={{
                          padding: '4px 8px',
                          fontSize: '11px',
                          borderRadius: '4px',
                          border: status === 'RESTOCKING' ? '2px solid #f59e0b' : '1px solid #cbd5e1',
                          background: status === 'RESTOCKING' ? '#fffbeb' : '#ffffff',
                          color: '#b45309',
                          cursor: 'pointer',
                          fontWeight: 600,
                        }}
                      >
                        Set Timer...
                      </button>
                      <button
                        type="button"
                        onClick={() => setQuickStatus(city, 'OUT_OF_STOCK')}
                        style={{
                          padding: '4px 8px',
                          fontSize: '11px',
                          borderRadius: '4px',
                          border: status === 'OUT_OF_STOCK' ? '2px solid #ef4444' : '1px solid #cbd5e1',
                          background: status === 'OUT_OF_STOCK' ? '#fef2f2' : '#ffffff',
                          color: '#991b1b',
                          cursor: 'pointer',
                          fontWeight: 600,
                        }}
                      >
                        Out of Stock
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Timer Configuration Modal */}
      {editingTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.5)', display: 'grid', placeItems: 'center', zIndex: 999 }}>
          <div style={{ background: '#ffffff', width: '100%', maxWidth: '520px', borderRadius: '12px', padding: '24px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)' }}>
            <h2 style={{ fontSize: '18px', margin: '0 0 4px', color: '#1e293b' }}>
              Configure Restock Timer: {editingTarget.cityName}
            </h2>
            <p style={{ margin: '0 0 18px', fontSize: '13px', color: '#64748b' }}>
              School: <strong>{editingTarget.schoolName}</strong> ({editingTarget.state})
            </p>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                AVAILABILITY STATUS
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {(['IN_STOCK', 'RESTOCKING', 'OUT_OF_STOCK'] as AvailabilityStatus[]).map((st) => (
                  <button
                    type="button"
                    key={st}
                    onClick={() => setModalStatus(st)}
                    style={{
                      flex: 1,
                      padding: '8px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      border: modalStatus === st ? '2px solid var(--brand, #0e5b38)' : '1px solid #cbd5e1',
                      background: modalStatus === st ? 'var(--brand-tint, #ecfdf5)' : '#ffffff',
                      color: modalStatus === st ? 'var(--brand, #0e5b38)' : '#475569',
                    }}
                  >
                    {st === 'IN_STOCK' ? 'In Stock' : st === 'RESTOCKING' ? 'Restock Timer' : 'Out of Stock'}
                  </button>
                ))}
              </div>
            </div>

            {modalStatus === 'RESTOCKING' && (
              <>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                    SET RESTOCK TIME (HOURS FROM NOW)
                  </label>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                    {[12, 24, 48, 72].map((h) => (
                      <button
                        type="button"
                        key={h}
                        onClick={() => setHoursOffset(h)}
                        style={{
                          padding: '6px 12px',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          border: hoursOffset === h ? '2px solid #d97706' : '1px solid #cbd5e1',
                          background: hoursOffset === h ? '#fef3c7' : '#ffffff',
                          color: hoursOffset === h ? '#b45309' : '#475569',
                        }}
                      >
                        {h} Hours
                      </button>
                    ))}
                  </div>
                  <input
                    type="number"
                    min="1"
                    max="720"
                    value={hoursOffset}
                    onChange={(e) => setHoursOffset(Number(e.target.value))}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px' }}
                    placeholder="Custom hours (e.g. 24)"
                  />
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                    CUSTOMER DISPLAY MESSAGE
                  </label>
                  <input
                    type="text"
                    value={customNotice}
                    onChange={(e) => setCustomNotice(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                  />
                  <small style={{ color: '#64748b', fontSize: '11px', display: 'block', marginTop: '4px' }}>
                    Shown directly below the countdown timer on parent mobile app and website.
                  </small>
                </div>

                <div style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, color: '#334155', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={allowPreorder}
                      onChange={(e) => setAllowPreorder(e.target.checked)}
                    />
                    <span>Allow parents to Pre-Order now while countdown is ticking</span>
                  </label>
                </div>
              </>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setEditingTarget(null)}
                style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff', color: '#475569', cursor: 'pointer', fontWeight: 600 }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveRule}
                style={{ padding: '8px 18px', borderRadius: '6px', border: 'none', background: 'var(--brand, #0e5b38)', color: '#ffffff', cursor: 'pointer', fontWeight: 700 }}
              >
                Save & Sync Live
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
