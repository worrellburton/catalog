import type { Product } from '~/data/looks';
import type { FitIntelligence } from '~/services/product-details';
import { supabase } from '~/utils/supabase';

export interface ShopperBody {
  gender: 'male' | 'female' | 'unknown';
  heightCm: number | null;
  weightKg: number | null;
}

export interface SizeMatchResult {
  size: string;
  confidence: 'high' | 'medium' | 'low';
  fitNote: string | null;
  available: boolean | null;
}

interface BrandFitProfile {
  fit_bias: string | null;
  silhouette: string | null;
  stretch: string | null;
}

const brandProfileCache = new Map<string, BrandFitProfile | null>();
let brandProfilesLoaded = false;

export async function loadBrandFitProfiles(): Promise<void> {
  if (brandProfilesLoaded || !supabase) return;
  const { data } = await supabase
    .from('brand_fit_profiles')
    .select('brand, fit_bias, silhouette, stretch');
  if (data) {
    for (const row of data) {
      brandProfileCache.set(
        (row.brand as string).toLowerCase(),
        { fit_bias: row.fit_bias, silhouette: row.silhouette, stretch: row.stretch },
      );
    }
  }
  brandProfilesLoaded = true;
}

function getBrandProfile(brand: string | null | undefined): BrandFitProfile | null {
  if (!brand) return null;
  return brandProfileCache.get(brand.toLowerCase()) ?? null;
}

// Standard body measurement ranges by height+weight bucket for
// men and women. These are rough centroids — enough to pick the
// right size from a size chart, not a tailored fit guarantee.
interface BodyEstimate {
  chestCm: number;
  waistCm: number;
  hipCm: number;
}

function estimateBodyMeasurements(body: ShopperBody): BodyEstimate | null {
  if (!body.heightCm || !body.weightKg) return null;

  const h = body.heightCm;
  const w = body.weightKg;
  const bmi = w / ((h / 100) ** 2);

  if (body.gender === 'male' || body.gender === 'unknown') {
    // Male estimation using BMI-scaled centroids
    const chestCm = 80 + (bmi - 18) * 2.8;
    const waistCm = 68 + (bmi - 18) * 3.2;
    const hipCm = 85 + (bmi - 18) * 2.0;
    return {
      chestCm: Math.round(chestCm),
      waistCm: Math.round(waistCm),
      hipCm: Math.round(hipCm),
    };
  }

  // Female estimation
  const chestCm = 76 + (bmi - 18) * 2.6;
  const waistCm = 60 + (bmi - 18) * 3.0;
  const hipCm = 86 + (bmi - 18) * 2.8;
  return {
    chestCm: Math.round(chestCm),
    waistCm: Math.round(waistCm),
    hipCm: Math.round(hipCm),
  };
}

// Keys in size_chart measurement objects that map to our body estimates
const CHEST_KEYS = ['chest_cm', 'chest_width_cm', 'bust_cm'];
const WAIST_KEYS = ['waist_cm'];
const HIP_KEYS = ['hip_cm'];

function findClosestSize(
  sizeChart: Record<string, Record<string, number>>,
  bodyEst: BodyEstimate,
): { size: string; distance: number } | null {
  let bestSize: string | null = null;
  let bestDist = Infinity;

  for (const [sizeLabel, measurements] of Object.entries(sizeChart)) {
    if (!measurements || typeof measurements !== 'object') continue;

    let totalDiff = 0;
    let comparisons = 0;

    for (const key of CHEST_KEYS) {
      if (typeof measurements[key] === 'number') {
        // Garment chest is flat-lay half-chest; body chest is full circumference.
        // Size charts vary — some list full, some half. If the value is < 80
        // it's likely a half-measurement; double it for comparison.
        let garmentChest = measurements[key];
        if (garmentChest < 80) garmentChest *= 2;
        totalDiff += Math.abs(garmentChest - bodyEst.chestCm);
        comparisons++;
        break;
      }
    }

    for (const key of WAIST_KEYS) {
      if (typeof measurements[key] === 'number') {
        let garmentWaist = measurements[key];
        if (garmentWaist < 65) garmentWaist *= 2;
        totalDiff += Math.abs(garmentWaist - bodyEst.waistCm);
        comparisons++;
        break;
      }
    }

    for (const key of HIP_KEYS) {
      if (typeof measurements[key] === 'number') {
        let garmentHip = measurements[key];
        if (garmentHip < 75) garmentHip *= 2;
        totalDiff += Math.abs(garmentHip - bodyEst.hipCm);
        comparisons++;
        break;
      }
    }

    if (comparisons === 0) continue;
    const avgDist = totalDiff / comparisons;

    if (avgDist < bestDist) {
      bestDist = avgDist;
      bestSize = sizeLabel;
    }
  }

  if (!bestSize) return null;
  return { size: bestSize, distance: bestDist };
}

