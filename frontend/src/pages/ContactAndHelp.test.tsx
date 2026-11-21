// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ContactPage } from './ContactPage';
import { HelpPage } from './HelpPage';
import { schoolRequests } from '../api';
import { setLang } from '../i18n';

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

window.scrollTo = vi.fn();
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

vi.mock('../api', () => ({
  schoolRequests: {
    requestSchool: vi.fn(),
  },
}));

describe('ContactPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setLang('en');
  });

  afterEach(() => {
    cleanup();
  });

  it('renders verified support information and business hours', () => {
    render(
      <MemoryRouter>
        <ContactPage />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { level: 1, name: /Contact Us/i })).toBeDefined();
    expect(screen.getByText('Business Hours')).toBeDefined();
    expect(screen.getByText('Operating Company')).toBeDefined();
    expect(screen.getByText('School Store Retail by Colorbenz')).toBeDefined();
  });

  it('validates 10-digit mobile number before submitting school request', async () => {
    render(
      <MemoryRouter>
        <ContactPage />
      </MemoryRouter>
    );

    const schoolInput = screen.getByLabelText(/School Name \*/i);
    const cityInput = screen.getByLabelText(/City or Town \*/i);
    const phoneInput = screen.getByLabelText(/Mobile Number \*/i);
    const submitBtn = screen.getByRole('button', { name: /Submit School Request/i });

    fireEvent.change(schoolInput, { target: { value: 'Kendriya Vidyalaya' } });
    fireEvent.change(cityInput, { target: { value: 'Surat' } });
    fireEvent.change(phoneInput, { target: { value: '12345' } }); // invalid 5 digits

    fireEvent.click(submitBtn);

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toContain('10-digit Indian mobile number');
    });
    expect(schoolRequests.requestSchool).not.toHaveBeenCalled();
  });

  it('submits a valid school request and displays success confirmation', async () => {
    vi.mocked(schoolRequests.requestSchool).mockResolvedValueOnce({
      id: 101,
      school_name: 'Delhi Public School',
      city_name: 'Surat',
      status: 'PENDING',
    } as any);

    render(
      <MemoryRouter>
        <ContactPage />
      </MemoryRouter>
    );

    const schoolInput = screen.getByLabelText(/School Name \*/i);
    const cityInput = screen.getByLabelText(/City or Town \*/i);
    const phoneInput = screen.getByLabelText(/Mobile Number \*/i);
    const submitBtn = screen.getByRole('button', { name: /Submit School Request/i });

    fireEvent.change(schoolInput, { target: { value: 'Delhi Public School' } });
    fireEvent.change(cityInput, { target: { value: 'Surat' } });
    fireEvent.change(phoneInput, { target: { value: '9825012345' } });

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(schoolRequests.requestSchool).toHaveBeenCalledWith({
        school_name: 'Delhi Public School',
        city_name: 'Surat',
        phone: '9825012345',
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Request Received!')).toBeDefined();
      expect(
        screen.getByText(/Thank you! We have recorded your request for Delhi Public School in Surat\./i)
      ).toBeDefined();
    });
  });

  it('renders correctly in Gujarati and Hindi', () => {
    setLang('gu');
    const { unmount } = render(
      <MemoryRouter>
        <ContactPage />
      </MemoryRouter>
    );
    expect(screen.getByText('કામકાજનો સમય')).toBeDefined();
    expect(screen.getByRole('heading', { level: 1, name: /સંપર્ક કરો/i })).toBeDefined();
    unmount();

    setLang('hi');
    render(
      <MemoryRouter>
        <ContactPage />
      </MemoryRouter>
    );
    expect(screen.getByText('कामकाज का समय')).toBeDefined();
    expect(screen.getByRole('heading', { level: 1, name: /संपर्क करें/i })).toBeDefined();
  });
});

describe('HelpPage', () => {
  beforeEach(() => {
    setLang('en');
  });

  afterEach(() => {
    cleanup();
  });

  it('renders topics navigation and FAQ items', () => {
    render(
      <MemoryRouter>
        <HelpPage />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { level: 1, name: /Help & FAQs/i })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'All Topics' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Size & Fit' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Delivery & Pickup' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Payment & COD' })).toBeDefined();
  });

  it('expands FAQ answer when clicking question and toggles aria-expanded', async () => {
    render(
      <MemoryRouter>
        <HelpPage />
      </MemoryRouter>
    );

    const questionBtn = screen.getByRole('button', {
      name: /How do I choose the right size for my child\?/i,
    });
    expect(questionBtn.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(questionBtn);

    expect(questionBtn.getAttribute('aria-expanded')).toBe('true');
    await waitFor(() => {
      expect(
        screen.getByText(/Measure your child's height, chest, and waist in centimeters/i)
      ).toBeDefined();
    });

    fireEvent.click(questionBtn);
    expect(questionBtn.getAttribute('aria-expanded')).toBe('false');
  });

  it('filters FAQs when clicking a topic tab', () => {
    render(
      <MemoryRouter>
        <HelpPage />
      </MemoryRouter>
    );

    const paymentTab = screen.getByRole('tab', { name: 'Payment & COD' });
    fireEvent.click(paymentTab);

    expect(
      screen.getByText(/Which payment methods are accepted\?/i)
    ).toBeDefined();
    expect(
      screen.queryByText(/How do I choose the right size for my child\?/i)
    ).toBeNull();
  });
});
