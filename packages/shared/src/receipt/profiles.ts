import type { PaperWidth, PrinterTransport } from '../types.js';
import type { RasterCommand } from './escpos.js';

/**
 * Printer profiles. A profile documents the transport, GATT service/characteristic UUIDs (BLE),
 * write mode, chunk size, pacing and the raster command a device family accepts.
 *
 * `verified: false` marks a candidate that has NOT been tested on real hardware. The launch printer
 * model has not been provided yet; nothing here claims universal compatibility.
 */
export interface BleGattSpec {
  serviceUuid: string;
  writeCharacteristicUuid: string;
  /** Optional notify characteristic for status feedback. */
  notifyCharacteristicUuid?: string;
  writeMode: 'with_response' | 'without_response';
  chunkSize: number;
  /** Delay between chunks in ms. */
  pacingMs: number;
}

export interface PrinterProfile {
  id: string;
  label: string;
  transports: PrinterTransport[];
  paperWidths: PaperWidth[];
  /** Default printable dots per paper width for this family (203 dpi typical: 384 / 576). */
  defaultDots: Record<PaperWidth, number>;
  raster: RasterCommand;
  maxStripRows: number;
  cutSupported: boolean;
  ble?: BleGattSpec;
  /** RFCOMM: Serial Port Profile UUID. */
  sppUuid?: string;
  verified: boolean;
  notes: string;
}

export const SPP_UUID = '00001101-0000-1000-8000-00805f9b34fb';

export const PRINTER_PROFILES: PrinterProfile[] = [
  {
    id: 'generic_escpos_ble_ff00',
    label: 'Generic ESC/POS BLE (service FF00 / char FF02)',
    transports: ['web_bluetooth_ble'],
    paperWidths: [58, 80],
    defaultDots: { 58: 384, 80: 576 },
    raster: 'gs_v_0',
    maxStripRows: 128,
    cutSupported: false,
    ble: {
      serviceUuid: '000018f0-0000-1000-8000-00805f9b34fb',
      writeCharacteristicUuid: '00002af1-0000-1000-8000-00805f9b34fb',
      notifyCharacteristicUuid: '00002af0-0000-1000-8000-00805f9b34fb',
      writeMode: 'without_response',
      chunkSize: 100,
      pacingMs: 20,
    },
    verified: false,
    notes: 'Common on low-cost 58mm BLE thermal printers (service 18F0, characteristic 2AF1). Candidate only — UUIDs and pacing must be confirmed on the actual device.',
  },
  {
    id: 'generic_escpos_ble_ff00_alt',
    label: 'Generic ESC/POS BLE (service FF00 / char FF02, alt)',
    transports: ['web_bluetooth_ble'],
    paperWidths: [58, 80],
    defaultDots: { 58: 384, 80: 576 },
    raster: 'gs_v_0',
    maxStripRows: 128,
    cutSupported: false,
    ble: {
      serviceUuid: '0000ff00-0000-1000-8000-00805f9b34fb',
      writeCharacteristicUuid: '0000ff02-0000-1000-8000-00805f9b34fb',
      notifyCharacteristicUuid: '0000ff01-0000-1000-8000-00805f9b34fb',
      writeMode: 'without_response',
      chunkSize: 100,
      pacingMs: 20,
    },
    verified: false,
    notes: 'Second widespread BLE service layout (FF00/FF02). Candidate only.',
  },
  {
    id: 'generic_escpos_ble_e7810a71',
    label: 'Generic ESC/POS BLE (service E7810A71 / char BEF8D6C9)',
    transports: ['web_bluetooth_ble'],
    paperWidths: [58, 80],
    defaultDots: { 58: 384, 80: 576 },
    raster: 'gs_v_0',
    maxStripRows: 128,
    cutSupported: true,
    ble: {
      serviceUuid: 'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
      writeCharacteristicUuid: 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f',
      writeMode: 'with_response',
      chunkSize: 180,
      pacingMs: 10,
    },
    verified: false,
    notes: 'Used by several 80mm BLE-capable ESC/POS printers. Candidate only.',
  },
  {
    id: 'classic_escpos_rfcomm',
    label: 'Classic Bluetooth ESC/POS (SPP / RFCOMM) — Android print station',
    transports: ['android_rfcomm'],
    paperWidths: [58, 80],
    defaultDots: { 58: 384, 80: 576 },
    raster: 'gs_v_0',
    maxStripRows: 256,
    cutSupported: true,
    sppUuid: SPP_UUID,
    verified: false,
    notes: 'Most 58/80mm Bluetooth receipt printers expose SPP. Handled by the Android companion; not reachable from Web Bluetooth. Cut support varies by model.',
  },
  {
    id: 'classic_escpos_rfcomm_escstar',
    label: 'Classic Bluetooth ESC/POS (SPP) — ESC * fallback for printers without GS v 0',
    transports: ['android_rfcomm'],
    paperWidths: [58, 80],
    defaultDots: { 58: 384, 80: 576 },
    raster: 'esc_star_24',
    maxStripRows: 240,
    cutSupported: false,
    sppUuid: SPP_UUID,
    verified: false,
    notes: 'For older firmware that ignores GS v 0. Candidate only.',
  },
  {
    id: 'os_print_dialog',
    label: 'System print dialog / Save as PDF (not Bluetooth)',
    transports: ['os_print_dialog'],
    paperWidths: [58, 80],
    defaultDots: { 58: 384, 80: 576 },
    raster: 'gs_v_0',
    maxStripRows: 256,
    cutSupported: false,
    verified: true,
    notes: 'Uses the operating system printing stack (including AirPrint on iOS). A dismissed dialog is never recorded as printed.',
  },
];

export function getProfile(id: string): PrinterProfile | undefined {
  return PRINTER_PROFILES.find((p) => p.id === id);
}
