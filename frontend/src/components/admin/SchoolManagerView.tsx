import { useState, useMemo, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { portalApi, type CitySchool } from '../../api';
import { Search, Plus, X, SchoolBuilding } from '../ui/icons';
import { seedClasses } from '../../data/seedData';

const CLASS_GROUPS = ['Pre-primary', 'Primary', 'Middle', 'Secondary'] as const;
const CLASS_ORDER = seedClasses.map((c) => c.name);

/** "All classes", "Class 1 to Class 5", or the classes listed. */
export function classesSummary(names: string[] | undefined): string {
  if (!names || names.length === 0) return 'All classes';
  const sorted = [...names].sort((a, b) => CLASS_ORDER.indexOf(a) - CLASS_ORDER.indexOf(b));
  if (sorted.length === CLASS_ORDER.length) return 'All classes';
  if (sorted.length === 1) return sorted[0];
  const first = CLASS_ORDER.indexOf(sorted[0]);
  const unbroken = sorted.every((name, i) => CLASS_ORDER.indexOf(name) === first + i);
  return unbroken ? `${sorted[0]} to ${sorted[sorted.length - 1]}` : sorted.join(', ');
}

export function SchoolManagerView() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState<string>('all');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingSchool, setEditingSchool] = useState<CitySchool | null>(null);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');

  // Form Fields
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [cityId, setCityId] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [homeDelivery, setHomeDelivery] = useState(true);
  const [schoolPickup, setSchoolPickup] = useState(true);
  const [active, setActive] = useState(true);
  const [commissionRate, setCommissionRate] = useState('');
  const [address, setAddress] = useState('');
  // Classes this school has. None ticked: the shop shows every class.
  const [grades, setGrades] = useState<string[]>([]);
  const toggleGrade = (name: string) =>
    setGrades((current) => (current.includes(name) ? current.filter((g) => g !== name) : [...current, name]));

  // Fetch Cities
  const { data: citiesData } = useQuery({
    queryKey: ['portal-cities'],
    queryFn: () => portalApi.cities(),
  });
  const cities = citiesData?.results ?? [];

  // Fetch Schools
  const queryParams = useMemo(() => {
    const p: Record<string, string> = { page_size: '50' };
    if (search.trim()) p.search = search.trim();
    if (cityFilter) p.city = cityFilter;
    if (activeFilter === 'active') p.active = 'true';
    if (activeFilter === 'inactive') p.active = 'false';
    return p;
  }, [search, cityFilter, activeFilter]);

  const { data: schoolsData, isLoading, error } = useQuery({
    queryKey: ['portal-schools', queryParams],
    queryFn: () => portalApi.schools(queryParams),
  });
  const schools = schoolsData?.results ?? [];
  // A store server from before this feature sends no classes and would ignore them,
  // so the picker only shows once the server sends them.
  const serverHasClasses = schools.some((sch) => Array.isArray(sch.grades));

  const openCreateModal = () => {
    setEditingSchool(null);
    setName('');
    setCode('');
    setCityId(cities[0]?.id || '');
    setLogoUrl('');
    setHomeDelivery(true);
    setSchoolPickup(true);
    setActive(true);
    setCommissionRate('');
    setAddress('');
    setGrades([]);
    setFormError('');
    setFormSuccess('');
    setModalOpen(true);
  };

  const openEditModal = (sch: CitySchool) => {
    setEditingSchool(sch);
    setName(sch.name);
    setCode(sch.code);
    setCityId(sch.city || '');
    setLogoUrl(sch.logo_url || '');
    setHomeDelivery(sch.home_delivery_enabled);
    setSchoolPickup(sch.school_pickup_enabled);
    setActive(sch.active);
    setCommissionRate(sch.commission_rate || '');
    setAddress(sch.address || '');
    setGrades(sch.grades ?? []);
    setFormError('');
    setFormSuccess('');
    setModalOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!homeDelivery && !schoolPickup) {
        throw new Error('A school must offer home delivery, school pickup, or both.');
      }
      const payload: Partial<CitySchool> = {
        name: name.trim(),
        code: code.trim().toUpperCase(),
        city: cityId || undefined,
        logo_url: logoUrl.trim() || null,
        home_delivery_enabled: homeDelivery,
        school_pickup_enabled: schoolPickup,
        active,
        address: address.trim(),
        commission_rate: commissionRate.trim() ? commissionRate.trim() : null,
        ...(serverHasClasses ? { grades: [...grades].sort((a, b) => CLASS_ORDER.indexOf(a) - CLASS_ORDER.indexOf(b)) } : {}),
      };

      if (editingSchool) {
        return portalApi.updateSchool(editingSchool.id, payload);
      } else {
        return portalApi.addSchool(payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal-schools'] });
      setFormSuccess(editingSchool ? 'School updated successfully.' : 'School created successfully.');
      setTimeout(() => {
        setModalOpen(false);
        setFormSuccess('');
      }, 600);
    },
    onError: (err: any) => {
      setFormError(err instanceof Error ? err.message : 'Failed to save school.');
    },
  });

  const softDeleteMutation = useMutation({
    mutationFn: (schoolId: string) => portalApi.deleteSchool(schoolId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal-schools'] });
    },
  });

  const activateMutation = useMutation({
    mutationFn: (schoolId: string) => portalApi.updateSchool(schoolId, { active: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal-schools'] });
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');
    saveMutation.mutate();
  };

  return (
    <div>
      <div className="portal-page-header">
        <div>
          <h1 className="portal-page-title">Schools & Campuses</h1>
          <p className="portal-page-sub">
            Manage partner schools, branch codes, delivery fulfillment methods, and active status.
          </p>
        </div>
        <button type="button" className="portal-btn portal-btn-primary" onClick={openCreateModal}>
          <Plus width={16} height={16} />
          <span>Add New School</span>
        </button>
      </div>

      <div className="portal-card">
        {/* Filter controls */}
        <div className="portal-filters-row">
          <div className="portal-search-box">
            <Search width={16} height={16} className="portal-search-icon" />
            <input
              type="text"
              placeholder="Search by school name or code..."
              className="portal-search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select
            className="portal-select"
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
          >
            <option value="">All Cities</option>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.code})
              </option>
            ))}
          </select>

          <select
            className="portal-select"
            value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value)}
          >
            <option value="all">All Status</option>
            <option value="active">Active Only</option>
            <option value="inactive">Inactive Only</option>
          </select>
        </div>

        {/* Content Table */}
        {isLoading ? (
          <div>
            <div className="portal-skeleton-row" />
            <div className="portal-skeleton-row" />
            <div className="portal-skeleton-row" />
          </div>
        ) : error ? (
          <div className="portal-alert-error">
            Failed to load schools: {error instanceof Error ? error.message : 'Unknown error'}
          </div>
        ) : schools.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--ink-soft)' }}>
            <SchoolBuilding width={36} height={36} style={{ margin: '0 auto 12px', opacity: 0.5 }} />
            <div style={{ fontWeight: 600, fontSize: '15px' }}>No schools found</div>
            <div style={{ fontSize: '13px', marginTop: '4px' }}>
              Try adjusting your search query or city filters.
            </div>
          </div>
        ) : (
          <div className="portal-table-container">
            <table className="portal-table">
              <thead>
                <tr>
                  <th>School Name</th>
                  <th>Code</th>
                  <th>City</th>
                  {serverHasClasses && <th>Classes</th>}
                  <th>Fulfillment Options</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {schools.map((sch) => (
                  <tr key={sch.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {sch.logo_url ? (
                          <img
                            src={sch.logo_url}
                            alt={sch.name}
                            style={{
                              width: '28px',
                              height: '28px',
                              objectFit: 'contain',
                              borderRadius: 'var(--radius-sm)',
                              border: '1px solid var(--line)',
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: '28px',
                              height: '28px',
                              borderRadius: 'var(--radius-sm)',
                              background: 'var(--paper-sunk)',
                              display: 'grid',
                              placeItems: 'center',
                              fontSize: '11px',
                              fontWeight: 700,
                              color: 'var(--ink-soft)',
                            }}
                          >
                            {sch.code.slice(0, 2)}
                          </div>
                        )}
                        <div>
                          <div style={{ fontWeight: 700 }}>{sch.name}</div>
                          {sch.address && (
                            <div style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>
                              {sch.address.slice(0, 45)}
                              {sch.address.length > 45 ? '...' : ''}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <code style={{ fontSize: '12px', fontWeight: 600 }}>{sch.code}</code>
                    </td>
                    <td>{sch.city_name || '-'}</td>
                    {serverHasClasses && <td className="portal-classes-cell">{classesSummary(sch.grades)}</td>}
                    <td>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {sch.home_delivery_enabled && (
                          <span
                            style={{
                              fontSize: '11px',
                              background: '#eff6ff',
                              color: '#1d4ed8',
                              border: '1px solid #bfdbfe',
                              borderRadius: 'var(--radius-sm)',
                              padding: '1px 6px',
                            }}
                          >
                            Home Delivery
                          </span>
                        )}
                        {sch.school_pickup_enabled && (
                          <span
                            style={{
                              fontSize: '11px',
                              background: '#fef3c7',
                              color: '#b45309',
                              border: '1px solid #fde68a',
                              borderRadius: 'var(--radius-sm)',
                              padding: '1px 6px',
                            }}
                          >
                            School Pickup
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      {sch.active ? (
                        <span className="portal-badge-active">Active</span>
                      ) : (
                        <span className="portal-badge-inactive">Inactive</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '6px' }}>
                        <button
                          type="button"
                          className="portal-btn portal-btn-secondary portal-btn-sm"
                          onClick={() => openEditModal(sch)}
                        >
                          Edit
                        </button>
                        {sch.active ? (
                          <button
                            type="button"
                            className="portal-btn portal-btn-danger portal-btn-sm"
                            onClick={() => softDeleteMutation.mutate(sch.id)}
                            title="Set school active to false"
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="portal-btn portal-btn-secondary portal-btn-sm"
                            onClick={() => activateMutation.mutate(sch.id)}
                            style={{ color: '#065f46' }}
                          >
                            Reactivate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit School Modal */}
      {modalOpen && (
        <div className="portal-modal-backdrop">
          <div className="portal-modal">
            <div className="portal-modal-header">
              <h2 className="portal-modal-title">
                {editingSchool ? 'Edit School' : 'Add New School'}
              </h2>
              <button
                type="button"
                className="portal-btn portal-btn-secondary portal-btn-sm"
                onClick={() => setModalOpen(false)}
                aria-label="Close"
              >
                <X width={16} height={16} />
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="portal-modal-body">
                {formError && <div className="portal-alert-error">{formError}</div>}
                {formSuccess && <div className="portal-alert-success">{formSuccess}</div>}

                <div className="portal-form-group">
                  <label className="portal-form-label">School Name *</label>
                  <input
                    type="text"
                    required
                    className="portal-form-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Kendriya Vidyalaya No. 1"
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className="portal-form-group">
                    <label className="portal-form-label">School Code *</label>
                    <input
                      type="text"
                      required
                      className="portal-form-input"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder="e.g. KV-01"
                    />
                  </div>

                  <div className="portal-form-group">
                    <label className="portal-form-label">City *</label>
                    <select
                      className="portal-form-input"
                      value={cityId}
                      onChange={(e) => setCityId(e.target.value)}
                    >
                      <option value="">No City Assigned</option>
                      {cities.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.code})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {serverHasClasses && (
                <fieldset className="portal-form-group portal-classes-field">
                  <legend className="portal-form-label">Classes this school has</legend>
                  <p className="portal-classes-hint">
                    The shop lists only the ticked classes for this school. None ticked: every class is listed.
                  </p>
                  <div className="portal-classes-actions">
                    <button type="button" className="portal-btn portal-btn-secondary portal-btn-sm" onClick={() => setGrades([...CLASS_ORDER])}>
                      All
                    </button>
                    <button type="button" className="portal-btn portal-btn-secondary portal-btn-sm" onClick={() => setGrades([])}>
                      Clear
                    </button>
                    <span className="portal-classes-count">{classesSummary(grades)}</span>
                  </div>
                  {CLASS_GROUPS.map((group) => (
                    <div key={group} className="portal-classes-group">
                      <span className="portal-classes-group-name">{group}</span>
                      <div className="portal-classes-chips">
                        {seedClasses
                          .filter((c) => c.group === group)
                          .map((c) => (
                            <label key={c.id} className={`portal-class-chip ${grades.includes(c.name) ? 'is-on' : ''}`}>
                              <input type="checkbox" checked={grades.includes(c.name)} onChange={() => toggleGrade(c.name)} />
                              <span>{c.name}</span>
                            </label>
                          ))}
                      </div>
                    </div>
                  ))}
                </fieldset>
                )}

                <div className="portal-form-group">
                  <label className="portal-form-label">Logo URL</label>
                  <input
                    type="url"
                    className="portal-form-input"
                    value={logoUrl}
                    onChange={(e) => setLogoUrl(e.target.value)}
                    placeholder="https://... (direct image URL)"
                  />
                </div>

                <div className="portal-form-group">
                  <label className="portal-form-label">Address</label>
                  <input
                    type="text"
                    className="portal-form-input"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Campus address / street"
                  />
                </div>

                <div className="portal-form-group">
                  <label className="portal-form-label">Commission Rate (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    className="portal-form-input"
                    value={commissionRate}
                    onChange={(e) => setCommissionRate(e.target.value)}
                    placeholder="e.g. 10.00"
                  />
                </div>

                <div className="portal-form-group" style={{ marginTop: '8px' }}>
                  <label className="portal-form-label">Fulfillment Methods *</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={homeDelivery}
                        onChange={(e) => setHomeDelivery(e.target.checked)}
                      />
                      <span>Allow Home Delivery to Parents</span>
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={schoolPickup}
                        onChange={(e) => setSchoolPickup(e.target.checked)}
                      />
                      <span>Allow Campus / School Pickup</span>
                    </label>
                  </div>
                </div>

                <div className="portal-form-group" style={{ marginTop: '4px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={(e) => setActive(e.target.checked)}
                    />
                    <span>Active School (visible in directory)</span>
                  </label>
                </div>
              </div>

              <div className="portal-modal-footer">
                <button
                  type="button"
                  className="portal-btn portal-btn-secondary"
                  onClick={() => setModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="portal-btn portal-btn-primary"
                  disabled={saveMutation.isPending}
                >
                  {saveMutation.isPending ? 'Saving...' : editingSchool ? 'Save Changes' : 'Create School'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
