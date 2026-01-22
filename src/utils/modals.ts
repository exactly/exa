export const closeHandlers = new Set<() => void>();

let showUpdate: () => void = () => undefined;

export function onShow(show: () => void) {
  showUpdate = show;
}

export function showUpdateModal() {
  for (const close of closeHandlers) close();
  closeHandlers.clear();
  setTimeout(() => showUpdate(), 150);
}
