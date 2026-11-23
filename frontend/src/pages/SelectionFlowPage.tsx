import { useState, useMemo, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { Check, ArrowLeft, ChevronRight } from '../components/ui/icons';
import { seedClasses, type SeedClass } from '../data/seedData';
import { useStoreSchools, useStoreProducts } from '../data/catalog';
import { BranchPicker, type PickedBranch } from '../components/school/BranchPicker';
import type { CardProduct } from '../components/product/ProductCard';
import { useStoreState, storeState } from '../store/storeState';
import { resolveFlowStep } from '../store/flowStep';
import { scrollPageTo } from '../motion/SmoothScroll';
import { ProductCard } from '../components/product/ProductCard';
import { frameForImage, type ProductFrame } from '../components/product/ProductImage';
import { ProductSheet } from '../components/product/ProductSheet';
import { IdCardPreview } from '../components/idcard/IdCardPreview';
import { StepTransition } from '../motion/StepTransition';
import { Thread } from '../motion/Thread';
import { Stagger, Reveal, Hairline, SplitReveal } from '../motion';
import { useLang, type MessageKey } from '../i18n';
import { categoryLabel, classLabel, genderLabel } from '../i18n/labels';
import { ListenButton } from '../components/ListenButton';
import { FullSetSheet } from '../components/product/FullSetSheet';
import { useQuery } from '@tanstack/react-query';
import { ProductGridSkeleton } from '../components/ui/Skeleton';
import { Popup } from '../components/Popup';
import { api } from '../api';
import { useAuth } from '../auth';
import {
  fitKey,
  garmentKind,
  saveMeasurement,
  setFit,
  useFitAnswer,
  useLastSizes,
  useLatestMeasurement,
  useSizeFit,
  type Fit,
} from '../data/fit';
import { isPtUniform, shopSection } from '../data/shopSections';
import { CATEGORY_PHOTOS } from '../data/categoryPhotos';
import { LIVE_CATEGORIES, isCategoryLive } from '../data/liveCategories';

// Shoes and tie, belt and socks share one Accessories row under Uniform.
const ACCESSORY_CATEGORIES: readonly string[] = LIVE_CATEGORIES.filter((cat) => cat === 'School Shoes' || cat === 'Uniform Accessories');
const OTHER_CATEGORIES = LIVE_CATEGORIES.filter((cat) => cat !== 'Uniform' && !ACCESSORY_CATEGORIES.includes(cat));

export type AccessoryChip = 'all' | 'shoes' | 'tie' | 'belt' | 'socks';

function getAccessoryType(product: { name: string; category: string }): 'shoes' | 'tie' | 'belt' | 'socks' | null {
  if (product.category === 'School Shoes' || /shoe|oxford|sneaker|footwear/i.test(product.name)) {
    return 'shoes';
  }
  if (/\b(?:tie|necktie)\b/i.test(product.name)) {
    return 'tie';
  }
  if (/belt\b/i.test(product.name)) {
    return 'belt';
  }
  if (/sock|socks/i.test(product.name)) {
    return 'socks';
  }
  return null;
}
import { useBackHandler } from '../components/BackButton';
import { CategoryPhoto } from '../components/CategoryPhoto';
import './flow.css';

// Memory only (nothing is saved on the phone): asked once per page load or app open.
let stationeryAsked = false;

const GROUP_KEYS: Record<string, MessageKey> = {
  'Pre-primary': 'grp.preprimary',
  Primary: 'grp.primary',
  Middle: 'grp.middle',
  Secondary: 'grp.secondary',
};

/** "Add the matching …" names the item it opens: a girl's shirt matches a skirt, not a trouser. */
function matchLabelKey(name: string): MessageKey {
  if (/skirt|pinafore/i.test(name)) return 'match.addSkirt';
  if (/shorts/i.test(name)) return 'match.addShorts';
  if (/kurta|kameez/i.test(name)) return 'match.addKurta';
  return garmentKind(name) === 'bottom' ? 'match.addBottom' : 'match.addTop';
}

/** Kept on each shop history entry: the step the entry before it shows. */
type FlowEntryState = { fromStep?: number };

export function SelectionFlowPage({ onOpenBag }: { onOpenBag?: () => void }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { selection, setSelection, cart, clearCart } = useStoreState();
  const { t } = useLang();
  const [fullSetOpen, setFullSetOpen] = useState(false);

  const [stepDirection, setStepDirection] = useState<'forward' | 'backward'>('forward');

  // Selected School, Class, and Gender State
  // Read URL params or fallback to active stored selection. A link to another school
  // does not inherit the class and boy/girl chosen for the saved school.
  const linkedSchoolId = searchParams.get('school');
  const savedAnswers = !linkedSchoolId || linkedSchoolId === selection?.schoolId ? selection : null;
  const genderParam = searchParams.get('gender');
  const activeSchoolId = linkedSchoolId || selection?.schoolId || '';
  const activeClassId = searchParams.get('class') || savedAnswers?.gradeId || '';
  const activeGender = genderParam === 'boy' || genderParam === 'girl' ? genderParam : savedAnswers?.gender || null;

  const schoolsQuery = useStoreSchools();
  const schools = useMemo(() => schoolsQuery.data ?? [], [schoolsQuery.data]);
  const activeSchool = useMemo(
    () => schools.find((s) => s.id === activeSchoolId) || null,
    [schools, activeSchoolId]
  );
  // The classes this school has, as chosen in the uniform portal. None chosen: every class.
  const offeredClasses = useMemo(() => {
    const names = activeSchool?.grades;
    return names && names.length > 0 ? seedClasses.filter((c) => names.includes(c.name)) : seedClasses;
  }, [activeSchool]);
  // A saved or linked class the school no longer has counts as not chosen.
  const activeClass = useMemo(
    () => offeredClasses.find((c) => c.id === activeClassId) || null,
    [offeredClasses, activeClassId]
  );
  // A saved school that has left the store counts as no school; a linked one gets its own message.
  const savedSchoolGone = schoolsQuery.isSuccess && !activeSchool && !linkedSchoolId;
  // The campus the parent picked (state, then city, then branch), kept with the saved choice.
  const activeBranch = selection?.schoolId === activeSchoolId && selection?.branchId ? selection : null;
  // A chain (one uniform, many campuses) has no city of its own, so the parent must pick the branch.
  const needsBranch = Boolean(activeSchool && !activeSchool.cityId && !activeBranch);
  const schoolLabel = activeBranch?.branchName || activeSchool?.name || '';
  const cityLabel = activeBranch?.cityName || activeSchool?.city || '';
  const stepParam = resolveFlowStep(searchParams.get('step'), {
    school: Boolean(activeSchoolId) && !savedSchoolGone && !needsBranch,
    grade: Boolean(activeClass),
    gender: Boolean(activeGender),
  });
  const [currentStep, setCurrentStep] = useState<number>(stepParam);
  const productsQuery = useStoreProducts(
    activeSchool?.id,
    activeClass?.name,
    activeGender,
    activeBranch?.cityId || activeSchool?.cityId
  );
  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data]);

  // The child's measurement (Prompt 21): measured once on any shirt or
  // trouser's size page, it fills them all. Kept per school + class + boy/girl
  // for this visit, and on the child's record when the parent is signed in.
  const currentFitKey = fitKey(activeSchool?.id, activeClass?.id, activeGender);
  const fitAnswer = useFitAnswer(currentFitKey);
  const { user } = useAuth();
  const childrenQuery = useQuery({
    queryKey: ['parent-students'],
    queryFn: () =>
      api<{ results: { id: string; school: string; school_name?: string; grade_name?: string | null; class_name?: string }[] }>(
        '/students/'
      ).catch(() => null),
    enabled: user?.role === 'PARENT',
  });
  const childId = useMemo(() => {
    if (!activeSchool) return null;
    const atSchool = (childrenQuery.data?.results ?? []).filter((kid) => kid.school === activeSchool.id);
    const inClass = atSchool.filter((kid) => (kid.grade_name || kid.class_name) === activeClass?.name);
    const match = inClass.length === 1 ? inClass : atSchool;
    return match.length === 1 ? match[0].id : null;
  }, [childrenQuery.data, activeSchool, activeClass?.name]);
  const savedMeasurement = useLatestMeasurement(childId);
  const lastSizes = useLastSizes(childId).data;
  const measurement: Fit | null =
    fitAnswer && fitAnswer !== 'skipped' ? fitAnswer : savedMeasurement.data ?? null;
  const saveChildMeasurement = async (fit: Fit): Promise<boolean> => {
    setFit(currentFitKey, fit);
    if (!childId) return true; // saved on the child's record with the order
    try {
      await saveMeasurement(childId, fit);
      return true;
    } catch {
      return false;
    }
  };
  const sizedProductIds = useMemo(
    () => products.filter((p) => p.sizes.length > 1).map((p) => p.id),
    [products]
  );
  const sizeFit = useSizeFit(sizedProductIds, measurement, activeClass?.name);
  const fits = sizeFit.data?.products;
  const garments = useMemo(
    () =>
      products
        .filter((p) => p.category === 'Uniform' && p.sizes.length > 1 && garmentKind(p.name))
        .map((p) => ({ id: p.id, name: p.name })),
    [products]
  );

  // The school part of the saved choice: the school, and its branch if one was picked.
  const schoolAnswer = () => ({
    schoolId: activeSchool!.id,
    schoolName: activeSchool!.name,
    schoolCode: activeSchool!.code,
    cityId: activeBranch?.cityId || activeSchool!.cityId,
    cityName: cityLabel,
    stateName: activeBranch?.stateName,
    branchId: activeBranch?.branchId,
    branchName: activeBranch?.branchName,
  });

  // A link from the school (?school=…&class=…) counts as the parent's choice, so the
  // bag and checkout know which school and class the order is for.
  useEffect(() => {
    if (!activeSchool) return;
    if (
      selection?.schoolId === activeSchool.id &&
      selection?.gradeId === activeClass?.id &&
      (selection?.gender ?? null) === activeGender
    ) {
      return;
    }
    setSelection({
      ...schoolAnswer(),
      gradeId: activeClass?.id,
      gradeName: activeClass?.name,
      gender: activeGender,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSchool, activeClass, activeGender]);

  // Cart clear warning state
  const [showCartWarning, setShowCartWarning] = useState(false);
  const [pendingTargetStep, setPendingTargetStep] = useState<number | null>(null);

  // Active Category Tab on Step 4
  // A home page category tile links here with ?cat=…, so open on that category.
  const catParam = searchParams.get('cat');
  const subParam = searchParams.get('sub')?.toLowerCase() as AccessoryChip | undefined;
  const inAccessories = catParam === 'Accessories' || Boolean(catParam && ACCESSORY_CATEGORIES.includes(catParam));
  // A paused category (notebooks, ID cards) opens on Uniform instead, even from an old link.
  const activeTab = inAccessories
    ? 'Accessories'
    : catParam && CATEGORY_PHOTOS[catParam] && isCategoryLive(catParam)
    ? catParam
    : 'Uniform';
  const defaultSub: AccessoryChip = catParam === 'School Shoes' ? 'shoes' : 'all';
  const activeSub: AccessoryChip =
    subParam && ['all', 'shoes', 'tie', 'belt', 'socks'].includes(subParam) ? subParam : defaultSub;

  // Changing category while scrolled down jumps back to the start of that category's list
  const tabsTopRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!tabsTopRef.current) return;
    const top = tabsTopRef.current.getBoundingClientRect().top + window.scrollY - 60;
    if (window.scrollY > top) scrollPageTo(top);
  }, [activeTab]);
  // Kept in the address, so the header's category links and these tabs stay in step
  const selectTab = (cat: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('cat', cat);
        if (cat !== 'Accessories') {
          next.delete('sub');
        }
        return next;
      },
      { replace: true }
    );
  };

  const selectAccessoryChip = (chip: AccessoryChip) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('cat', 'Accessories');
        if (chip === 'all') {
          next.delete('sub');
        } else {
          next.set('sub', chip);
        }
        return next;
      },
      { replace: true }
    );
  };

  // Product Sheet Modal
  const [activeProductForSheet, setActiveProductForSheet] = useState<CardProduct | null>(null);
  // An open product gets its own history entry (?item=), so the phone's back button
  // and the round back button close the product first instead of leaving the list.
  const itemParam = searchParams.get('item');
  const openSheet = (item: CardProduct) => {
    setActiveProductForSheet(item);
    if (itemParam === item.id) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('item', item.id);
        return next;
      },
      { replace: Boolean(itemParam), state: { sheetEntry: true } }
    );
  };
  const closeSheet = () => {
    setActiveProductForSheet(null);
    if (!new URLSearchParams(window.location.search).get('item')) return;
    const entry = (window.history.state as { usr?: { sheetEntry?: boolean } } | null)?.usr;
    if (entry?.sheetEntry) {
      navigate(-1);
      return;
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('item');
        return next;
      },
      { replace: true }
    );
  };
  // The phone's back button took ?item= away: close the product.
  useEffect(() => {
    if (!itemParam) setActiveProductForSheet(null);
  }, [itemParam]);
  // A reloaded page opens on the list, so an ?item= left in the address is dropped.
  useEffect(() => {
    if (!itemParam) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('item');
        return next;
      },
      { replace: true }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After an item goes in the bag, guide the parent on (Prompt 24): the
  // matching shirt or trouser, then shoes, then tie, belt and socks, then
  // the stationery question (once per visit).
  const { cart: bagLines } = useStoreState();
  const [added, setAdded] = useState<{ product: CardProduct; match: CardProduct | null } | null>(null);
  const [askStationery, setAskStationery] = useState(false);
  const nextTab: Record<string, string> = { Uniform: 'School Shoes', 'School Shoes': 'Uniform Accessories' };
  const matchFor = (product: CardProduct): CardProduct | null => {
    const kind = garmentKind(product.name);
    if (!kind) return null;
    const want = kind === 'top' ? 'bottom' : 'top';
    // A shirt pairs with a trouser or skirt; a blazer or sweater is not "the matching shirt".
    const pairs = want === 'bottom' ? /trouser|pant|skirt|shorts|chino/i : /shirt|blouse|kurta|tee\b|polo/i;
    const preferred = want === 'bottom' ? /trouser|pant/i : /shirt/i;
    const candidates = products.filter(
      (p) =>
        shopSection(p) === shopSection(product) && isPtUniform(p) === isPtUniform(product) &&
        p.sizes.length > 1 &&
        garmentKind(p.name) === want &&
        pairs.test(p.name) &&
        p.sizes.some((s) => s.inStock) &&
        !bagLines.some((line) => line.productId === p.id)
    );
    return candidates.find((p) => preferred.test(p.name)) ?? candidates[0] ?? null;
  };
  const handleAdded = (product: CardProduct, fromCard = false) => {
    closeSheet();
    if (isPtUniform(product)) return;
    if (product.category === 'Uniform') {
      setAdded({ product, match: matchFor(product) });
      return;
    }
    if (ACCESSORY_CATEGORIES.includes(product.category) && isCategoryLive('Stationery')) {
      if (!stationeryAsked) {
        setAskStationery(true);
        return;
      }
    }
    // From a card the item just shows its count; from the item's sheet the bag opens.
    if (!fromCard) onOpenBag?.();
  };
  const closeStationery = (goToStationery: boolean) => {
    stationeryAsked = true;
    setAskStationery(false);
    if (goToStationery) selectTab('Stationery');
  };

  // Sync step param
  useEffect(() => {
    if (stepParam !== currentStep) {
      setStepDirection(stepParam > currentStep ? 'forward' : 'backward');
      setCurrentStep(stepParam);
    }
  }, [stepParam]);

  // Write the step shown into this history entry. An address without one opens at the
  // furthest step the saved answers allow, so Back to it used to jump forward again.
  // Built from the live address so it never undoes the school picker's own update.
  const location = useLocation();
  useEffect(() => {
    const live = new URLSearchParams(window.location.search);
    if (live.get('step') === String(stepParam)) return;
    live.set('step', String(stepParam));
    navigate({ search: `?${live}` }, { replace: true, state: location.state });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepParam]);

  const goToStep = (step: number) => {
    setStepDirection(step > currentStep ? 'forward' : 'backward');
    // The previous history entry is that step: go back to it, as the phone's back button
    // would, instead of adding an entry the phone's back button would then return from.
    if ((location.state as FlowEntryState | null)?.fromStep === step) {
      navigate(-1);
      return;
    }
    setCurrentStep(step);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('step', String(step));
      return next;
    }, { state: { fromStep: currentStep } satisfies FlowEntryState });
  };

  const requestStepChange = (targetStep: number) => {
    if (cart.length > 0 && targetStep < 4) {
      setPendingTargetStep(targetStep);
      setShowCartWarning(true);
    } else {
      goToStep(targetStep);
    }
  };

  const handleConfirmCartClear = () => {
    storeState.clearCart();
    setShowCartWarning(false);
    if (pendingTargetStep) {
      goToStep(pendingTargetStep);
      setPendingTargetStep(null);
    }
  };

  const handleSelectBranch = ({ branch, city, state }: PickedBranch) => {
    setSelection({
      schoolId: branch.school.id,
      schoolName: branch.school.name,
      schoolCode: branch.school.code,
      cityId: city.id,
      cityName: city.name,
      stateName: state,
      branchId: branch.id,
      branchName: branch.name,
      gradeId: undefined,
      gradeName: undefined,
      gender: null,
    });
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('school', branch.school.id);
      next.delete('class');
      next.delete('gender');
      next.set('step', '2');
      return next;
    }, { state: { fromStep: 1 } satisfies FlowEntryState });
  };

  // "Show all schools" on a picker opened for one school (from the home page search).
  const clearLinkedSchool = () => {
    setSelection(null);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('school');
      next.delete('class');
      next.delete('gender');
      next.set('step', '1');
      return next;
    });
  };

  const handleSelectClass = (cls: SeedClass) => {
    if (activeSchool) {
      setSelection({
        ...schoolAnswer(),
        gradeId: cls.id,
        gradeName: cls.name,
        gender: null,
      });
    }
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('class', cls.id);
      next.delete('gender');
      next.set('step', '3');
      return next;
    }, { state: { fromStep: 2 } satisfies FlowEntryState });
  };

  const handleSelectGender = (gender: 'boy' | 'girl') => {
    if (activeSchool && activeClass) {
      setSelection({
        ...schoolAnswer(),
        gradeId: activeClass.id,
        gradeName: activeClass.name,
        gender,
      });
    }
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('gender', gender);
      next.set('step', '4');
      return next;
    }, { state: { fromStep: 3 } satisfies FlowEntryState });
  };

  // Grouped Classes for Step 2
  const groupedClasses = useMemo(() => {
    const groups: Record<string, SeedClass[]> = {
      'Pre-primary': [],
      Primary: [],
      Middle: [],
      Secondary: [],
    };
    offeredClasses.forEach((cls) => {
      if (groups[cls.group]) {
        groups[cls.group].push(cls);
      }
    });
    return groups;
  }, [offeredClasses]);

  // How many items the server sent for these categories (null while loading).
  const countFor = (cats: readonly string[]) =>
    productsQuery.isSuccess ? products.filter((p) => cats.includes(shopSection(p))).length : null;

  const availableChips = useMemo(() => {
    const chips: { id: AccessoryChip; labelKey: MessageKey; count: number }[] = [];
    const accessoryItems = products.filter((p) => ACCESSORY_CATEGORIES.includes(p.category));
    const allCount = accessoryItems.length;
    if (allCount > 0) {
      chips.push({ id: 'all', labelKey: 'cat.all', count: allCount });
    }
    const tieCount = accessoryItems.filter((p) => getAccessoryType(p) === 'tie').length;
    if (tieCount > 0) {
      chips.push({ id: 'tie', labelKey: 'cat.tie', count: tieCount });
    }
    if (ACCESSORY_CATEGORIES.includes('School Shoes')) {
      const shoesCount = accessoryItems.filter((p) => getAccessoryType(p) === 'shoes').length;
      if (shoesCount > 0) {
        chips.push({ id: 'shoes', labelKey: 'cat.shoes', count: shoesCount });
      }
    }
    const socksCount = accessoryItems.filter((p) => getAccessoryType(p) === 'socks').length;
    if (socksCount > 0) {
      chips.push({ id: 'socks', labelKey: 'cat.socks', count: socksCount });
    }
    const beltCount = accessoryItems.filter((p) => getAccessoryType(p) === 'belt').length;
    if (beltCount > 0) {
      chips.push({ id: 'belt', labelKey: 'cat.belt', count: beltCount });
    }
    return chips;
  }, [products]);

  // Under Uniform: one chip per kind of accessory. "All" only matters for an old ?cat=Accessories link.
  const accessoryChips = useMemo(() => availableChips.filter((c) => c.id !== 'all'), [availableChips]);

  // Every card on the page uses one photo frame, so uniforms and accessories line up:
  // tall when the school has child portraits, square when all photos are close-ups.
  const listFrame: ProductFrame = useMemo(
    () => (products.some((p) => frameForImage(p.imageUrl) === 'portrait') ? 'portrait' : 'square'),
    [products]
  );

  const effectiveSub = useMemo(() => {
    if (availableChips.some((c) => c.id === activeSub)) return activeSub;
    return availableChips[0]?.id ?? 'all';
  }, [availableChips, activeSub]);

  // Filtered Products for Step 4 (Category + Gender filter)
  const step4Products = useMemo(() => {
    if (activeTab === 'Uniform') {
      return products.filter((p) => shopSection(p) === 'Uniform');
    }
    if (inAccessories) {
      const accessoryItems = products.filter((p) => ACCESSORY_CATEGORIES.includes(p.category));
      if (effectiveSub === 'all') {
        return accessoryItems;
      }
      return accessoryItems.filter((p) => getAccessoryType(p) === effectiveSub);
    }
    return products.filter((p) => p.category === activeTab);
  }, [products, activeTab, inAccessories, effectiveSub]);

  // "Order full set": the items made for this school that can be ordered here.
  const fullSetProducts = useMemo(
    () =>
      products.filter(
        (p) => !isPtUniform(p) && isCategoryLive(p.category) && p.official && !p.needsDetails && p.sizes.some((size) => size.inStock)
      ),
    [products]
  );

  // The round back button in the top bar goes back one step, like the links on each step
  // (step 4 asks first if going back would clear the bag).
  // An open product closes first.
  useBackHandler(() => {
    if (activeProductForSheet) closeSheet();
    else if (currentStep === 4) {
      if (inAccessories) selectTab('Uniform');
      else requestStepChange(3);
    }
    else goToStep(currentStep - 1);
  }, currentStep > 1 || Boolean(activeProductForSheet));

  const requiredProducts = useMemo(() => {
    return step4Products.filter((p) => p.required);
  }, [step4Products]);

  const optionalProducts = useMemo(() => {
    return step4Products.filter((p) => !p.required);
  }, [step4Products]);

  return (
    <div className="selection-flow-page container" id="main">
      {/* Top Stepper Nav */}
      <div className="flow-stepper-wrap">
        <div className="flow-stepper" role="navigation" aria-label={t('flow.progress')}>
          {/* Step 1 Node */}
          <button
            type="button"
            className={`step-node ${currentStep >= 1 ? 'is-active' : ''} ${currentStep > 1 ? 'is-complete' : ''}`}
            onClick={() => requestStepChange(1)}
            aria-current={currentStep === 1 ? 'step' : undefined}
          >
            <span className="step-node-bubble">
              {currentStep > 1 ? <Check width={14} height={14} /> : '1'}
            </span>
            <span className="step-node-label">{t('flow.school')}</span>
          </button>

          {/* Stepper Thread Connector */}
          <div className="stepper-connector">
            <Thread animate={currentStep >= 2} />
          </div>

          {/* Step 2 Node */}
          <button
            type="button"
            className={`step-node ${currentStep >= 2 ? 'is-active' : ''} ${currentStep > 2 ? 'is-complete' : ''}`}
            onClick={() => activeSchool && requestStepChange(2)}
            disabled={!activeSchool}
            aria-current={currentStep === 2 ? 'step' : undefined}
          >
            <span className="step-node-bubble">
              {currentStep > 2 ? <Check width={14} height={14} /> : '2'}
            </span>
            <span className="step-node-label">{t('flow.class')}</span>
          </button>

          {/* Stepper Thread Connector */}
          <div className="stepper-connector">
            <Thread animate={currentStep >= 3} />
          </div>

          {/* Step 3 Node: Boy / Girl */}
          <button
            type="button"
            className={`step-node ${currentStep >= 3 ? 'is-active' : ''} ${currentStep > 3 ? 'is-complete' : ''}`}
            onClick={() => activeSchool && activeClass && requestStepChange(3)}
            disabled={!activeSchool || !activeClass}
            aria-current={currentStep === 3 ? 'step' : undefined}
          >
            <span className="step-node-bubble">
              {currentStep > 3 ? <Check width={14} height={14} /> : '3'}
            </span>
            <span className="step-node-label">{t('flow.boyGirl')}</span>
          </button>

          {/* Stepper Thread Connector */}
          <div className="stepper-connector">
            <Thread animate={currentStep >= 4} />
          </div>

          {/* Step 4 Node: Items */}
          <button
            type="button"
            className={`step-node ${currentStep === 4 ? 'is-active' : ''}`}
            onClick={() => activeSchool && activeClass && activeGender && goToStep(4)}
            disabled={!activeSchool || !activeClass || !activeGender}
            aria-current={currentStep === 4 ? 'step' : undefined}
          >
            <span className="step-node-bubble">4</span>
            <span className="step-node-label">{t('flow.items')}</span>
          </button>
        </div>

        {/* Mobile Stepper Header */}
        <div className="mobile-stepper-title">
          <span>
            {t('flow.stepOf', { n: currentStep })} ·{' '}
            {currentStep === 1
              ? t('flow.school')
              : currentStep === 2
              ? t('flow.class')
              : currentStep === 3
              ? t('flow.boyGirl')
              : t('flow.items')}
          </span>
        </div>
      </div>

      {/* Main Stepped Content with Directional Animation */}
      <StepTransition stepKey={currentStep} direction={stepDirection}>
        {/* ================= STEP 1: SCHOOL ================= */}
        {currentStep === 1 && (
          <BranchPicker
            // Opened from a link or the home page search for one school: only its branches.
            schoolId={linkedSchoolId && !activeBranch ? linkedSchoolId : undefined}
            schoolName={linkedSchoolId && !activeBranch ? activeSchool?.name : undefined}
            onClearSchool={clearLinkedSchool}
            selectedBranchId={activeBranch?.branchId}
            initialState={activeBranch?.stateName}
            initialCityId={activeBranch?.cityId}
            onSelect={handleSelectBranch}
          />
        )}

        {/* ================= STEP 2: CLASS ================= */}
        {currentStep > 1 && !activeSchool && (
          <div className="flow-empty-state" role={schoolsQuery.isLoading ? 'status' : 'alert'}>
            {schoolsQuery.isLoading ? (
              <p>{t('flow.loadingSchool')}</p>
            ) : schoolsQuery.isError ? (
              <>
                <h3>{t('flow.schoolError')}</h3>
                <p>{t('common.checkInternet')}</p>
                <button type="button" className="btn btn-primary" onClick={() => schoolsQuery.refetch()}>
                  {t('common.tryAgain')}
                </button>
              </>
            ) : (
              <>
                <h3>{t('flow.linkSchoolMissing')}</h3>
                <p>{t('flow.linkSchoolMissingSub')}</p>
                <button type="button" className="btn btn-primary" onClick={() => goToStep(1)}>
                  {t('flow.chooseSchool')}
                </button>
              </>
            )}
          </div>
        )}

        {currentStep === 2 && activeSchool && (
          <div className="step-panel step-class-panel">
            <button
              type="button"
              className="step-back-btn step-back-btn--boxed"
              onClick={() => goToStep(1)}
            >
              <ArrowLeft width={16} height={16} /> {t('flow.backTo', { step: t('flow.school') })}
            </button>

            <div className="step-title-row">
              <span className="label">{schoolLabel}</span>
              <SplitReveal as="h1" immediate className="step-heading">{t('flow.s2.title')}</SplitReveal>
              <ListenButton text={t('flow.s2.title')} />
            </div>

            <div className="class-groups-container">
              {Object.entries(groupedClasses).filter(([, classesInGroup]) => classesInGroup.length > 0).map(([groupTitle, classesInGroup]) => (
                <div key={groupTitle} className="class-group-block">
                  <span className="label class-group-label">{t(GROUP_KEYS[groupTitle] ?? 'grp.primary')}</span>
                  <div className="classes-tiles-grid">
                    {classesInGroup.map((c) => {
                      const isSelected = activeClass?.id === c.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          className={`class-tile ${isSelected ? 'is-selected' : ''}`}
                          onClick={() => handleSelectClass(c)}
                        >
                          <span className="class-tile-name">{classLabel(c.name, t)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ================= STEP 3: BOY OR GIRL ================= */}
        {currentStep === 3 && activeSchool && activeClass && (
          <div className="step-panel step-gender-panel">
            <button
              type="button"
              className="step-back-btn step-back-btn--boxed"
              onClick={() => goToStep(2)}
            >
              <ArrowLeft width={16} height={16} /> {t('flow.backTo', { step: t('flow.class') })}
            </button>

            <div className="step-title-row">
              <span className="label">{schoolLabel} · {classLabel(activeClass.name, t)}</span>
              <SplitReveal as="h1" immediate className="step-heading">{t('flow.s3.title')}</SplitReveal>
              <ListenButton text={t('flow.s3.title')} />
            </div>

            <div
              className="gender-cards-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '20px',
                maxWidth: '560px',
              }}
            >
              {/* Boy Card */}
              <button
                type="button"
                className={`gender-card ${activeGender === 'boy' ? 'is-selected' : ''}`}
                onClick={() => handleSelectGender('boy')}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '32px 20px',
                  textAlign: 'center',
                  background: activeGender === 'boy' ? 'var(--brand-tint, #edf6ef)' : 'var(--paper-raised, #ffffff)',
                  border: activeGender === 'boy' ? '2px solid var(--brand, #275b4c)' : '1px solid var(--line, #dfe5dd)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  minHeight: '140px',
                  transition: 'all 0.2s ease',
                }}
              >
                <strong className="gender-card-title">{t('g.boy')}</strong>
              </button>

              {/* Girl Card */}
              <button
                type="button"
                className={`gender-card ${activeGender === 'girl' ? 'is-selected' : ''}`}
                onClick={() => handleSelectGender('girl')}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '32px 20px',
                  textAlign: 'center',
                  background: activeGender === 'girl' ? 'var(--brand-tint, #edf6ef)' : 'var(--paper-raised, #ffffff)',
                  border: activeGender === 'girl' ? '2px solid var(--brand, #275b4c)' : '1px solid var(--line, #dfe5dd)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  minHeight: '140px',
                  transition: 'all 0.2s ease',
                }}
              >
                <strong className="gender-card-title">{t('g.girl')}</strong>
              </button>
            </div>
          </div>
        )}

        {/* ================= STEP 4: ITEMS ================= */}
        {currentStep === 4 && activeSchool && (
          <div className="step-panel step-items-panel">
            <button
              type="button"
              className="step-back-btn step-back-btn--boxed"
              onClick={() => requestStepChange(3)}
            >
              <ArrowLeft width={16} height={16} /> {t('flow.backTo', { step: t('flow.boyGirl') })}
            </button>

            {/* Summary Bar above product list */}
            <div
              className="selection-summary-bar"
              style={{
                backgroundColor: 'var(--paper-raised, #ffffff)',
                border: '1px solid var(--line, #dfe5dd)',
                borderRadius: '6px',
                padding: '12px 18px',
                marginBottom: '1.5rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="pill" style={{ background: 'var(--brand-tint, #edf6ef)', color: 'var(--brand, #275b4c)', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600 }}>
                  {schoolLabel}
                </span>
                <span className="pill" style={{ background: 'var(--brand-tint, #edf6ef)', color: 'var(--brand, #275b4c)', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600 }}>
                  {cityLabel}
                </span>
                {activeClass && (
                  <span className="pill" style={{ background: 'var(--brand-tint, #edf6ef)', color: 'var(--brand, #275b4c)', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600 }}>
                    {classLabel(activeClass.name, t)}
                  </span>
                )}
                {activeGender && (
                  <span className="pill" style={{ background: 'var(--brand-tint, #edf6ef)', color: 'var(--brand, #275b4c)', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600 }}>
                    {genderLabel(activeGender, t)}
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  type="button"
                  className="step-back-btn"
                  style={{ margin: 0 }}
                  onClick={() => requestStepChange(3)}
                >
                  {t('nav.change')}
                </button>
              </div>
            </div>

            <div className="step-3-layout">
              {/* Main Catalog Col */}
              <div className="items-main-col">
                <div className="step-title-row">
                  <span className="label">
                    {schoolLabel} · {classLabel(activeClass?.name, t)} · {genderLabel(activeGender, t)}
                  </span>
                  <SplitReveal as="h1" immediate className="step-heading">{t('flow.s4.title')}</SplitReveal>
                  <ListenButton text={`${t('flow.s4.title')}. ${t('flow.s4.listen')}`} />
                </div>

                <>
                {fullSetProducts.length > 1 && (
                  <div className="fullset-banner">
                    <div>
                      <strong>{t('set.bannerTitle')}</strong>
                      <span>{t('set.bannerSub', { count: fullSetProducts.length, school: schoolLabel })}</span>
                    </div>
                    <button type="button" className="btn btn-primary" onClick={() => setFullSetOpen(true)}>
                      {t('set.open')}
                    </button>
                  </div>
                )}

                {/* Uniform first and large, with the accessory chips (tie, shoes, socks,
                    belt) right under it. A chip opens just that kind of item. */}
                <div ref={tabsTopRef} aria-hidden="true" />
                <div className="cat-switch" role="tablist" aria-label={t('home.shopByCategory')}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'Uniform'}
                    className={`cat-main ${activeTab === 'Uniform' ? 'is-active' : ''}`}
                    onClick={() => selectTab('Uniform')}
                  >
                    <CategoryPhoto category="Uniform" className="cat-main-photo" size={48} />
                    <span className="cat-main-text">
                      <span className="cat-main-label">{categoryLabel('Uniform', t)}</span>
                      <span className="cat-main-sub">{t('cat.uniformSub')}</span>
                    </span>
                    {countFor(['Uniform']) ? (
                      <span className="cat-strip-count">{countFor(['Uniform'])}</span>
                    ) : null}
                    <ChevronRight className="cat-strip-chevron" width={18} height={18} aria-hidden="true" />
                  </button>
                  {accessoryChips.length > 0 && (
                    <div className="cat-chips cat-chips--under-uniform" aria-label={t('cat.accessoriesGroup')}>
                      {accessoryChips.map((chip) => {
                        const on = inAccessories && effectiveSub === chip.id;
                        return (
                          <button
                            key={chip.id}
                            type="button"
                            role="tab"
                            aria-selected={on}
                            className={`cat-chip ${on ? 'is-active' : ''}`}
                            onClick={() => selectAccessoryChip(chip.id)}
                          >
                            {t(chip.labelKey)}
                            {chip.count ? <span className="cat-chip-count">{chip.count}</span> : null}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {OTHER_CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      role="tab"
                      aria-selected={activeTab === cat}
                      className={`cat-strip ${activeTab === cat ? 'is-active' : ''}`}
                      onClick={() => selectTab(cat)}
                    >
                      <span className="cat-strip-photos" aria-hidden="true">
                        <CategoryPhoto category={cat} className="cat-strip-photo" size={36} />
                      </span>
                      <span className="cat-strip-text">
                        <span className="cat-strip-label">{categoryLabel(cat, t)}</span>
                      </span>
                      {countFor([cat]) ? <span className="cat-strip-count">{countFor([cat])}</span> : null}
                      <ChevronRight className="cat-strip-chevron" width={18} height={18} aria-hidden="true" />
                    </button>
                  ))}
                </div>

                {/* ID card preview, filled from the parent's record when signed in */}
                {activeTab === 'ID Cards' && (
                  <IdCardPreview school={activeSchool} className={activeClass?.name} gender={activeGender} />
                )}

                {/* Empty State when no items match */}
                {productsQuery.isLoading ? (
                  <div role="status" aria-label={t('flow.loadingItems')}>
                    <ProductGridSkeleton count={4} />
                  </div>
                ) : productsQuery.isError ? (
                  <div className="flow-empty-state" role="alert" style={{ padding: '48px 24px', textAlign: 'center' }}>
                    <h3>{t('flow.itemsError')}</h3>
                    <p>{t('common.checkInternet')}</p>
                    <button type="button" className="btn btn-primary" onClick={() => productsQuery.refetch()}>
                      {t('common.tryAgain')}
                    </button>
                  </div>
                ) : step4Products.length === 0 ? (
                  <div className="flow-empty-state" style={{ padding: '48px 24px', textAlign: 'center' }}>
                    <h3 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 8px', color: 'var(--ink)' }}>
                      {t('flow.noItems', { cat: categoryLabel(activeTab, t), cls: classLabel(activeClass?.name, t), g: genderLabel(activeGender, t) })}
                    </h3>
                    <p style={{ color: 'var(--ink-soft)', fontSize: '14px', margin: '0 0 20px' }}>
                      {t('flow.noItemsSub')}
                    </p>
                    <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => requestStepChange(2)}
                      >
                        {t('flow.changeClass')}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => requestStepChange(3)}
                      >
                        {t('flow.changeBoyGirl')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Required List Section */}
                    {requiredProducts.length > 0 && (
                      <div className="required-section-block">
                        <div className="required-head-row">
                          <div>
                            <h2 className="required-heading">{t('flow.requiredFor', { cls: classLabel(activeClass?.name, t) })}</h2>
                          </div>
                        </div>

                        <Stagger key={`req-${activeTab}`} className="products-grid">
                          {requiredProducts.map((p, index) => (
                            <ProductCard
                              key={p.id}
                              product={p}
                              priority={index === 0}
                              onOpenDetails={openSheet}
                              frame={listFrame}
                              onAdded={(item) => handleAdded(item, true)}
                            />
                          ))}
                        </Stagger>
                      </div>
                    )}

                    {/* Optional items */}
                    {optionalProducts.length > 0 && (
                      <div className="optional-section-block">
                        <h2 className="optional-heading">
                          {requiredProducts.length > 0
                            ? t('flow.extras')
                            : t('flow.listFor', { cls: classLabel(activeClass?.name, t) })}
                        </h2>
                        <Stagger key={`opt-${activeTab}`} className="products-grid">
                          {optionalProducts.map((p, index) => (
                            <ProductCard
                              key={p.id}
                              product={p}
                              priority={index === 0 && requiredProducts.length === 0}
                              onOpenDetails={openSheet}
                              frame={listFrame}
                              onAdded={(item) => handleAdded(item, true)}
                            />
                          ))}
                        </Stagger>
                      </div>
                    )}
                  </>
                )}
                </>
              </div>
            </div>
          </div>
        )}
      </StepTransition>

      {/* Cart Cleared Warning Modal */}
      {showCartWarning && (
        <div className="modal-backdrop" style={{ zIndex: 100 }}>
          <div className="modal-card" style={{ maxWidth: '440px', padding: '24px' }}>
            <h3 style={{ margin: '0 0 10px', fontSize: '18px', color: 'var(--danger)' }}>{t('flow.clearTitle')}</h3>
            <p style={{ margin: '0 0 16px', fontSize: '14px', color: 'var(--ink)' }}>
              {t('flow.clearBody', { count: cart.length, cls: classLabel(activeClass?.name, t), g: genderLabel(activeGender, t) })}
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setShowCartWarning(false);
                  setPendingTargetStep(null);
                }}
              >
                {t('flow.keepBag')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ backgroundColor: '#dc2626', borderColor: '#dc2626', color: '#ffffff' }}
                onClick={handleConfirmCartClear}
              >
                {t('flow.clearAndChange')}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeSchool && (
        <FullSetSheet
          open={fullSetOpen}
          onClose={() => setFullSetOpen(false)}
          products={fullSetProducts}
          schoolName={activeSchool.name}
          className={activeClass?.name}
          onAdded={onOpenBag}
          fits={fits}
        />
      )}

      {/* Product Details Sheet */}
      <ProductSheet
        product={activeProductForSheet}
        isOpen={!!activeProductForSheet}
        onClose={closeSheet}
        onOpenBag={onOpenBag}
        fit={activeProductForSheet ? fits?.[activeProductForSheet.id] : undefined}
        fitLoading={sizeFit.isLoading}
        measurement={measurement}
        onSaveMeasurement={saveChildMeasurement}
        garments={garments}
        className={activeClass?.name}
        schoolName={activeSchool?.name}
        lastSize={activeProductForSheet ? lastSizes?.[activeProductForSheet.id] : undefined}
        onAdded={handleAdded}
      />

      <Popup
        isOpen={Boolean(added)}
        onClose={() => setAdded(null)}
        onDismiss={() => setAdded(null)}
        title={t('match.added')}
        message={added?.product.name ?? ''}
        confirmLabel={
          added?.match
            ? t(matchLabelKey(added.match.name))
            : t('match.accessories')
        }
        cancelLabel={added?.match ? t('match.continue') : null}
        onConfirm={() => {
          if (!added) return;
          if (added.match) openSheet(added.match);
          else selectTab('Accessories');
          setAdded(null);
        }}
        onCancel={() => {
          if (added) selectTab('Accessories');
          setAdded(null);
        }}
      >
        <button
          type="button"
          className="popup-link"
          onClick={() => {
            setAdded(null);
            onOpenBag?.();
          }}
        >
          {t('match.viewBag')}
        </button>
      </Popup>

      <Popup
        isOpen={askStationery}
        onClose={() => closeStationery(false)}
        message={t('stationery.ask')}
        confirmLabel={t('stationery.yes')}
        cancelLabel={t('stationery.no')}
        onConfirm={() => closeStationery(true)}
        onCancel={() => closeStationery(false)}
      />
    </div>
  );
}
