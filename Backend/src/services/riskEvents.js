const listeners = new Set();

export function onCellsChanged(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export async function runCellChangeHooks(cellIds) {
  if (!listeners.size) {
    console.log('no listeners');
    return;
  }
  await Promise.all([...listeners].map((callback) => callback(cellIds)));
}
