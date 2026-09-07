import { chunk, getProfile, type EncodedReceipt } from '@qareeb/shared';

/**
 * Web Bluetooth (BLE GATT) transport. Only works where the browser exposes navigator.bluetooth in a
 * secure context and the printer speaks one of the documented BLE profiles. Reference:
 * https://developer.chrome.com/docs/capabilities/bluetooth
 */
export type BleSupport = 'ok' | 'unsupported' | 'insecure';

export function bleSupport(): BleSupport {
  if (typeof window === 'undefined' || !window.isSecureContext) return 'insecure';
  if (!('bluetooth' in navigator)) return 'unsupported';
  return 'ok';
}

export interface BleConnection {
  device: BluetoothDevice;
  name: string;
  characteristic: BluetoothRemoteGATTCharacteristic;
  profileId: string;
  disconnect(): void;
  onDisconnect(cb: () => void): void;
}

export class PrintTransportError extends Error {
  constructor(public readonly kind: 'permission_denied' | 'bluetooth_off' | 'connection_lost' | 'unsupported_profile' | 'partial', public readonly stripsSent = 0, public readonly stripsTotal = 0) {
    super(kind);
  }
}

/** Must be called from a user gesture (button click): the browser shows the device chooser. */
export async function connectBle(profileId: string): Promise<BleConnection> {
  const profile = getProfile(profileId);
  if (!profile?.ble) throw new PrintTransportError('unsupported_profile');
  const spec = profile.ble;
  let device: BluetoothDevice;
  try {
    device = await navigator.bluetooth.requestDevice({ filters: [{ services: [spec.serviceUuid] }], optionalServices: [spec.serviceUuid] });
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === 'NotFoundError' || name === 'SecurityError') throw new PrintTransportError('permission_denied');
    throw new PrintTransportError('bluetooth_off');
  }
  try {
    const server = await device.gatt!.connect();
    const service = await server.getPrimaryService(spec.serviceUuid);
    const characteristic = await service.getCharacteristic(spec.writeCharacteristicUuid);
    const listeners: Array<() => void> = [];
    device.addEventListener('gattserverdisconnected', () => listeners.forEach((l) => l()));
    return {
      device,
      name: device.name ?? device.id,
      characteristic,
      profileId,
      disconnect: () => device.gatt?.disconnect(),
      onDisconnect: (cb) => listeners.push(cb),
    };
  } catch {
    throw new PrintTransportError('connection_lost');
  }
}

/**
 * Sends encoded packets chunked and paced per profile. Progress is reported per strip so a partial
 * transmission can be flagged (never silently retried) if the link drops mid-receipt.
 */
export async function sendEncoded(conn: BleConnection, enc: EncodedReceipt, onProgress?: (stripsSent: number, stripsTotal: number) => void): Promise<void> {
  const spec = getProfile(conn.profileId)!.ble!;
  let stripsSent = 0;
  const stripPackets = enc.packets.slice(1, 1 + enc.stripsTotal);
  const write = async (data: Uint8Array) => {
    // Copy into a fresh ArrayBuffer-backed view (subarray views are rejected by some implementations).
    const buf = data.slice();
    if (spec.writeMode === 'without_response' && 'writeValueWithoutResponse' in conn.characteristic) await conn.characteristic.writeValueWithoutResponse(buf);
    else await conn.characteristic.writeValueWithResponse(buf);
    if (spec.pacingMs > 0) await new Promise((r) => setTimeout(r, spec.pacingMs));
  };
  try {
    for (const c of chunk(enc.packets[0]!, spec.chunkSize)) await write(c);
    for (const strip of stripPackets) {
      if (!conn.device.gatt?.connected) throw new PrintTransportError('partial', stripsSent, enc.stripsTotal);
      for (const c of chunk(strip, spec.chunkSize)) await write(c);
      stripsSent++;
      onProgress?.(stripsSent, enc.stripsTotal);
    }
    for (const tail of enc.packets.slice(1 + enc.stripsTotal)) for (const c of chunk(tail, spec.chunkSize)) await write(c);
  } catch (e) {
    if (e instanceof PrintTransportError) throw e;
    // Bytes may already be on the wire → partial/ambiguous unless nothing was sent yet.
    throw new PrintTransportError(stripsSent === 0 ? 'connection_lost' : 'partial', stripsSent, enc.stripsTotal);
  }
}
