import { supabase } from '~/utils/supabase';

const DEVICE_ID_KEY = 'catalog_device_id';

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

/** Returns the total number of saves for the given look UUID, or 0 on error. */
export async function getLookSaveCount(lookUuid: string): Promise<number> {
  const { count, error } = await supabase
    .from('look_saves')
    .select('*', { count: 'exact', head: true })
    .eq('look_uuid', lookUuid);
  if (error) return 0;
  return count ?? 0;
}

/** Records a save for the current device (upsert — safe to call multiple times). */
export async function recordLookSave(lookUuid: string): Promise<void> {
  const deviceId = getDeviceId();
  await supabase
    .from('look_saves')
    .upsert({ look_uuid: lookUuid, device_id: deviceId }, { onConflict: 'look_uuid,device_id' });
}

/** Removes the save record for the current device. */
export async function recordLookUnsave(lookUuid: string): Promise<void> {
  const deviceId = getDeviceId();
  await supabase
    .from('look_saves')
    .delete()
    .eq('look_uuid', lookUuid)
    .eq('device_id', deviceId);
}
