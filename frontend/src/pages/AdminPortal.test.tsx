// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminPortal from './AdminPortal';
import { UniformCatalogView } from '../components/admin/UniformCatalogView';
import { portalApi } from '../api';

// Mock auth hook
const mockUser = {
  current: null as any,
  loading: false,
};

vi.mock('../auth', () => ({
  useAuth: () => ({
    user: mockUser.current,
    loading: mockUser.loading,
    signOut: vi.fn(),
  }),
}));

import { useAuth } from '../auth';
import { homeFor } from '../App';

function TestGuard({ children, roles }: { children: React.ReactNode; roles?: string[] }) {
  const { user, loading } = useAuth();
  if (loading) return <div>Loading...</div>;
  if (!user) return <div>Redirected to /login</div>;
  if (roles && !roles.includes(user.role)) return <div>Redirected to {homeFor(user.role)}</div>;
  return <>{children}</>;
}

function renderWithProviders(ui: React.ReactElement, initialEntries = ['/portal']) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        {ui}
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('Uniform Portal Frontend Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.current = null;
    mockUser.loading = false;
  });

  afterEach(() => {
    cleanup();
  });

  it('/portal redirects to sign-in when signed out', () => {
    mockUser.current = null;

    renderWithProviders(
      <Routes>
        <Route
          path="/portal/*"
          element={
            <TestGuard roles={['BOSS', 'ADMIN']}>
              <AdminPortal />
            </TestGuard>
          }
        />
        <Route path="/login" element={<div>Sign In Page</div>} />
      </Routes>
    );

    expect(screen.getByText('Redirected to /login')).toBeTruthy();
  });

  it('/portal refuses a PARENT and redirects to parent home', () => {
    mockUser.current = {
      id: 'parent-123',
      username: 'test_parent',
      role: 'PARENT',
    };

    renderWithProviders(
      <Routes>
        <Route
          path="/portal/*"
          element={
            <TestGuard roles={['BOSS', 'ADMIN']}>
              <AdminPortal />
            </TestGuard>
          }
        />
      </Routes>
    );

    expect(screen.getByText('Redirected to /parent')).toBeTruthy();
  });

  it('/portal renders successfully for BOSS and displays navigation tabs', async () => {
    mockUser.current = {
      id: 'boss-123',
      username: 'test_boss',
      role: 'BOSS',
    };

    vi.spyOn(portalApi, 'products').mockResolvedValue({
      results: [],
      next: null,
      previous: null,
    } as any);

    vi.spyOn(portalApi, 'categories').mockResolvedValue({
      results: [
        { id: 'cat-1', name: 'Uniforms', slug: 'uniforms', display_order: 1, active: true },
      ],
      next: null,
      previous: null,
    } as any);

    vi.spyOn(portalApi, 'schools').mockResolvedValue({
      results: [],
      next: null,
      previous: null,
    } as any);

    renderWithProviders(
      <Routes>
        <Route
          path="/portal/*"
          element={
            <TestGuard roles={['BOSS', 'ADMIN']}>
              <AdminPortal />
            </TestGuard>
          }
        />
      </Routes>
    );

    expect(screen.getByText('Uniform Operations Portal')).toBeTruthy();
    expect(screen.getAllByText('Uniform Catalogue').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Schools & Campuses')).toBeTruthy();
    expect(screen.getByText('City Stock & Availability')).toBeTruthy();
  });

  it('catalogue form sends the right payload and shows the API error message', async () => {
    mockUser.current = {
      id: 'boss-123',
      username: 'test_boss',
      role: 'BOSS',
    };

    vi.spyOn(portalApi, 'categories').mockResolvedValue({
      results: [
        { id: 'cat-1', name: 'Uniforms', slug: 'uniforms', display_order: 1, active: true },
      ],
      next: null,
      previous: null,
    } as any);

    vi.spyOn(portalApi, 'schools').mockResolvedValue({
      results: [
        { id: 'sch-1', name: 'Kendriya Vidyalaya', code: 'KV-01', active: true } as any,
      ],
      next: null,
      previous: null,
    } as any);

    vi.spyOn(portalApi, 'products').mockResolvedValue({
      results: [],
      next: null,
      previous: null,
    } as any);

    // Mock createProduct rejection with specific API error
    const createSpy = vi.spyOn(portalApi, 'createProduct').mockRejectedValueOnce(
      new Error('A class range is only valid on school-specific items.')
    );

    renderWithProviders(<UniformCatalogView />);

    // Open add item modal
    const addButton = await screen.findByRole('button', { name: /Add Uniform Item/i });
    fireEvent.click(addButton);

    // Fill in required fields
    const nameInput = screen.getByPlaceholderText('e.g. KV Summer Boys Half Sleeve Shirt');
    fireEvent.change(nameInput, { target: { value: 'KV Track Pants' } });

    const priceInput = screen.getByPlaceholderText('e.g. 399.00');
    fireEvent.change(priceInput, { target: { value: '450.00' } });

    // Submit form
    const submitBtn = screen.getByRole('button', { name: /Create Product/i });
    fireEvent.click(submitBtn);

    // Verify payload sent
    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'KV Track Pants',
          selling_price: '450.00',
          active: true,
        })
      );
    });

    // Verify error message is rendered
    expect(
      await screen.findByText('A class range is only valid on school-specific items.')
    ).toBeTruthy();
  });

  it('renders Delete button for uniform items and invokes deleteProduct API', async () => {
    mockUser.current = {
      id: 'boss-123',
      username: 'test_boss',
      role: 'BOSS',
    };

    vi.spyOn(portalApi, 'categories').mockResolvedValue({
      results: [{ id: 'cat-1', name: 'Uniforms', slug: 'uniforms', display_order: 1, active: true }],
      next: null,
      previous: null,
    } as any);

    vi.spyOn(portalApi, 'schools').mockResolvedValue({
      results: [],
      next: null,
      previous: null,
    } as any);

    vi.spyOn(portalApi, 'products').mockResolvedValue({
      results: [
        {
          id: 'prod-delete-test',
          name: 'Deletable Blazer',
          selling_price: '599.00',
          active: true,
          category: 'cat-1',
          gender: 'unisex',
          variants: [],
          images: [],
        },
      ],
      next: null,
      previous: null,
    } as any);

    const deleteSpy = vi.spyOn(portalApi, 'deleteProduct').mockResolvedValue(undefined as any);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderWithProviders(<UniformCatalogView />);

    const deleteButton = await screen.findByRole('button', { name: /^Delete$/i });
    expect(deleteButton).toBeTruthy();

    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith('prod-delete-test');
    });
  });

  it('verifies grep find nothing for localStorage in admin components and portal page', () => {
    const adminModules = import.meta.glob<string>(
      ['../components/admin/**/*.tsx', '../components/admin/**/*.ts', './AdminPortal.tsx'],
      { query: '?raw', import: 'default', eager: true }
    );

    const matches: string[] = [];
    for (const [file, content] of Object.entries(adminModules)) {
      if (typeof content === 'string' && content.includes('localStorage')) {
        matches.push(file);
      }
    }

    expect(matches).toEqual([]);
  });
});
