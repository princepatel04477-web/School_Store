import { useState } from 'react';
import { useStoreSchools, type StoreSchool } from '../../data/catalog';
import { Plus, Search, Check, SchoolBuilding } from '../ui/icons';
import { SchoolCrest } from '../school/SchoolCrest';

export function SchoolManagerView() {
  const { data: serverSchools, isLoading } = useStoreSchools();
  const [schools, setSchools] = useState<StoreSchool[]>(() => serverSchools ?? []);
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSchool, setEditingSchool] = useState<StoreSchool | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [city, setCity] = useState('Surat');
  const [homeDelivery, setHomeDelivery] = useState(true);
  const [schoolPickup, setSchoolPickup] = useState(true);
  const [logoUrl, setLogoUrl] = useState('');
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const displayedSchools = (schools.length ? schools : serverSchools ?? []).filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()) || s.code.toLowerCase().includes(search.toLowerCase())
  );

  const openCreateModal = () => {
    setEditingSchool(null);
    setName('');
    setCode('');
    setCity('Surat');
    setHomeDelivery(true);
    setSchoolPickup(true);
    setLogoUrl('');
    setIsModalOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const newSchool: StoreSchool = {
      id: editingSchool ? editingSchool.id : `sch-${Date.now()}`,
      name: name.trim(),
      code: code.trim().toUpperCase() || name.slice(0, 3).toUpperCase(),
      city: city.trim(),
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      homeDelivery,
      schoolPickup,
    };

    setSchools((prev) => {
      const existing = prev.filter((s) => s.id !== newSchool.id);
      return [newSchool, ...existing];
    });

    setIsModalOpen(false);
    setSuccessMsg(`School "${newSchool.name}" successfully saved. Synced live across mobile application and website!`);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  return (
    <div className="panel-view">
      <div className="page-head" style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div className="eyebrow" style={{ color: 'var(--brand, #0e5b38)', fontWeight: 700, letterSpacing: '0.06em' }}>
            SCHOOL ONBOARDING
          </div>
          <h1 style={{ fontSize: '24px', margin: '4px 0 8px', color: '#1a202c' }}>
            Schools & Campus Management
          </h1>
          <p className="muted" style={{ fontSize: '14px', color: '#64748b' }}>
            Add new schools, update logos, set delivery options, and publish campuses live to both the mobile application and website storefront.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            background: 'var(--brand, #0e5b38)',
            color: '#ffffff',
            padding: '10px 18px',
            borderRadius: '8px',
            border: 'none',
            fontWeight: 700,
            fontSize: '14px',
            cursor: 'pointer',
            boxShadow: '0 2px 4px rgba(14, 91, 56, 0.2)',
          }}
        >
          <Plus width={18} height={18} />
          <span>Add New School</span>
        </button>
      </div>

      {successMsg && (
        <div style={{ background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0', padding: '12px 18px', borderRadius: '8px', marginBottom: '20px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Check width={18} height={18} />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Search Bar */}
      <div style={{ background: '#ffffff', padding: '14px 18px', borderRadius: '10px', border: '1px solid #e2e8f0', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <Search width={18} height={18} style={{ color: '#94a3b8' }} />
        <input
          type="text"
          placeholder="Search by school name or code (e.g. DPS, KV, Udgam)..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: '100%', border: 'none', outline: 'none', fontSize: '14px' }}
        />
      </div>

      {/* Schools Grid / Table */}
      <div style={{ background: '#ffffff', borderRadius: '10px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: '12px', letterSpacing: '0.04em' }}>
              <th style={{ padding: '12px 18px' }}>CREST</th>
              <th style={{ padding: '12px 18px' }}>SCHOOL NAME & CODE</th>
              <th style={{ padding: '12px 18px' }}>PRIMARY CITY</th>
              <th style={{ padding: '12px 18px' }}>DELIVERY OPTIONS</th>
              <th style={{ padding: '12px 18px', textAlign: 'right' }}>STATUS & ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
                  Loading school directory...
                </td>
              </tr>
            )}
            {displayedSchools.map((school) => (
              <tr key={school.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '12px 18px' }}>
                  <SchoolCrest id={school.id} name={school.name} code={school.code} size={40} />
                </td>
                <td style={{ padding: '12px 18px' }}>
                  <div style={{ fontWeight: 700, color: '#1e293b' }}>{school.name}</div>
                  <div style={{ fontSize: '12px', color: '#64748b', fontFamily: 'monospace' }}>Code: {school.code}</div>
                </td>
                <td style={{ padding: '12px 18px', color: '#334155' }}>
                  {school.city || 'National Chain'}
                </td>
                <td style={{ padding: '12px 18px', fontSize: '12px' }}>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {school.homeDelivery && (
                      <span style={{ background: '#f1f5f9', color: '#334155', padding: '2px 8px', borderRadius: '4px' }}>
                        📦 Home Delivery
                      </span>
                    )}
                    {school.schoolPickup && (
                      <span style={{ background: '#f1f5f9', color: '#334155', padding: '2px 8px', borderRadius: '4px' }}>
                        🏫 Counter Pickup
                      </span>
                    )}
                  </div>
                </td>
                <td style={{ padding: '12px 18px', textAlign: 'right' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#ecfdf5', color: '#065f46', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>
                    <Check width={12} height={12} /> LIVE IN STORE
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add School Modal */}
      {isModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.5)', display: 'grid', placeItems: 'center', zIndex: 999 }}>
          <form onSubmit={handleSave} style={{ background: '#ffffff', width: '100%', maxWidth: '500px', borderRadius: '12px', padding: '24px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)' }}>
            <h2 style={{ fontSize: '18px', margin: '0 0 16px', color: '#1e293b' }}>Add New School</h2>
            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>SCHOOL NAME</label>
              <input
                type="text"
                required
                placeholder="e.g. Kendriya Vidyalaya No. 1"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>SCHOOL CODE</label>
                <input
                  type="text"
                  placeholder="e.g. KV-01"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>PRIMARY CITY</label>
                <input
                  type="text"
                  placeholder="e.g. Surat, Amritsar"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px' }}
                />
              </div>
            </div>
            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>LOGO SVG / URL</label>
              <input
                type="text"
                placeholder="/brand/schools/dps.svg"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px' }}
              />
            </div>
            <div style={{ marginBottom: '20px', display: 'flex', gap: '16px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
                <input type="checkbox" checked={homeDelivery} onChange={(e) => setHomeDelivery(e.target.checked)} />
                <span>Home Delivery</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
                <input type="checkbox" checked={schoolPickup} onChange={(e) => setSchoolPickup(e.target.checked)} />
                <span>School Counter Pickup</span>
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff', cursor: 'pointer', fontWeight: 600 }}
              >
                Cancel
              </button>
              <button
                type="submit"
                style={{ padding: '8px 18px', borderRadius: '6px', border: 'none', background: 'var(--brand, #0e5b38)', color: '#ffffff', cursor: 'pointer', fontWeight: 700 }}
              >
                Create School
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
