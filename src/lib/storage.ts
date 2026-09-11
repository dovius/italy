import type { SavedTrip } from '../../shared/types';

export const emptyTrip = (): SavedTrip => ({ version: 1, photo: null, assistant: [], transcripts: [], drafts: { photo: '', assistant: '' } });
let connection: Promise<IDBDatabase> | undefined;
function database() {
  return connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open('keliones-vertejas', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('trip');
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error('Storage blocked'));
  });
}
export async function readTrip(): Promise<SavedTrip> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const read = db.transaction('trip').objectStore('trip').get('current');
    read.onerror = () => reject(read.error);
    read.onsuccess = () => {
      const value = read.result as SavedTrip | undefined;
      if (!value || value.version !== 1 || !Array.isArray(value.assistant) || !Array.isArray(value.transcripts) || !value.drafts) return resolve(emptyTrip());
      resolve(value);
    };
  });
}
export async function writeTrip(value: SavedTrip) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('trip', 'readwrite');
    transaction.objectStore('trip').put(value, 'current');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
