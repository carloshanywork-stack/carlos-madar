import { createHash } from 'node:crypto';

/**
 * Generates an immutable, scan-friendly barcode identifier and metadata
 * for reusable acrylic/sheet offcuts stored in the sub-warehouse.
 */
export function generateOffcutBarcode({
  materialCode = 'MAT',
  thicknessMm = 0,
  widthCm = 0,
  heightCm = 0,
  id = 0,
} = {}) {
  const cleanCode = (materialCode || 'MAT').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6);
  const dim = `${Math.round(widthCm)}x${Math.round(heightCm)}`;
  const thick = thicknessMm ? `${thicknessMm}MM-` : '';
  const seq = String(id).padStart(4, '0');
  const barcode = `MADAR-OFC-${cleanCode}-${thick}${dim}-${seq}`;
  const checksum = createHash('sha256').update(barcode).digest('hex').slice(0, 6).toUpperCase();
  return {
    barcode,
    checksum,
    displayLabel: `فضلة ${cleanCode} ${dim} سم #${seq}`,
  };
}
