import { useState, useMemo, useEffect, useRef, type FormEvent, type ChangeEvent } from 'react';
import {
  type PortalSchool,
  getPortalSchools,
  savePortalSchool,
  deletePortalSchool,
  readFileAsDataUrl,
  PORTAL_EVENT,
} from '../../data/portalStore';
import { Plus, Search, Check, SchoolBuilding, AlertCircle } from '../ui/icons';
import { SchoolCrest } from '../school/SchoolCrest';

export function SchoolManagerView() {
  const [schools, setSchools] = useState<PortalSchool[]>(getPortalSchools);
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [city, setCity] = useState('Surat');
  const [state, setState] = useState('Gujarat');
  const [homeDelivery, setHomeDelivery] = useState(true);
  const [schoolPickup, setSchoolPickup] = useState(true);
  const [logoPreview, setLogoPreview] = useState<string>('');
  const [logoFileName, setLogoFileName] = useState<string>('');
  const [uploadLoading, setUploadLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const refresh = () => setSchools(getPortalSchools());
    window.addEventListener(PORTAL_EVENT, refresh);
    return () => window.removeEventListener(PORTAL_EVENT, refresh);
  }, []);

  const displayedSchools = useMemo(() => {
    const q = search.trim().toLowerCase();
    return schools.filter(
      (s) =>
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q) ||
        s.city.toLowerCase().includes(q)
    );
  }, [schools, search]);

  const openCreateModal = () => {
    setEditingId(null);
    setName('');
    setCode('');
    setCity('Surat');
    setState('Gujarat');
    setHomeDelivery(true);
    setSchoolPickup(true);
    setLogoPreview('');
    setLogoFileName('');
    setIsModalOpen(true);
  };

  const openEditModal = (school: PortalSchool) => {
    setEditingId(school.id);
    setName(school.name);
    setCode(school.code);
    setCity(school.city);
    setState(school.state || 'Gujarat');
    setHomeDelivery(school.homeDelivery);
    setSchoolPickup(school.schoolPickup);
    setLogoPreview(school.logoUrl || '');
    setLogoFileName('');
    setIsModalOpen(true);
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploadLoading(true);
      setLogoFileName(file.name);
      const dataUrl = await readFileAsDataUrl(file, 600);
      setLogoPreview(dataUrl);
    } catch {
      alert('Could not read image file. Please choose a valid PNG, JPG, or SVG.');
    } finally {
      setUploadLoading(false);
    }
  };

  const handleDelete = (id: string, schoolName: string) => {
    if (window.confirm(`Are you sure you want to delete "${schoolName}" and all associated branch records?`)) {
      const updated = deletePortalSchool(id);
      setSchools(updated);
      setSuccessMsg(`Deleted "${schoolName}" from portal.`);
      setTimeout(() => setSuccessMsg(null), 3500);
    }
  };

  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const newSchool: PortalSchool = {
      id: editingId || `sch-${Date.now()}`,
      name: name.trim(),
      code: code.trim().toUpperCase() || name.slice(0, 3).toUpperCase(),
      city: city.trim(),
      state: state.trim() || 'Gujarat',
      logoUrl: logoPreview || undefined,
      homeDelivery,
      schoolPickup,
      active: true,
    };

    const updated = savePortalSchool(newSchool);
    setSchools(updated);
    setIsModalOpen(false);
    setSuccessMsg(
      editingId
        ? `School "${newSchool.name}" successfully updated. Synced live across mobile application and website!`
        : `School "${newSchool.name}" successfully added. Synced live across mobile application and website!`
    );
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  return (
    <div className="panel-view">
      <div className="page-head" style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div className="eyebrow" style={{ color: 'var(--brand, #0e5b38)', fontWeight: 700, letterSpacing: '0.06em', fontSize: '12px' }}>
            CAMPUS ONBOARDING & NETWORK
          </div>
          <h1 style={{ fontSize: '24px', margin: '4px 0 8px', color: '#0f172a', fontWeight: 800 }}>
            Schools & Campus Management
          </h1>
          <p className="muted" style={{ fontSize: '14px', color: '#64748b', margin: 0 }}>
            Add new school institutions, upload school crest logos directly from your computer, configure delivery options, and publish live.
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

      {/* Search Input */}
      <div style={{ background: '#ffffff', padding: '16px', borderRadius: '10px', border: '1px solid #e2e8f0', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '8px 12px' }}>
          <Search width={16} height={16} style={{ color: '#94a3b8' }} />
          <input
            type="text"
            placeholder="Search campuses by name, school code, or city..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: '100%', border: 'none', outline: 'none', fontSize: '14px' }}
          />
        </div>
      </div>

      {/* Schools Table */}
      <div style={{ background: '#ffffff', borderRadius: '10px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: '12px', letterSpacing: '0.04em' }}>
              <th style={{ padding: '14px 18px' }}>CREST / LOGO</th>
              <th style={{ padding: '14px 18px' }}>SCHOOL NAME</th>
              <th style={{ padding: '14px 18px' }}>CODE</th>
              <th style={{ padding: '14px 18px' }}>CITY & STATE</th>
              <th style={{ padding: '14px 18px' }}>DELIVERY OPTIONS</th>
              <th style={{ padding: '14px 18px', textAlign: 'right' }}>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {displayedSchools.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: '48px 24px', textAlign: 'center', color: '#94a3b8' }}>
                  <SchoolBuilding width={36} height={36} style={{ margin: '0 auto 8px', opacity: 0.5 }} />
                  <p style={{ margin: 0, fontWeight: 600 }}>No schools found matching your search.</p>
                </td>
              </tr>
            ) : (
              displayedSchools.map((school) => (
                <tr key={school.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '14px 18px' }}>
                    {school.logoUrl ? (
                      <img
                        src={school.logoUrl}
                        alt={school.name}
                        width={46}
                        height={46}
                        style={{ borderRadius: '8px', objectFit: 'contain', border: '1px solid #e2e8f0', background: '#fafafa' }}
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).src = '/brand/schools/dps.svg';
                        }}
                      />
                    ) : (
                      <SchoolCrest id={school.id} name={school.name} code={school.code} size={46} />
                    )}
                  </td>
                  <td style={{ padding: '14px 18px' }}>
                    <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '15px' }}>{school.name}</div>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>ID: {school.id}</div>
                  </td>
                  <td style={{ padding: '14px 18px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, background: '#f1f5f9', color: '#334155', padding: '3px 8px', borderRadius: '4px' }}>
                      {school.code}
                    </span>
                  </td>
                  <td style={{ padding: '14px 18px', color: '#334155', fontWeight: 600 }}>
                    {school.city}{school.state ? `, ${school.state}` : ''}
                  </td>
                  <td style={{ padding: '14px 18px' }}>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {school.homeDelivery && (
                        <span style={{ fontSize: '11px', background: '#ecfdf5', color: '#065f46', padding: '2px 8px', borderRadius: '9999px', fontWeight: 700 }}>
                          ✓ Home Delivery
                        </span>
                      )}
                      {school.schoolPickup && (
                        <span style={{ fontSize: '11px', background: '#eff6ff', color: '#1d4ed8', padding: '2px 8px', borderRadius: '9999px', fontWeight: 700 }}>
                          ✓ School Counter
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => openEditModal(school)}
                        style={{
                          padding: '6px 12px',
                          borderRadius: '6px',
                          border: '1px solid #cbd5e1',
                          background: '#ffffff',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          color: '#334155',
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(school.id, school.name)}
                        style={{
                          padding: '6px 12px',
                          borderRadius: '6px',
                          border: '1px solid #fecaca',
                          background: '#fff5f5',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          color: '#ef4444',
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add / Edit School Modal */}
      {isModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.55)', display: 'grid', placeItems: 'center', zIndex: 999, padding: '16px' }}>
          <form onSubmit={handleSave} style={{ background: '#ffffff', width: '100%', maxWidth: '540px', borderRadius: '14px', padding: '28px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)' }}>
            <h2 style={{ fontSize: '20px', margin: '0 0 6px', color: '#0f172a', fontWeight: 800 }}>
              {editingId ? 'Edit School Campus' : 'Onboard New School Campus'}
            </h2>
            <p style={{ margin: '0 0 20px', fontSize: '13px', color: '#64748b' }}>
              Publish this school live to both the mobile application and website catalog.
            </p>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>SCHOOL NAME</label>
              <input
                type="text"
                required
                placeholder="e.g. Kendriya Vidyalaya No. 1"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1.5px solid #cbd5e1', fontSize: '14px', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '14px', marginBottom: '16px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>SCHOOL CODE / ABBREVIATION</label>
                <input
                  type="text"
                  placeholder="e.g. KV-01"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1.5px solid #cbd5e1', fontSize: '14px', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>PRIMARY CITY</label>
                <input
                  type="text"
                  placeholder="e.g. Surat, Amritsar"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1.5px solid #cbd5e1', fontSize: '14px', boxSizing: 'border-box' }}
                />
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>STATE / REGION</label>
              <select
                value={state}
                onChange={(e) => setState(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1.5px solid #cbd5e1', fontSize: '14px', fontWeight: 600 }}
              >
                <option value="Gujarat">Gujarat</option>
                <option value="Punjab">Punjab</option>
                <option value="Jammu and Kashmir">Jammu and Kashmir</option>
                <option value="Delhi">Delhi</option>
                <option value="Haryana">Haryana</option>
                <option value="Rajasthan">Rajasthan</option>
                <option value="Uttar Pradesh">Uttar Pradesh</option>
                <option value="Himachal Pradesh">Himachal Pradesh</option>
                <option value="Chandigarh">Chandigarh</option>
                <option value="Ladakh">Ladakh</option>
                <option value="Uttarakhand">Uttarakhand</option>
              </select>
            </div>

            {/* COMPUTER IMAGE UPLOAD FOR SCHOOL LOGO */}
            <div style={{ marginBottom: '20px', background: '#f8fafc', padding: '18px', borderRadius: '10px', border: '1.5px dashed #cbd5e1' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#0f172a', marginBottom: '6px' }}>
                🏫 UPLOAD SCHOOL CREST / LOGO FROM COMPUTER
              </label>
              <p style={{ margin: '0 0 14px', fontSize: '12px', color: '#64748b' }}>
                Upload school emblem image file (PNG, JPG, SVG, WebP).
              </p>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/png, image/jpeg, image/jpg, image/webp, image/svg+xml"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />

              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                <div
                  style={{
                    width: '68px',
                    height: '68px',
                    borderRadius: '8px',
                    border: '1.5px solid #e2e8f0',
                    background: '#ffffff',
                    display: 'grid',
                    placeItems: 'center',
                    overflow: 'hidden',
                  }}
                >
                  {logoPreview ? (
                    <img src={logoPreview} alt="Logo preview" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  ) : (
                    <SchoolBuilding width={28} height={28} style={{ color: '#cbd5e1' }} />
                  )}
                </div>

                <div style={{ flex: 1, minWidth: '200px' }}>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadLoading}
                    style={{
                      background: 'var(--brand, #0e5b38)',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '9px 16px',
                      fontSize: '13px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <span>{uploadLoading ? 'Reading…' : logoPreview ? 'Choose Different Logo' : 'Select Logo from Computer'}</span>
                  </button>

                  {logoFileName && (
                    <div style={{ fontSize: '12px', color: '#059669', fontWeight: 600, marginTop: '6px' }}>
                      ✓ Selected file: {logoFileName}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div style={{ marginBottom: '22px', display: 'flex', gap: '20px', background: '#f8fafc', padding: '12px 16px', borderRadius: '8px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
                <input type="checkbox" checked={homeDelivery} onChange={(e) => setHomeDelivery(e.target.checked)} />
                <span>Home Delivery Available</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
                <input type="checkbox" checked={schoolPickup} onChange={(e) => setSchoolPickup(e.target.checked)} />
                <span>School Counter Pickup</span>
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                style={{ padding: '10px 18px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#ffffff', cursor: 'pointer', fontWeight: 600 }}
              >
                Cancel
              </button>
              <button
                type="submit"
                style={{ padding: '10px 22px', borderRadius: '8px', border: 'none', background: 'var(--brand, #0e5b38)', color: '#ffffff', cursor: 'pointer', fontWeight: 700 }}
              >
                {editingId ? 'Update School' : 'Create School'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