// Standard size order for height-based fallback
const STANDARD_SIZES_MALE: Record<string, [minCm: number, maxCm: number]> = {
  'XS': [155, 165],
  'S': [163, 173],
  'M': [170, 180],
  'L': [178, 188],
  'XL': [185, 195],
  'XXL': [190, 205],
};

const STANDARD_SIZES_FEMALE: Record<string, [minCm: number, maxCm: number]> = {
  'XS': [150, 160],
  'S': [158, 168],
  'M': [165, 175],
  'L': [173, 183],
  'XL': [180, 190],
};

function fallbackSizeFromHeight(
  heightCm: number,
  gender: 'male' | 'female' | 'unknown',
  variants: Array<{ size: string | null }> | null | undefined,
): string | null {
  const chart = gender === 'female' ? STANDARD_SIZES_FEMALE : STANDARD_SIZES_MALE;
  const availableSizes = new Set(
    (variants ?? []).map(v => v.size?.toUpperCase().trim()).filter(Boolean) as string[],
  );

  let bestSize: string | null = null;
  let bestDist = Infinity;

  for (const [size, [lo, hi]] of Object.entries(chart)) {
    if (availableSizes.size > 0 && !availableSizes.has(size)) continue;
    const mid = (lo + hi) / 2;
    const dist = Math.abs(heightCm - mid);
    if (dist < bestDist) {
      bestDist = dist;
      bestSize = size;
    }
  }

  return bestSize;
}

function buildFitNote(
  fit: FitIntelligence | null | undefined,
  brandProfile: BrandFitProfile | null,
): string | null {
  const parts: string[] = [];

  if (brandProfile?.fit_bias === 'runs_small') parts.push('Runs small');
  else if (brandProfile?.fit_bias === 'runs_large') parts.push('Runs large');

  if (fit?.fit_type) {
    const ft = fit.fit_type.toLowerCase();
    if (ft.includes('slim') || ft.includes('fitted')) parts.push('Slim fit');
    else if (ft.includes('relax') || ft.includes('loose')) parts.push('Relaxed fit');
    else if (ft.includes('oversiz')) parts.push('Oversized');
  }

  if (fit?.stretch_behavior) {
    const s = fit.stretch_behavior.toLowerCase();
    if (s.includes('high') || s.includes('stretch')) parts.push('Stretchy');
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}

export function matchSize(
  product: Product,
  body: ShopperBody,
): SizeMatchResult | null {
  if (!body.heightCm) return null;

  const brandProfile = getBrandProfile(product.brand);
  const fitNote = buildFitNote(
    product.fit_intelligence as FitIntelligence | null,
    brandProfile,
  );

  // Priority 1: Use size_chart with body measurement estimation
  if (product.size_chart && body.weightKg) {
    const bodyEst = estimateBodyMeasurements(body);
    if (bodyEst) {
      const match = findClosestSize(product.size_chart, bodyEst);
      if (match) {
        const variant = product.variants?.find(
          v => v.size?.toUpperCase().trim() === match.size.toUpperCase().trim(),
        );
        const confidence = match.distance < 4 ? 'high' : match.distance < 8 ? 'medium' : 'low';
        return {
          size: match.size,
          confidence,
          fitNote,
          available: variant?.availability ?? null,
        };
      }
    }
  }

  // Priority 2: Variants exist — pick by height fallback
  if (product.variants && product.variants.length > 0) {
    const size = fallbackSizeFromHeight(body.heightCm, body.gender, product.variants);
    if (size) {
      const variant = product.variants.find(
        v => v.size?.toUpperCase().trim() === size,
      );
      return {
        size,
        confidence: 'low',
        fitNote,
        available: variant?.availability ?? null,
      };
    }
  }

  return null;
}

export function hasAnySizeData(product: Product): boolean {
  return !!(
    product.size_chart ||
    (product.variants && product.variants.length > 0)
  );
}

// Quick check: does at least one product in a look have the shopper's
// predicted size available?
export function lookHasMySizeAvailable(
  products: Product[],
  body: ShopperBody,
): boolean {
  for (const p of products) {
    const m = matchSize(p, body);
    if (m && m.available !== false) return true;
  }
  return false;
}

// Score a look by how well its products fit the shopper.
// Returns 0–1 where 1 = perfect fit across all products.
export function lookFitScore(
  products: Product[],
  body: ShopperBody,
): number {
  if (products.length === 0) return 0;

  let totalScore = 0;
  let scored = 0;

  for (const p of products) {
    const m = matchSize(p, body);
    if (!m) continue;
    scored++;

    let s = 0;
    if (m.confidence === 'high') s = 1.0;
    else if (m.confidence === 'medium') s = 0.7;
    else s = 0.4;

    if (m.available === true) s *= 1.0;
    else if (m.available === null) s *= 0.8;
    else s *= 0.3; // out of stock

    totalScore += s;
  }

  if (scored === 0) return 0;
  return totalScore / products.length;
}
