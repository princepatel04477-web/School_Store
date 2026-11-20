import { useState } from 'react';
import { Routes, Route, NavLink, Link } from 'react-router-dom';
import { SchoolBuilding, Package, Clock, ArrowRight, Check } from '../components/ui/icons';
import { SchoolManagerView } from '../components/admin/SchoolManagerView';
import { UniformCatalogView } from '../components/admin/UniformCatalogView';
import { CityAvailabilityView } from '../components/admin/CityAvailabilityView';

export default function AdminPortal() {
  return (
    <div className="admin-portal-shell" style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', flexDirection: 'column' }}>
      {/* Top Navbar */}
      <header
        style={{
          background: '#ffffff',
          borderBottom: '1px solid #e2e8f0',
          position: 'sticky',
          top: 0,
          zIndex: 100,
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
        }}
      >
        <div
          style={{
            maxWidth: '1360px',
            margin: '0 auto',
            padding: '14px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '16px',
          }}
        >
          {/* Brand */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '8px',
                background: 'var(--brand, #0e5b38)',
                color: '#ffffff',
                display: 'grid',
                placeItems: 'center',
                fontWeight: 800,
                fontSize: '18px',
                fontFamily: 'var(--font-display, inherit)',
              }}
            >
              SS
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '17px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.01em' }}>
                  SchoolStore Management Portal
                </span>
                <span
                  style={{
                    background: '#ecfdf5',
                    color: '#065f46',
                    fontSize: '11px',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '9999px',
                    border: '1px solid #a7f3d0',
                  }}
                >
                  LIVE SYSTEM
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>
                Dedicated School, Uniform & 24h Stock Controller (Syncs App & Web)
              </p>
            </div>
          </div>

          {/* Quick External Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Link
              to="/shop"
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--brand, #0e5b38)',
                background: 'var(--brand-tint, #ecfdf5)',
                padding: '8px 14px',
                borderRadius: '6px',
                textDecoration: 'none',
                border: '1px solid #a7f3d0',
              }}
            >
              <span>View Customer Storefront</span>
              <ArrowRight width={14} height={14} />
            </Link>
          </div>
        </div>

        {/* Portal Navigation Tabs */}
        <nav
          style={{
            maxWidth: '1360px',
            margin: '0 auto',
            padding: '0 24px',
            display: 'flex',
            gap: '8px',
            overflowX: 'auto',
          }}
        >
          <NavLink
            to=""
            end
            style={({ isActive }) => ({
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 18px',
              fontSize: '14px',
              fontWeight: 700,
              textDecoration: 'none',
              color: isActive ? 'var(--brand, #0e5b38)' : '#64748b',
              borderBottom: isActive ? '3px solid var(--brand, #0e5b38)' : '3px solid transparent',
              transition: 'all 0.15s ease',
            })}
          >
            <Clock width={17} height={17} />
            <span>City Stock & 24h Timers</span>
          </NavLink>

          <NavLink
            to="uniforms"
            style={({ isActive }) => ({
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 18px',
              fontSize: '14px',
              fontWeight: 700,
              textDecoration: 'none',
              color: isActive ? 'var(--brand, #0e5b38)' : '#64748b',
              borderBottom: isActive ? '3px solid var(--brand, #0e5b38)' : '3px solid transparent',
              transition: 'all 0.15s ease',
            })}
          >
            <Package width={17} height={17} />
            <span>Uniform Items & Sets</span>
          </NavLink>

          <NavLink
            to="schools"
            style={({ isActive }) => ({
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 18px',
              fontSize: '14px',
              fontWeight: 700,
              textDecoration: 'none',
              color: isActive ? 'var(--brand, #0e5b38)' : '#64748b',
              borderBottom: isActive ? '3px solid var(--brand, #0e5b38)' : '3px solid transparent',
              transition: 'all 0.15s ease',
            })}
          >
            <SchoolBuilding width={17} height={17} />
            <span>Schools & Campuses</span>
          </NavLink>
        </nav>
      </header>

      {/* Main Content Area */}
      <main style={{ flex: 1, maxWidth: '1360px', width: '100%', margin: '0 auto', padding: '28px 24px' }}>
        <Routes>
          <Route index element={<CityAvailabilityView />} />
          <Route path="uniforms" element={<UniformCatalogView />} />
          <Route path="schools" element={<SchoolManagerView />} />
        </Routes>
      </main>

      {/* Footer */}
      <footer style={{ background: '#ffffff', borderTop: '1px solid #e2e8f0', padding: '16px 24px', textAlign: 'center', fontSize: '13px', color: '#94a3b8' }}>
        © 2025 School Store Operations Portal · All changes propagate live to Mobile App and Website
      </footer>
    </div>
  );
}
